/**
 * A stale exit line is not the last hub's (merge-review backlog B9e, from docs/self-improvement-swarm-003601-tky5.md).
 * At start the hub read how its predecessor stopped from the last line of hub-<port>.lifecycle.log alone. A second hub
 * started on a taken port logs its own start, dies at listen and writes an exit line; the hub that holds the port keeps
 * running and writes nothing more. When that hub is later killed outright, the last line is still the second hub's
 * exit: the restart notice took its time as "last alive", so an outage of seconds was announced as one of hours, and
 * the alive-stamp that had the true time was never read. The pid file tells the two apart: only the hub that held the
 * port owns it, and it removes it on a clean stop.
 * Run: PORT=<free port> npx tsx scripts/stale-exit-line-regression.ts
 */
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const cases: [string, () => Promise<void> | void][] = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

const PORT = 1;
// two pids that are certainly not running: processes that have already exited
const dead = () => spawnSync(process.execPath, ["-e", ""]).pid!;
const OWNER = dead();
const SECOND = dead();
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** A data directory as an earlier hub left it, then one start of the real lifecycle in a child: what it reports, and its log. */
function start(left: { log: string[]; pid?: number; aliveAt?: number }) {
  const dir = mkdtempSync(join(tmpdir(), "stale-exit-"));
  const file = (name: string) => join(dir, `hub-${PORT}.${name}`);
  writeFileSync(file("lifecycle.log"), left.log.map((l) => `${l}\n`).join(""));
  if (left.pid !== undefined) writeFileSync(file("pid"), `${left.pid}\n`);
  if (left.aliveAt !== undefined) { writeFileSync(file("alive"), `${left.pid ?? 0}\n`); utimesSync(file("alive"), new Date(left.aliveAt), new Date(left.aliveAt)); }
  const code = `import { installLifecycle } from "./src/lifecycle.ts"; const l = installLifecycle({ port: ${PORT}, dir: ${JSON.stringify(dir)} }); console.log(JSON.stringify({ previous: l.previous, lastAlive: l.lastAlive })); process.exit(0);`;
  const child = spawnSync(process.execPath, ["--import", "tsx", "-e", code], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  const said = JSON.parse(child.stdout.trim().split("\n").at(-1)!) as { previous?: string; lastAlive?: number };
  return { ...said, log: readFileSync(file("lifecycle.log"), "utf8") };
}

const now = Date.now();
const startOf = (pid: number, at: number) => `${iso(at)} start pid=${pid} ppid=1 port=${PORT} tty=no`;
const exitOf = (pid: number, at: number, reason: string, code: number) => `${iso(at)} exit pid=${pid} reason=${reason} code=${code} uptime_s=0`;

test("a second hub's exit line is not the outage: the hub that held the port was alive until its stamp", () => {
  const aliveAt = now - 30_000;
  const r = start({
    log: [
      startOf(OWNER, now - 3 * HOUR),
      `${iso(now - 2 * HOUR)} pid=${OWNER} already holds /data/hub-${PORT}.pid and is running`,
      startOf(SECOND, now - 2 * HOUR),
      exitOf(SECOND, now - 2 * HOUR, "uncaughtException: listen EADDRINUSE: address already in use", 1),
    ],
    pid: OWNER, aliveAt,
  });
  assert.ok(r.lastAlive !== undefined && Math.abs(r.lastAlive - aliveAt) < 2_000, `last alive is the stamp, 30 s ago, not the stale exit line two hours ago: ${r.lastAlive === undefined ? "undefined" : `${Math.round((now - r.lastAlive) / 1000)} s ago`}`);
  assert.match(r.previous ?? "", new RegExp(`the last hub \\(pid ${OWNER}\\) left no exit line: it was killed outright`));
  assert.ok(!/EADDRINUSE/.test(r.previous ?? ""), "the second hub's reason is not the last hub's");
  assert.match(r.log, new RegExp(`stale exit line of pid=${SECOND} ignored: pid=${OWNER} held`), "the start says which line it set aside");
});

test("an exit line with a later start after it belongs to an older hub", () => {
  const aliveAt = now - 20_000;
  const r = start({ log: [startOf(SECOND, now - 3 * HOUR), exitOf(SECOND, now - 2 * HOUR, "SIGTERM", 0), startOf(OWNER, now - HOUR)], pid: OWNER, aliveAt });
  assert.ok(r.lastAlive !== undefined && Math.abs(r.lastAlive - aliveAt) < 2_000);
  assert.match(r.previous ?? "", new RegExp(`pid ${OWNER}\\) left no exit line`));
});

test("a clean stop reads as before: the exit line's reason and time", () => {
  const exitAt = now - HOUR;
  const r = start({ log: [startOf(OWNER, now - 2 * HOUR), exitOf(OWNER, exitAt, "SIGTERM", 0)], aliveAt: exitAt - 4_000 });
  assert.equal(r.previous, `the last hub (pid ${OWNER}) stopped: SIGTERM`);
  assert.equal(r.lastAlive, Math.floor(exitAt));
  assert.ok(!/stale exit line/.test(r.log));
});

test("a hub that wrote its exit line but left its pid file is not called killed outright", () => {
  const exitAt = now - HOUR;
  const r = start({ log: [startOf(OWNER, now - 2 * HOUR), exitOf(OWNER, exitAt, "uncaughtException: boom", 1)], pid: OWNER, aliveAt: exitAt - 4_000 });
  assert.equal(r.previous, `the last hub (pid ${OWNER}) stopped: uncaughtException: boom`);
  assert.equal(r.lastAlive, Math.floor(exitAt));
});

test("a hub killed outright with no exit line anywhere reads as before", () => {
  const aliveAt = now - 15_000;
  const r = start({ log: [startOf(OWNER, now - HOUR)], pid: OWNER, aliveAt });
  assert.match(r.previous ?? "", new RegExp(`pid ${OWNER}\\) left no exit line`));
  assert.ok(r.lastAlive !== undefined && Math.abs(r.lastAlive - aliveAt) < 2_000);
});

test("real hubs: a second start on the taken port, then the first is killed; the room is told the outage it had", async () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const port = await new Promise<number>((done) => { const s = createServer(); s.listen(Number(process.env.PORT) || 0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => done(p)); }); });
  const dir = mkdtempSync(join(tmpdir(), "stale-exit-hub-"));
  const { CHATROOM_SEAT_KEY: _k, CHATROOM_HEARTBEAT_URL: _h, ...rest } = process.env;
  const hub = () => spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { ...rest, PORT: String(port), CHATROOM_DATA_DIR: dir, CHATROOM_INSECURE_LOCAL: "1", CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: join(dir, "spawned"), CHATROOM_ALIVE_MS: "500" }, stdio: "ignore" });
  const up = async () => { for (let i = 0; i < 150; i++) { try { await fetch(`http://127.0.0.1:${port}/`); return; } catch { await sleep(200); } } throw new Error("hub did not start"); };
  const procs: ChildProcess[] = [];
  try {
    const first = hub();
    procs.push(first);
    await up();
    const c = new Client({ name: "seat", version: "0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp?seat=k1`)));
    await c.callTool({ name: "join_room", arguments: { room: "live", name: "a", topic: "t" } });
    await c.callTool({ name: "send_message", arguments: { room: "live", content: "working" } });
    // a second hub on the same port and data directory: it dies at listen and leaves the log's last line
    const second = hub();
    procs.push(second);
    await new Promise((r) => second.on("exit", r));
    const log = () => readFileSync(join(dir, `hub-${port}.lifecycle.log`), "utf8");
    assert.match(log().trimEnd().split("\n").at(-1)!, new RegExp(`exit pid=${second.pid} `), "the second hub's exit is the last line of the log");
    // the first hub serves on for a while, then is killed outright
    await sleep(10_000);
    const gone = new Promise((r) => first.on("exit", r));
    const killedAt = Date.now();
    first.kill("SIGKILL");
    await gone;
    procs.push(hub());
    await up();
    const ev = readFileSync(join(dir, "live.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; ts: string; down_s: number; previous?: string }).filter((e) => e.type === "hub_restart");
    // the third hub's event is the last one in the record
    const told = ev.at(-1) ?? assert.fail("no hub_restart event in the room's record");
    // however long this machine took to start the third hub, the outage began at the kill, not ten seconds before it
    const real = (Date.parse(told.ts) - killedAt) / 1000;
    assert.ok(told.down_s <= real + 3, `down_s ${told.down_s} is the outage since the kill (${real.toFixed(1)} s), not since the second hub's exit`);
    assert.match(String(told.previous), new RegExp(`pid ${first.pid}\\) left no exit line`));
    assert.match(log(), new RegExp(`stale exit line of pid=${second.pid} ignored`));
  } finally {
    for (const p of procs) if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
  }
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).message.split("\n")[0]}`);
  }
}
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nSTALE EXIT LINE OK (${cases.length} cases)`);
process.exit(failed ? 1 : 0);
