/**
 * Reaped while alive (decision/reaping-liveness; server-chair-notes 1 and 2; evidence/reaps-7717). The hub closed an MCP
 * session after 30 minutes with no MCP request and the seat left its rooms, though the hub itself held proof the client
 * was alive. In swarm-164210-9f66 bk4, claude-recruit-11 parked on a background job at 23:01, made no call of any kind,
 * was reaped at 23:32, lost its claim to recruit-10, and came back at 00:22 when the job ended; the chair then told every
 * seat to post a status every 15 min to stay alive. Over hub 7717's records and the server's, 15 of 17 seat-taking reaps
 * in open rooms took a live seat (scripts/reap-replay.mjs).
 * Now an idle session is spared while its client shows it is alive: an open GET /mcp stream (an SDK client such as
 * Claude Code holds one per session), a heartbeat for its seat key within the idle window, or that seat's agent process
 * in the hub's process sample. A client with none of these is reaped as before. A chair's idle session is closed but the
 * chair keeps its seat: it is never waited on, and a departed chair cannot be @-named (departed-mention).
 * Each idle episode writes one reap_check event {outcome: spared | reaped | chair_kept, alive_by, waiting_on}.
 * The signals say the CLI is alive, not that it gets anywhere (attack/decision/reaping-liveness 1: a background loop on a
 * file that never appears keeps all three forever): past CHATROOM_SESSION_SPARE_MAX_MS only a running job or a tool call
 * keeps the seat. A spared seat's room gets one line saying it is alive and what it runs.
 * Throwaway hub on its own port (never 7717), idle window shortened by CHATROOM_SESSION_IDLE_MS, dry spawns.
 * Run: npx tsx scripts/reap-liveness-regression.ts
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ownHubPort } from "./lib/own-hub.js";

const PORT = await ownHubPort(Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000)));
assert.notEqual(PORT, 7717, "never the live hub");
const HTTP = `http://127.0.0.1:${PORT}`;
const ROOM = "reap-liveness-room";
// longer than one process sample takes under load (top -l 1: 4 s at load 40), so a seat is sampled once it is in a room
const IDLE_MS = 8_000;
const SPARE_MAX_MS = 20_000;
const dir = mkdtempSync(join(tmpdir(), "reap-liveness-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CHATROOM_")));
const server = spawn("npx", ["tsx", "src/index.ts"], {
  env: { ...env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: join(dir, "spawn"), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: dir,
    CHATROOM_SESSION_IDLE_MS: String(IDLE_MS), CHATROOM_REAP_SWEEP_MS: "250", CHATROOM_MEMORY_WATCH_MS: "1000",
    CHATROOM_SESSION_SPARE_MAX_MS: String(SPARE_MAX_MS), CHATROOM_JOB_MIN_S: "1", CHATROOM_MACHINE_WATCH_MS: "0", CHATROOM_ROOM_IDLE_MS: "0" },
  stdio: ["ignore", "ignore", "inherit"],
});
const children: ChildProcess[] = [];
process.on("exit", () => { server.kill(); for (const c of children) c.kill(); });
for (let i = 0; ; i++) {
  try { await fetch(`${HTTP}/`); break; } catch { if (i > 150) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** stream=false refuses the GET, as a client that never opens the stream (or a per-call script like hubcall.py) */
async function connect(seatKey: string, stream: boolean) {
  const transport = new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp?seat=${seatKey}`), stream ? {} : {
    fetch: (url, init) => (init?.method ?? "GET") === "GET" ? Promise.resolve(new Response(null, { status: 405 })) : fetch(url, init),
  });
  const client = new Client({ name: seatKey, version: "0.0.0" });
  await client.connect(transport);
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: { room: ROOM, ...args } })) as { isError?: boolean; content: { text: string }[] };
    if (res.isError) return { error: res.content[0]?.text ?? "" };
    try { return JSON.parse(res.content[0]?.text ?? ""); } catch { return res.content[0]?.text; }
  };
  return { call, client, transport };
}
const beat = (seat_key: string) => fetch(`${HTTP}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat_key, tool: "Bash", detail: "sleep 30" }) });
const seat = async (name: string) =>
  ((await (await fetch(`${HTTP}/rooms/${ROOM}`)).json()) as { participants: { name: string; active: boolean; left_reason: string | null }[] })
    .participants.find((p) => p.name === name)!;
const events = () => readFileSync(join(dir, `${ROOM}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const checks = (name: string) => events().filter((e) => e.type === "reap_check" && e.name === name);
const notices = (name: string) => events().filter((e) => e.type === "message" && e.msg?.kind === "system" && String(e.msg.content).startsWith(`${name} has made no hub call`));
/** a seat's "agent process": an idle node process carrying its seat key, as a launched claude process does while it waits on
 * a background job with its tool hook silent (not /bin/sleep: macOS ps shows no environment for a platform binary) */
const proc = (key: string, label: string) => {
  const c = spawn(process.execPath, ["-e", `setTimeout(() => {}, 60_000) // ${label}`], { env: { ...env, CHATROOM_SEAT_KEY: key }, stdio: "ignore" });
  children.push(c);
  return c;
};

try {
  // the CLIs of proc and jobber, seen by the hub's process sample before their seats go idle; then, younger than its
  // CLI, the job jobber waits on (the oldest process carrying a key is the agent, memory.ts seatUsage)
  const agent = proc("key-proc-00001", "proc's CLI");
  proc("key-jobber-001", "jobber's CLI");
  await sleep(2_000);
  proc("key-jobber-001", "the seat's test run");
  // the chair creates the room; six seats, each idle from the next call on, with a different signal or none
  const chair = await connect("key-chair-0001", false);
  const joined = await chair.call("join_room", { name: "chair", agent: "test", chair: "chair", role: "chair", expected_participants: 0 });
  assert.ok(joined.participant_id, `chair joined: ${JSON.stringify(joined)}`);
  const streamer = await connect("key-streamer-01", true);
  const beater = await connect("key-beater-001", false);
  const procSeat = await connect("key-proc-00001", false);
  const jobber = await connect("key-jobber-001", false);
  const dead = await connect("key-dead-00001", false);
  const closer = await connect("key-closer-001", true);
  for (const [name, s] of [["streamer", streamer], ["beater", beater], ["proc", procSeat], ["jobber", jobber], ["dead", dead], ["closer", closer]] as const) {
    const r = await s.call("join_room", { name, agent: "test" });
    assert.ok(r.participant_id, `${name} joined: ${JSON.stringify(r)}`);
  }
  const joinedAt = Date.now();
  // closer's client goes away without a DELETE, as a killed CLI does: its GET stream closes with its socket
  await closer.transport.close();

  // an idle window and a few sweeps with no MCP call from anyone; only beater's tool hook keeps beating
  const until = Date.now() + IDLE_MS + 3_000;
  while (Date.now() < until) { await beat("key-beater-001"); await sleep(400); }

  assert.equal((await seat("streamer")).active, true, "an open GET stream says the client is alive: not reaped");
  assert.equal((await seat("beater")).active, true, "a seat whose hook heartbeats is alive: not reaped");
  assert.equal((await seat("proc")).active, true, "a seat whose agent process is in the process table is alive: not reaped");
  assert.equal((await seat("jobber")).active, true, "a seat whose CLI runs a job is alive: not reaped");
  const gone = await seat("dead");
  assert.equal(gone.active, false, "a client with no stream, no heartbeat and no process is still reaped");
  assert.match(gone.left_reason ?? "", /^MCP session closed without leave_room \(idle .*reaped\)/, "the reap keeps its opening words (liveness.away, result.ts)");
  assert.equal((await seat("closer")).active, false, "a client whose stream closed with nothing else alive is reaped");
  assert.equal((await seat("chair")).active, true, "the chair's idle session is closed but the chair keeps its seat");

  // telemetry: one reap_check per idle episode, saying what kept the seat or that nothing did
  const one = (name: string) => { const c = checks(name); assert.equal(c.length, 1, `${name}: one reap_check per idle episode, got ${c.length}`); return c[0]; };
  assert.deepEqual([one("streamer").outcome, one("streamer").alive_by], ["spared", ["stream"]]);
  assert.equal(one("beater").outcome, "spared");
  assert.ok(one("beater").alive_by.includes("heartbeat"), `beater spared by its heartbeat: ${JSON.stringify(one("beater"))}`);
  assert.deepEqual([one("proc").outcome, one("proc").alive_by, one("proc").waiting_on], ["spared", ["process"], []]);
  assert.deepEqual([one("jobber").outcome, one("jobber").alive_by], ["spared", ["process"]]);
  assert.match(one("jobber").waiting_on[0] ?? "", /the seat's test run/, `reap_check names the job the seat waits on: ${JSON.stringify(one("jobber"))}`);
  assert.deepEqual([one("dead").outcome, one("dead").alive_by], ["reaped", []]);
  assert.deepEqual([one("closer").outcome, one("closer").alive_by], ["reaped", []]);
  assert.deepEqual([one("chair").outcome, one("chair").alive_by], ["chair_kept", []]);
  assert.ok(one("streamer").idle_min >= 0 && typeof one("streamer").idle_s === "number", "reap_check carries how long the session was idle");
  // a spared seat's room hears it once per episode, with what it runs; the chair is not announced
  for (const name of ["streamer", "beater", "proc", "jobber"]) assert.equal(notices(name).length, 1, `${name}: one line in the room when spared`);
  assert.match(notices("jobber")[0].msg.content, /client is alive \(process\), running `.*the seat's test run.*`\. It keeps its seat; at 0 min idle with no job and no tool call it is reaped\./);
  assert.match(notices("streamer")[0].msg.content, /client is alive \(stream\), with no job the hub can see/);
  assert.equal(notices("chair").length, 0, "a kept chair is not announced");

  // the kept chair can still be asked: a departed chair would refuse this as departed-mention
  // (asked by proc, whose seat is reaped below anyway: a call starts a new idle episode, and streamer's must run on)
  const asked = await procSeat.call("send_message", { content: "@chair a ruling, please" });
  assert.ok(!asked?.error, `an @-mention of the kept chair is not refused: ${JSON.stringify(asked)}`);
  // and its next call, over a new connection with its old id, puts it back on a live session
  const back = await connect("key-chair-0001", false);
  const rejoined = await back.call("join_room", { name: "chair", agent: "test", participant_id: joined.participant_id });
  assert.equal(rejoined.participant_id, joined.participant_id);

  // once its agent process is gone, a spared seat is reaped like any other
  agent.kill();
  // and past the ceiling a client alive by stream or process alone is reaped; a job or a tool call still keeps a seat
  const ceilingAt = Math.max(Date.now() + IDLE_MS + 3_000, joinedAt + SPARE_MAX_MS + 3_000);
  while (Date.now() < ceilingAt) { await beat("key-beater-001"); await sleep(400); }
  assert.equal((await seat("proc")).active, false, "with its agent process gone and nothing else alive, the seat is reaped");
  assert.deepEqual(checks("proc").map((c) => c.outcome), ["spared", "reaped"]);
  const stuck = await seat("streamer");
  assert.equal(stuck.active, false, "alive by its stream alone, with no job and no tool call past the ceiling: reaped");
  assert.match(stuck.left_reason ?? "", /^MCP session closed without leave_room \(idle \d+ min, client alive by stream but no job and no tool call past the 0 min ceiling, reaped\)$/);
  assert.deepEqual(checks("streamer").map((c) => [c.outcome, c.alive_by, c.past_ceiling ?? false]), [["spared", ["stream"], false], ["reaped", ["stream"], true]]);
  assert.equal((await seat("jobber")).active, true, "a seat whose job is still running is kept past the ceiling");
  assert.deepEqual(checks("jobber").map((c) => c.outcome), ["spared"]);
  assert.equal((await seat("beater")).active, true, "a seat whose hook still beats is kept past the ceiling");
  assert.deepEqual(checks("beater").map((c) => c.outcome), ["spared"]);
  console.log("reap-liveness-regression: ok");
} finally {
  for (const c of children) c.kill();
  // the hub writes its lifecycle lines as it stops: wait for it before removing its data dir
  const stopped = new Promise((r) => server.once("exit", r));
  server.kill();
  await Promise.race([stopped, sleep(5_000)]);
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
