/** A hub that starts again tells each room it was serving that it restarted: when, how long the room went without it,
 * and why the last hub stopped, and writes the same as a hub_restart event in the room's record. On 2026-10-10 the
 * room's record simply went silent from 16:28:54 to 16:37:40; nothing in it said the hub had died, and the seats had
 * to be told by the chair (swarm-003601-tky5, evidence/hub-death-cause; owner input C, telemetry for everything).
 * PORT=<free port> npx tsx scripts/restart-notice-regression.ts */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let nextPort = Number(process.env.PORT) || 0;
const freePort = () => new Promise<number>((done) => { const s = createServer(); s.listen(nextPort ? nextPort++ : 0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => done(p)); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const port = await freePort();
const dir = mkdtempSync(join(tmpdir(), "restart-notice-"));
const procs: ChildProcess[] = [];
async function boot(): Promise<ChildProcess> {
  const { CHATROOM_SEAT_KEY: _k, CHATROOM_HEARTBEAT_URL: _h, ...rest } = process.env;
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { ...rest, PORT: String(port), CHATROOM_DATA_DIR: dir, CHATROOM_INSECURE_LOCAL: "1", CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: join(dir, "spawned"), CHATROOM_ALIVE_MS: "500" }, stdio: "ignore" });
  procs.push(child);
  for (let i = 0; i < 150; i++) { try { await fetch(`http://127.0.0.1:${port}/`); return child; } catch { await sleep(200); } }
  throw new Error("hub did not start");
}
async function stop(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  const gone = new Promise((r) => child.on("exit", r));
  child.kill(signal);
  await gone;
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/`); await sleep(200); } catch { return; } }
}
const messages = async (room: string) => {
  const l = (await (await fetch(`http://127.0.0.1:${port}/rooms/${room}/messages?since=0`)).json()) as { kind: string; content: string }[] | { messages?: { kind: string; content: string }[] };
  return Array.isArray(l) ? l : l.messages ?? [];
};
const restartLines = async (room: string) => (await messages(room)).filter((m) => m.kind === "system" && /hub restarted/i.test(m.content));
const record = (room: string) => readFileSync(join(dir, `${room}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);

try {
  let hub = await boot();
  const c = new Client({ name: "seat", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp?seat=k1`)));
  await c.callTool({ name: "join_room", arguments: { room: "live", name: "a", topic: "t" } });
  await c.callTool({ name: "send_message", arguments: { room: "live", content: "working" } });
  // a room nobody is in any more is not told
  const d = new Client({ name: "seat", version: "0" });
  await d.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  await d.callTool({ name: "join_room", arguments: { room: "empty", name: "b", topic: "t" } });
  await d.callTool({ name: "leave_room", arguments: { room: "empty", reason: "done, nothing left" } });
  // the room then goes quiet for a while before the hub dies: the outage is the hub's, not the room's silence
  await sleep(6000);

  // (1) killed outright
  await stop(hub, "SIGKILL");
  hub = await boot();
  let lines = await restartLines("live");
  assert.equal(lines.length, 1, "the room it was serving is told once");
  assert.match(lines[0].content, /hub restarted at \d\d:\d\d:\d\d UTC/i, "when");
  const down = Number(/down for (?:about|at most) (\d+) s/.exec(lines[0].content)?.[1] ?? NaN);
  assert.ok(down >= 0 && down <= 4, `the outage it reports is the hub's own, not the room's 6 s of silence (said: ${lines[0].content.slice(0, 120)})`);
  assert.match(lines[0].content, /left no exit line/, "why the last one stopped, as far as anyone can know");
  assert.match(lines[0].content, /seat/i, "and what a seat does now");
  assert.equal((await restartLines("empty")).length, 0, "a room with nobody in it is not told");
  const ev = record("live").filter((e) => e.type === "hub_restart");
  assert.equal(ev.length, 1, "the record carries a hub_restart event");
  assert.ok(typeof ev[0].down_s === "number" && (ev[0].down_s as number) <= 4, `down_s in the record is the outage (${ev[0].down_s})`);
  assert.match(String(ev[0].previous), /no exit line/);

  // (2) stopped on purpose: the reason the last hub wrote is quoted
  await stop(hub, "SIGTERM");
  hub = await boot();
  lines = await restartLines("live");
  assert.equal(lines.length, 2);
  assert.match(lines[1].content, /SIGTERM/, "a clean stop is named by its reason");

  // the run timeline reads the outages straight from the record (owner input C)
  const { runTimeline, renderTimeline } = await import("../src/run-timeline.js");
  const t = runTimeline(record("live") as never);
  assert.equal((t as { restarts?: unknown[] }).restarts?.length, 2, "the timeline lists both restarts");
  assert.match(renderTimeline(t), /hub restarted at \d\d:\d\d/i, "and prints them");
} finally {
  for (const p of procs) if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
}
console.log("RESTART NOTICE REGRESSION OK");
process.exit(0);
