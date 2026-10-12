/**
 * A seat that leaves rather than idle through its job names its successor's brief, and the hub starts that successor
 * when the job ends (swarm-211613-dpl4 plan/build-room-waiting; owner's #181: "start a briefed successor when job X ends").
 * Before: the room was told a departed seat's job had stopped ("Nobody is waiting on it") and nothing was started, so a
 * build seat either idled for the hour its benchmark ran or left its result with no reader.
 * Real Hub, real Spawner (dry run: the launch command is built and recorded, no agent process is started).
 * Run: npx tsx scripts/job-wake-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub } from "../src/hub.js";
import { seatHash } from "../src/hub/liveness.js";
import { MemoryWatch, parseTable, type Job } from "../src/hub/memory.js";
import { Spawner } from "../src/spawner.js";
import { attachJobWake } from "../src/spawner/wake.js";

Hub.DEFAULT_NUDGE_MS = 0;
const BRIEF = "Read rounds/a1/status.json and round.log, post the recall table to the room, then write handoff/a1.";
const JOB: Job = { pid: 103, command: "bash round.sh a1", elapsed_s: 2400 };

function room(dir: string) {
  const hub = new Hub({ dataDir: dir });
  const spawner = new Spawner({ mcpUrl: "http://test/mcp", defaultCwd: dir, logDir: join(dir, "logs"), dryRun: true });
  spawner.policy = { ...spawner.policy, agent: "claude", model: undefined };
  spawner.attach({ isHeld: () => false, claimArea: () => {}, ensureRoom: () => {}, announce: (r, t) => { hub.announce(r, t); }, liveAgents: () => 0 });
  attachJobWake(hub, spawner);
  hub.bindSeat("seat-key-AAAA", "sess-a");
  const ann = hub.join("jobs", "ann", "claude", { requireChallenge: false, nudgeAfterMs: 0, expectedParticipants: 0 }, undefined, "sess-a").participant;
  const bob = hub.join("jobs", "bob", "claude", {}, undefined, "sess-b").participant;
  const said = (re: RegExp) => hub.getRoom("jobs").messages.filter((m) => re.test(m.content));
  return { hub, spawner, ann, bob, said };
}
const scratch = async (f: (dir: string) => void | Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), "job-wake-"));
  try { await f(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test("a departed seat's wake/<pid> starts one briefed successor when that job ends, and only once", () => scratch((dir) => {
  const { hub, spawner, ann, said } = room(dir);
  hub.setBoard("jobs", ann.id, "wake/103", BRIEF);
  hub.leave("jobs", ann.id, "round a1 runs about an hour; brief in wake/103");
  assert.equal(spawner.agents.length, 0, "nothing is started while the job runs");
  hub.jobEnded(seatHash("seat-key-AAAA"), { ...JOB, elapsed_s: 5400 });
  assert.equal(spawner.agents.length, 1, "one successor");
  const s = spawner.agents[0];
  assert.equal(s.room, "jobs");
  const prompt = readFileSync(s.log, "utf8");
  assert.ok(prompt.includes(BRIEF), "it is given the departed seat's own words");
  assert.match(prompt, /That job has now ended: pid 103 \(bash round\.sh a1\), after about 90 min/);
  assert.equal(said(new RegExp(`^${s.name} was started by the hub to read the result of ann's job \\(pid 103\\), with the brief in wake/103`)).length, 1, "the room is told who");
  assert.match(hub.getRoom("jobs").board.get("wake/103")!.text, /^\[wake spent: the hub is starting a successor\] Read rounds/);
  const ev = readFileSync(join(dir, "jobs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type === "job_wake");
  assert.deepEqual(ev.map(({ ts, ...e }) => e), [{ type: "job_wake", room: "jobs", seat: "ann", pid: 103, key: "wake/103", successor: s.name }]);
  hub.jobEnded(seatHash("seat-key-AAAA"), { ...JOB, elapsed_s: 5400 });
  assert.equal(spawner.agents.length, 1, "a second report of the same end starts nobody");
}));

test("a seat still in the room when its job ends is told itself; no successor", () => scratch((dir) => {
  const { hub, spawner, ann } = room(dir);
  hub.setBoard("jobs", ann.id, "wake/103", BRIEF);
  hub.jobEnded(seatHash("seat-key-AAAA"), JOB);
  assert.equal(spawner.agents.length, 0);
  assert.equal(hub.getRoom("jobs").board.get("wake/103")!.text, BRIEF, "the entry is not spent: it still holds if the seat leaves before a later job");
}));

test("another seat's wake/ for the pid, a wake/ for another pid, and a departed seat with none start nobody", () => scratch((dir) => {
  const { hub, spawner, ann, bob } = room(dir);
  hub.setBoard("jobs", bob.id, "wake/103", BRIEF);
  hub.setBoard("jobs", ann.id, "wake/999", BRIEF);
  hub.leave("jobs", ann.id, "left");
  hub.jobEnded(seatHash("seat-key-AAAA"), JOB);
  assert.equal(spawner.agents.length, 0);
  assert.equal(hub.getRoom("jobs").board.get("wake/103")!.text, BRIEF, "bob's entry is his own, untouched");
}));

test("a job that ends as one of several of the seat's processes still wakes: the watcher reports every ended pid", () => scratch(async (dir) => {
  const { hub, spawner, ann } = room(dir);
  const table = (rows: string[]) => parseTable(rows.join("\n"), rows.map((r) => `${r.trim().split(/\s+/)[0]} x CHATROOM_SEAT_KEY=seat-key-AAAA`).join("\n"));
  const AGENT = "  100     1 800000    02:00:00 claude -p brief";
  const LONG = "  102     1 300000    01:30:00 node serve-fixtures.js", ROUND = "  103     1 300000       40:00 bash round.sh a1";
  const ticks = [table([AGENT, LONG, ROUND]), table([LONG, ROUND]), table([]), table([])];
  let i = 0, held = true;
  const watch = new MemoryWatch({ watched: () => held, table: async () => ticks[i++], footprints: async () => new Map(), onJobEnd: (seat, job, others, pids) => hub.jobEnded(seat, job, others, pids) });
  hub.setBoard("jobs", ann.id, "wake/103", BRIEF);
  await watch.tick();
  held = false;
  hub.leave("jobs", ann.id, "left");
  await watch.tick();
  await watch.tick();
  assert.equal(spawner.agents.length, 1, "pid 103 was not the longest-running of the two that ended, and its wake still fired");
}));

test("a refused start is said in the room, and the entry is spent so it is not retried into the same refusal", () => scratch((dir) => {
  const { hub, spawner, ann, said } = room(dir);
  hub.setBoard("jobs", ann.id, "wake/103", BRIEF);
  hub.leave("jobs", ann.id, "left");
  process.env.CHATROOM_NO_RECRUIT = "1";
  try { hub.jobEnded(seatHash("seat-key-AAAA"), JOB); } finally { delete process.env.CHATROOM_NO_RECRUIT; }
  assert.equal(spawner.agents.length, 0);
  assert.equal(said(/^No successor was started for wake\/103: Recruitment is disabled.*Whoever is here reads the result of pid 103 instead\.$/).length, 1);
}));

test("a detached shell script shows no seat key in ps; the pid its seat named in wake/ is followed all the same (dev room swarm-214213-94xp)", () => scratch(async (dir) => {
  const { hub, spawner, ann, said } = room(dir);
  // macOS hides the environment of /bin/sh: the row for pid 103 carries no key, and launchd had it before any look
  const rows = (r: string[]) => parseTable(r.join("\n"), "  100 claude -p brief CHATROOM_SEAT_KEY=seat-key-AAAA");
  const AGENT = "  100     1 800000    02:00:00 claude -p brief", SH = "  103     1   2000       05:00 sh ./round.sh a1";
  const ticks = [rows([AGENT, SH]), rows([SH.replace("05:00", "05:15")]), rows([SH.replace("05:00", "45:00")]), rows([]), rows([])];
  let i = 0;
  const o = (hub.memory as unknown as { o: { table: () => Promise<unknown>; footprints: () => Promise<Map<number, number>> } }).o;
  o.table = async () => ticks[i++];
  o.footprints = async () => new Map();
  hub.setBoard("jobs", ann.id, "wake/103", BRIEF);
  await hub.memory.tick();
  assert.deepEqual(hub.memory.jobs(seatHash("seat-key-AAAA")), [], "nothing ties the script to the seat but the board entry");
  hub.leave("jobs", ann.id, "left");
  await hub.memory.tick();
  await hub.memory.tick();
  assert.equal(spawner.agents.length, 0, "still running: nobody started");
  await hub.memory.tick();
  assert.equal(said(/^A job ann started before leaving is no longer running: pid 103 \(sh \.\/round\.sh a1\), after 45 min/).length, 1, "the room is told");
  assert.equal(spawner.agents.length, 1, "and the successor is started");
  await hub.memory.tick();
  assert.equal(spawner.agents.length, 1, "once");
}));

test("a seat still in the room is told when the shell script it named ends", () => scratch(async (dir) => {
  const { hub, spawner, ann, said } = room(dir);
  const rows = (r: string[]) => parseTable(r.join("\n"), "  100 claude -p brief CHATROOM_SEAT_KEY=seat-key-AAAA");
  const AGENT = "  100     1 800000    02:00:00 claude -p brief", SH = "  103     1   2000       05:00 sh ./round.sh a1";
  const ticks = [rows([AGENT, SH]), rows([AGENT])];
  let i = 0;
  const o = (hub.memory as unknown as { o: { table: () => Promise<unknown>; footprints: () => Promise<Map<number, number>> } }).o;
  o.table = async () => ticks[i++];
  o.footprints = async () => new Map();
  hub.setBoard("jobs", ann.id, "wake/103", BRIEF);
  await hub.memory.tick();
  const waiting = hub.wait("jobs", ann.id, hub.getRoom("jobs").messages.at(-1)!.seq, 5000);
  await hub.memory.tick();
  await waiting;
  assert.equal(said(/^@ann your job has ended: pid 103 \(sh \.\/round\.sh a1\)/).length, 1);
  assert.equal(spawner.agents.length, 0);
}));
