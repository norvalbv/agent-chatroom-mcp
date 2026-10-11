/**
 * Why a seat left and why a run ended are in the room record as events, not only as prose (telemetry gaps G4, G5 and the
 * other half of G2; evidence pack item 13: "079m was stopped with SIGTERM and no reason"; 11 exit-143s with no sender).
 * - seat_exit {seat, exit_code, signal, cause, resets_utc, stopped_by}: written from the exit receipt a launcher or the
 *   spawner already posts (POST /heartbeat {exited:true}), before the seat is marked left.
 * - run_end {cause, detail}: posted by the launcher to each of its rooms (POST /rooms/:room/run-end), with one line in
 *   the room; the runs table shows it.
 * Part 1 is the parsing and the hub's record on an in-process hub; part 2 is a served hub over HTTP (its own port, never
 * 7717, stopped by pid). Run: npx tsx scripts/run-end-seat-exit-regression.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { exitCause, exitDetail } from "../src/respawn.js";
import { runRow, renderRunsTable } from "../src/run-timeline.js";
import { parseRoomLog } from "../src/run-metrics.js";
import { ownHubPort } from "./lib/own-hub.js";

// ---------- 1. the cause, parsed once from the receipt's own words ----------
const now = Date.parse("2026-10-11T13:20:00Z");
assert.deepEqual(exitCause(exitDetail(0, "", now)), { exit_code: 0, cause: "normal" });
assert.deepEqual(exitCause(exitDetail(1, "boom", now)), { exit_code: 1, cause: "crash" });
assert.deepEqual(exitCause(exitDetail(null, "", now, "SIGTERM")), { exit_code: null, signal: "SIGTERM", cause: "sigterm" });
assert.deepEqual(exitCause(exitDetail(null, "", now, "SIGKILL")), { exit_code: null, signal: "SIGKILL", cause: "sigkill" });
assert.deepEqual(exitCause("exit 143"), { exit_code: 143, signal: "SIGTERM", cause: "sigterm" }, "128 + 15: a shell reporting the signal as a code");
assert.deepEqual(exitCause("exit 137"), { exit_code: 137, signal: "SIGKILL", cause: "sigkill" });
const limit = exitCause("exit 1: usage limit, resets 14:00 UTC");
assert.deepEqual(limit, { exit_code: 1, cause: "usage_limit", resets_utc: "14:00" });
assert.equal(exitCause("exit 1: compaction thrashing, the compact window is too small").cause, "thrash");
assert.equal(exitCause("something a future launcher says").cause, "unknown");

// ---------- 2. a served hub ----------
const PORT = await ownHubPort(Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000)));
assert.notEqual(PORT, 7717, "never the live hub");
const HTTP = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "run-end-"));
const server = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: String(PORT), CHATROOM_DATA_DIR: dir, CHATROOM_SPAWN_DRY: "1", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_NUDGE_MS: "0" }, stdio: "ignore" });
process.on("exit", () => { server.kill(); rmSync(dir, { recursive: true, force: true }); });
for (let i = 0; ; i++) {
  try { await fetch(`${HTTP}/`); break; } catch { if (i > 150) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); }
}
const ROOM = "run-end-room";
async function connect(seatKey: string, name: string) {
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp?seat=${seatKey}`)));
  const r = (await client.callTool({ name: "join_room", arguments: { room: ROOM, name, agent: "test" } })) as { isError?: boolean; content: { text: string }[] };
  assert.notEqual(r.isError, true, r.content[0]?.text);
}
const post = async (path: string, body: unknown) => {
  const res = await fetch(`${HTTP}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, text: await res.text() };
};
const events = () => parseRoomLog(readFileSync(join(dir, `${ROOM}.jsonl`), "utf8"));

await connect("key-aaaaaaaa", "lead");
await connect("key-bbbbbbbb", "limited");
await connect("key-cccccccc", "stopped");

// a seat that hit the usage limit; a seat the launcher's timeout killed
assert.equal((await post("/heartbeat", { seat_key: "key-bbbbbbbb", exited: true, detail: "exit 1: usage limit, resets 14:00 UTC" })).status, 200);
assert.equal((await post("/heartbeat", { seat_key: "key-cccccccc", exited: true, detail: "stopped by SIGTERM", stopped_by: "timeout" })).status, 200);
// a made-up sender is not recorded: the field is a closed set
assert.equal((await post("/heartbeat", { seat_key: "key-nobody00", exited: true, detail: "exit 0", stopped_by: "<script>" })).status, 200);

const exits = events().filter((e) => e.type === "seat_exit").map(({ ts, room, ...rest }) => rest);
assert.deepEqual(exits, [
  { type: "seat_exit", seat: "limited", exit_code: 1, cause: "usage_limit", resets_utc: "14:00", detail: "exit 1: usage limit, resets 14:00 UTC" },
  { type: "seat_exit", seat: "stopped", exit_code: null, signal: "SIGTERM", cause: "sigterm", stopped_by: "timeout", detail: "stopped by SIGTERM" },
], "one structured event per seat that held a place in the room, none for a key nobody holds");
const order = events().map((e) => (e.type === "seat_exit" ? `exit:${e.seat}` : e.type === "leave" ? `leave:${e.p?.name}` : "")).filter(Boolean);
assert.deepEqual(order, ["exit:limited", "leave:limited", "exit:stopped", "leave:stopped"], "the exit is recorded before the seat is marked left");

// the run ends: the launcher says why, once
assert.equal((await post(`/rooms/${ROOM}/run-end`, { cause: "nonsense" })).status, 400, "cause is a closed set");
assert.equal((await post(`/rooms/${ROOM}/run-end`, { cause: "timeout", detail: "after 480 min" })).status, 200);
assert.equal((await post(`/rooms/${ROOM}/run-end`, { cause: "operator_stop" })).status, 200, "a repeat is accepted and ignored");
assert.equal((await post(`/rooms/no-such-room/run-end`, { cause: "timeout" })).status, 400);
const ends = events().filter((e) => e.type === "run_end");
assert.equal(ends.length, 1, "the first run_end stands");
assert.deepEqual({ cause: ends[0].cause, detail: ends[0].detail }, { cause: "timeout", detail: "after 480 min" });
const line = events().filter((e) => e.type === "message" && e.msg.kind === "system").map((e) => String(e.msg.content)).find((c) => /run .*ended/i.test(c));
assert.match(line ?? "", /timeout/, "one line in the room says the run ended and why");

// the runs table shows it, and the run_end does not lengthen the run
const row = runRow(events());
assert.equal(row.endCause, "timeout");
assert.match(renderRunsTable([row]), /\| timeout \|/);

server.kill();
console.log("run-end-seat-exit-regression: ok");
process.exit(0);
