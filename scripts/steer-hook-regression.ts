/**
 * Steering a busy claude -p seat (swarm-181144-uxtr, problem 3): an @-mention that lands while the seat is mid-turn
 * reaches the model on its next local tool call, without a wait_for_messages. scripts/heartbeat-hook.mjs runs on
 * PreToolUse and PostToolUse; the hub's /heartbeat answers with `pending` (messages addressed to the seat, not yet
 * shown); the hook prints them as hookSpecificOutput.additionalContext for that event and only then acks their ids.
 * A stub hub on a random port stands in for the hub so the hook's half of the contract is checked on its own.
 * Run: npx tsx scripts/steer-hook-regression.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { HEARTBEAT_HOOK, heartbeatHookSettings } from "../src/env.js";

const seen: { path: string; body: any }[] = [];
let pending: unknown[] = [];
const stub = createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    seen.push({ path: req.url ?? "", body: JSON.parse(raw || "{}") });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url === "/heartbeat" ? { ok: true, marked: 1, pending } : { ok: true }));
  });
});
await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${(stub.address() as AddressInfo).port}/heartbeat`;
const env = { PATH: process.env.PATH ?? "", CHATROOM_SEAT_KEY: "seat-A", CHATROOM_HEARTBEAT_URL: url };

// async spawn: the stub answers on this event loop, so spawnSync would deadlock
const hook = (input: unknown, e: Record<string, string> = env) => new Promise<{ status: number | null; stdout: string }>((resolve) => {
  const p = spawn(process.execPath, [HEARTBEAT_HOOK], { env: e });
  let stdout = "";
  p.stdout.on("data", (d) => (stdout += d));
  p.on("close", (status) => resolve({ status, stdout }));
  p.stdin.end(JSON.stringify(input));
});

// 1. Nothing pending: PreToolUse heartbeats with tool + detail, prints nothing, exits 0 (unchanged behaviour).
let r = await hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test" } });
assert.equal(r.status, 0); assert.equal(r.stdout, "");
assert.deepEqual(seen.at(-1), { path: "/heartbeat", body: { seat_key: "seat-A", tool: "Bash", detail: "npm test" } });

// 2. PostToolUse only peeks: it must not record a second step for the same tool call.
seen.length = 0;
r = await hook({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "npm test" } });
assert.equal(r.stdout, "");
assert.deepEqual(seen, [{ path: "/heartbeat", body: { seat_key: "seat-A", peek: true } }]);

// 3. Pending mentions are steered into the turn for the event that fired, then acked per room, after printing.
for (const event of ["PreToolUse", "PostToolUse"]) {
  seen.length = 0;
  pending = [
    { id: "m_1", seq: 7, from: "opus-1", room: "r1", text: "@opus-2 can you review claim/x?" },
    { id: "m_2", seq: 9, from: "verifier", room: "r2", text: "@opus-2 which dev room did you watch?" },
  ];
  r = await hook({ hook_event_name: event, tool_name: "Read", tool_input: { file_path: "/x" } });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, event);
  assert.match(out.additionalContext, /#7 opus-1 in r1 \(id m_1\): @opus-2 can you review claim\/x\?/);
  assert.match(out.additionalContext, /#9 verifier in r2 \(id m_2\)/);
  assert.match(out.additionalContext, /reply_to/);
  const acks = seen.filter((s) => s.path === "/steer/ack").map((s) => s.body).sort((a, b) => a.room.localeCompare(b.room));
  assert.deepEqual(acks, [{ seat_key: "seat-A", room: "r1", ids: ["m_1"] }, { seat_key: "seat-A", room: "r2", ids: ["m_2"] }]);
}

// 4. Chatroom MCP calls carry pending messages hub-side, so the hook neither heartbeats nor steers on them.
seen.length = 0;
r = await hook({ hook_event_name: "PostToolUse", tool_name: "mcp__chatroom__board_get", tool_input: {} });
assert.equal(r.stdout, ""); assert.equal(seen.length, 0);

// 5. A dead hub, garbage input or no seat env: exit 0, no output, no ack (the message stays pending for the pull path).
pending = [];
r = await hook({ hook_event_name: "PostToolUse", tool_name: "Bash" }, { ...env, CHATROOM_HEARTBEAT_URL: "http://127.0.0.1:1/heartbeat" });
assert.equal(r.status, 0); assert.equal(r.stdout, "");
r = await new Promise((resolve) => {
  const p = spawn(process.execPath, [HEARTBEAT_HOOK], { env });
  let stdout = "";
  p.stdout.on("data", (d) => (stdout += d));
  p.on("close", (status) => resolve({ status, stdout }));
  p.stdin.end("not json");
});
assert.equal(r.status, 0); assert.equal(r.stdout, "");

// 6. The launch settings wire the one hook script to both events.
const s = JSON.parse(heartbeatHookSettings());
for (const ev of ["PreToolUse", "PostToolUse"]) assert.match(s.hooks[ev][0].hooks[0].command, /heartbeat-hook\.mjs"$/, ev);

stub.close();
console.log("STEER HOOK OK");
