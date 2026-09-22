/**
 * Item 3 (swarm-140818-f1qy): every seat type heartbeats without a room turn.
 * Only src/seat.ts (OpenRouter) posted /rooms/:room/heartbeat; claude -p and codex exec seats never did, and hub calls
 * other than join/wait/read/send/leave (board_*, vote, room_status) did not refresh last_seen_at either, so a
 * heads-down claude seat looked dead on the People tab. Now: a launched seat carries a seat key (?seat= on its MCP URL,
 * CHATROOM_SEAT_KEY in its env); the claude -p PreToolUse hook (scripts/heartbeat-hook.mjs) POSTs /heartbeat with it
 * on every local tool call; codex output is a heartbeat from its launcher; every MCP tool call records a step hub-side.
 * Throwaway hub on its own port (never 7717), stopped by pid.
 * Run: npm run build && PORT=7741 npx tsx scripts/heartbeat-regression.ts
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { claudeArgs } from "../src/claude-args.js";
import { HEARTBEAT_HOOK, heartbeatHookSettings, outputHeartbeat, seatBeat } from "../src/env.js";

const PORT = Number(process.env.PORT ?? 7741);
assert.notEqual(PORT, 7717, "never the live hub");
const HTTP = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ["dist/index.js"], { env: { ...process.env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: "/tmp/chatroom-heartbeat-spawn", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: "" }, stdio: ["ignore", "ignore", "inherit"] });
process.on("exit", () => server.kill());

for (let i = 0; ; i++) {
  try { await fetch(`${HTTP}/`); break; } catch { if (i > 50) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); }
}

async function connect(url: string) {
  const client = new Client({ name: "hb", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    if (res.isError) throw new Error(`${tool}: ${res.content[0]?.text}`);
    try { return JSON.parse(res.content[0]?.text ?? ""); } catch { return res.content[0]?.text; }
  };
}
const person = async (room: string, name: string) =>
  ((await (await fetch(`${HTTP}/rooms/${room}`)).json()) as { participants: { name: string; working: { tool: string; step: number; detail?: string } | null; last_seen_at: string }[] }).participants.find((p) => p.name === name)!;
const hook = (input: unknown, env: Record<string, string>) =>
  spawnSync(process.execPath, [HEARTBEAT_HOOK], { input: JSON.stringify(input), env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8", timeout: 10_000 });

const beat = seatBeat(`${HTTP}/mcp`, "seat-key-A");
const other = seatBeat(`${HTTP}/mcp`, "seat-key-B");
const a = await connect(beat.mcpUrl);
const b = await connect(other.mcpUrl);
await a("join_room", { room: "hb", name: "builder", agent: "claude", expected_participants: 0 });
await a("join_room", { room: "hb-sub", name: "builder", agent: "claude", expected_participants: 0 });
await b("join_room", { room: "hb", name: "peer", agent: "claude" });

// 1. seatBeat: the key rides on the MCP URL and in the seat env, pointing the hook at <hub>/heartbeat.
assert.equal(new URL(beat.mcpUrl).searchParams.get("seat"), "seat-key-A");
assert.deepEqual(beat.env, { CHATROOM_SEAT_KEY: "seat-key-A", CHATROOM_HEARTBEAT_URL: `${HTTP}/heartbeat` });

// 2. The claude hook: a local tool call (no hub call at all) marks the seat as working in every room it is in,
//    with the command as detail; its output is empty and it exits 0 (it must never block or alter the tool).
const before = await person("hb", "builder");
await new Promise((r) => setTimeout(r, 20));
const run = hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test -- --grep kick" } }, beat.env as Record<string, string>);
assert.equal(run.status, 0); assert.equal(run.stdout, "");
let me = await person("hb", "builder");
assert.equal(me.working?.tool, "Bash"); assert.equal(me.working?.detail, "npm test -- --grep kick");
assert.ok(Date.parse(me.last_seen_at) > Date.parse(before.last_seen_at), "last_seen_at moves on a local tool call");
assert.equal((await person("hb-sub", "builder")).working?.tool, "Bash", "every room the connection is in");
const step = me.working!.step;
hook({ tool_name: "Read", tool_input: { file_path: "/x/src/hub.ts" } }, beat.env as Record<string, string>);
me = await person("hb", "builder");
assert.equal(me.working?.tool, "Read"); assert.equal(me.working?.detail, "/x/src/hub.ts"); assert.equal(me.working?.step, step + 1, "hook steps count up");

// 3. Identity is the connection: seat A's key never marks seat B, and an unknown key marks nobody.
const peerBefore = (await person("hb", "peer")).working;
hook({ tool_name: "Bash", tool_input: { command: "x" } }, beat.env as Record<string, string>);
assert.deepEqual((await person("hb", "peer")).working, peerBefore, "A's hook does not touch B");
const unknown = await (await fetch(`${HTTP}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat_key: "nope", tool: "Bash" }) })).json();
assert.equal(unknown.marked, 0);
assert.equal((await fetch(`${HTTP}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 400);

// 4. Chatroom MCP tools are not double-counted by the hook (they heartbeat hub-side), and a hook with no seat env,
//    garbage input or a dead hub still exits 0 quickly.
const skip = await person("hb", "builder");
hook({ tool_name: "mcp__chatroom__board_get", tool_input: {} }, beat.env as Record<string, string>);
assert.deepEqual((await person("hb", "builder")).working, skip.working);
assert.equal(hook({ tool_name: "Bash" }, {}).status, 0);
assert.equal(spawnSync(process.execPath, [HEARTBEAT_HOOK], { input: "not json", encoding: "utf8" }).status, 0);
const t0 = Date.now();
assert.equal(hook({ tool_name: "Bash" }, { CHATROOM_SEAT_KEY: "k", CHATROOM_HEARTBEAT_URL: "http://127.0.0.1:9/heartbeat" }).status, 0);
assert.ok(Date.now() - t0 < 5_000, "a dead hub does not stall the tool");

// 5. Every MCP tool call is a step hub-side (board_get, room_status used not to move last_seen_at at all).
await b("board_get", { room: "hb" });
assert.equal((await person("hb", "peer")).working?.tool, "board_get");
await b("room_status", { room: "hb" });
assert.equal((await person("hb", "peer")).working?.tool, "room_status");

// 6. A departed seat's key stops marking it (and the old room keeps its last step).
await a("leave_room", { room: "hb-sub", reason: "finished the sub-room test, nothing left" });
const subLast = (await person("hb-sub", "builder")).working;
const marked = await (await fetch(`${HTTP}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat_key: "seat-key-A", tool: "Edit" }) })).json();
assert.equal(marked.marked, 1, "only the room still joined");
assert.deepEqual((await person("hb-sub", "builder")).working, subLast);

// 7. claude -p argv: --settings carries a PreToolUse hook that runs this script (path quoted: the repo path may have spaces),
//    under the lean flags and under --claude-full alike.
for (const full of [false, true]) {
  const args = claudeArgs({ text: "t", mcpJson: "/m.json", tools: ["Bash"], full, settings: heartbeatHookSettings() });
  const s = JSON.parse(args[args.indexOf("--settings") + 1]);
  const cmd: string = s.hooks.PreToolUse[0].hooks[0].command;
  assert.equal(cmd, `node ${JSON.stringify(HEARTBEAT_HOOK)}`);
  assert.equal(s.hooks.PreToolUse[0].matcher, "*");
}
assert.ok(!claudeArgs({ text: "t", mcpJson: "/m.json", tools: [] }).includes("--settings"), "no settings unless asked");

// 8. outputHeartbeat (codex): throttled, last non-empty line as the detail.
const sent: string[] = [];
const out = outputHeartbeat((d) => sent.push(d), 50);
out("exec bash -lc 'npm test'\n\n"); out("second line\n");
assert.deepEqual(sent, ["exec bash -lc 'npm test'"]);
await new Promise((r) => setTimeout(r, 60));
out("  \n"); out("tests passed\n");
assert.deepEqual(sent, ["exec bash -lc 'npm test'", "tests passed"]);

server.kill();
console.log("HEARTBEAT OK");
process.exit(0);
