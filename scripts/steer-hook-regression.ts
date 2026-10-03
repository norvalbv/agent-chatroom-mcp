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
const env = { PATH: process.env.PATH ?? "", TMPDIR: (await import("node:os")).tmpdir(), CHATROOM_SEAT_KEY: "seat-A", CHATROOM_HEARTBEAT_URL: url };

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

// 3. Pending mentions are steered into the turn for the event that fired, then acked in one call, after printing.
for (const event of ["PreToolUse", "PostToolUse"]) {
  seen.length = 0;
  pending = [
    { id: `m_1_${event}_${process.pid}`, seq: 7, from: "opus-1", room: "r1", text: '#7 opus-1: @opus-2 can you review claim/x? (reply: send_message room="r1" reply_to="m_1")' },
    { id: `m_2_${event}_${process.pid}`, seq: 9, from: "verifier", room: "r2", text: '#9 verifier: @opus-2 which dev room did you watch? (reply: send_message room="r2" reply_to="m_2")' },
  ];
  r = await hook({ hook_event_name: event, tool_name: "Read", tool_input: { file_path: "/x" } });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, event);
  assert.match(out.additionalContext, /\[r1\] #7 opus-1: @opus-2 can you review claim\/x\? \(reply: send_message room="r1" reply_to="m_1"\)/);
  assert.match(out.additionalContext, /\[r2\] #9 verifier: @opus-2 which dev room/);
  const acks = seen.filter((s) => s.path === "/steer/ack").map((s) => s.body);
  assert.deepEqual(acks, [{ seat_key: "seat-A", ids: [`m_1_${event}_${process.pid}`, `m_2_${event}_${process.pid}`] }]);
}

// 3b. Two hooks racing on the same ask (parallel tool calls: Pre and Post side by side, before either acks): exactly
//     one prints it. Fresh ids, since the ones above are already claimed.
pending = [{ id: `m_race_${process.pid}`, seq: 11, from: "opus-1", room: "r1", text: "#11 opus-1: @opus-2 race" }];
const race = await Promise.all([
  hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/a" } }),
  hook({ hook_event_name: "PostToolUse", tool_name: "Grep", tool_input: { pattern: "b" } }),
  hook({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "/c" } }),
]);
assert.equal(race.filter((x) => x.stdout.includes("@opus-2 race")).length, 1, "one injection per ask across concurrent hooks");

// 3c. A claim whose hook died before printing or acking (the hub still lists the ask) goes stale and is re-steered.
{
  const { createHash } = await import("node:crypto");
  const { utimesSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const file = join(tmpdir(), "chatroom-steer", createHash("sha256").update("seat-A").digest("hex").slice(0, 16), `m_race_${process.pid}`);
  const old = new Date(Date.now() - 60_000);
  utimesSync(file, old, old);
  r = await hook({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "/d" } });
  assert.match(r.stdout, /@opus-2 race/, "a stale claim on a still-pending ask is printed again");
  r = await hook({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "/e" } });
  assert.equal(r.stdout, "", "and re-claimed fresh, so not on every call");
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

// 7. End to end on a real throwaway hub (never 7717): a peer @-mentions a seat that is busy in local tools; the seat's
//    next tool hook carries the mention into its turn, the ack counts as delivery, and its next wait does not resend the body.
const PORT = Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000));
assert.notEqual(PORT, 7717, "never the live hub");
const HTTP = `http://127.0.0.1:${PORT}`;
const server = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: "/tmp/chatroom-steer-hook", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: "" }, stdio: ["ignore", "ignore", "inherit"] });
process.on("exit", () => server.kill());
for (let i = 0; ; i++) {
  try { await fetch(`${HTTP}/`); break; } catch { if (i > 100) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); }
}
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { seatBeat } = await import("../src/env.js");
async function connect(u: string) {
  const c = new Client({ name: "steer", version: "0.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(u)));
  return async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await c.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    if (res.isError) throw new Error(`${tool}: ${res.content[0]?.text}`);
    return JSON.parse(res.content[0]!.text);
  };
}
const beat = seatBeat(`${HTTP}/mcp`, "seat-busy");
const busy = await connect(beat.mcpUrl);
const peerCall = await connect(`${HTTP}/mcp`);
await busy("join_room", { room: "steer", name: "builder", agent: "claude", expected_participants: 0 });
const peerJoin = await peerCall("join_room", { room: "steer", name: "peer", agent: "claude" });
await busy("wait_for_messages", { room: "steer", timeout_ms: 0 });
const ask = await peerCall("send_message", { room: "steer", participant_id: peerJoin.participant_id, content: "@builder is claim/x yours?" });
const real = { ...env, CHATROOM_SEAT_KEY: beat.key, CHATROOM_HEARTBEAT_URL: `${HTTP}/heartbeat` };
r = await hook({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "npm run build" } }, real);
const ctx = JSON.parse(r.stdout).hookSpecificOutput;
assert.equal(ctx.hookEventName, "PostToolUse");
assert.match(ctx.additionalContext, new RegExp(`#${ask.seq} peer: @builder is claim/x yours\\?`));
assert.match(ctx.additionalContext, new RegExp(`reply_to="${ask.id}"`));
r = await hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test" } }, real);
assert.equal(r.stdout, "", "acked: not steered twice");
const after = await busy("wait_for_messages", { room: "steer", timeout_ms: 0 });
if (JSON.stringify(after.messages ?? []).includes("is claim/x yours?")) { console.error(JSON.stringify(after, null, 1).slice(0, 3000)); assert.fail("the next wait does not resend the steered body"); }
console.log("STEER HOOK OK");
process.exit(0); // open MCP sessions and the hub child would keep the loop alive
