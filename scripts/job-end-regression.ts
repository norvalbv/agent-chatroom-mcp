/**
 * A seat is told when its job ends (claim/empty-waits follow-up; telemetry gap G8's "done_at"). Run: npx tsx --test scripts/job-end-regression.ts
 *
 * Seats use wait_for_messages as a timer while a job runs ("check the file at most once a minute"). With a held
 * connection an empty wait lasts four minutes, so a job that ends just after a wait began would go unnoticed for that
 * long. The hub already watches each seat's processes (src/hub/memory.ts jobsOf): when one that it had counted as a job
 * is gone, it says so in the seat's rooms, addressed to the seat, which wakes its wait at once, and writes a job_end
 * event (seat, pid, command, ran_s) to the record.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub } from "../src/hub.js";
import { seatHash } from "../src/hub/liveness.js";
import { MemoryWatch, parseTable, type Job } from "../src/hub/memory.js";

Hub.DEFAULT_NUDGE_MS = 0;
const table = (rows: string[]) => parseTable(rows.join("\n"), rows.map((r) => `${r.trim().split(/\s+/)[0]} x CHATROOM_SEAT_KEY=seat-key-AAAA`).join("\n"));
const AGENT = "  100     1 800000    02:00:00 claude -p brief";

test("the watcher reports a job that was running and is gone, once, and not a short tool call", async () => {
  const ticks = [
    table([AGENT, "  103     1 300000       05:00 python3 score_op.py", "  104   100  20000       00:20 python3 quick.py"]),
    table([AGENT, "  103     1 300000       05:15 python3 score_op.py"]),
    table([AGENT]),
    table([AGENT]),
  ];
  const ended: { seat: string; job: Job }[] = [];
  let i = 0;
  const watch = new MemoryWatch({ watched: () => true, table: async () => ticks[i++], footprints: async () => new Map(), onJobEnd: (seat, job) => ended.push({ seat, job }) });
  await watch.tick(); await watch.tick();
  assert.equal(ended.length, 0, "still running; the 20-second script was never a job");
  await watch.tick();
  assert.deepEqual(ended.map((e) => [e.seat === seatHash("seat-key-AAAA"), e.job.pid, e.job.elapsed_s]), [[true, 103, 315]], "gone on this tick: reported with how long it had run when last seen");
  await watch.tick();
  assert.equal(ended.length, 1, "once");
});

test("a job that is a tree of processes is one job and one report (review/304c9538)", async () => {
  // a runner (pid 200) with three workers it started, and a second, unrelated job of the same seat that ends on the same tick
  const tree = ["  200     1 300000       05:00 python3 runner.py", "  201   200 100000       04:58 python3 worker.py 1", "  202   200 100000       04:58 python3 worker.py 2", "  203   200 100000       04:58 python3 worker.py 3", "  300     1 100000       02:00 node score.mjs"];
  const ticks = [table([AGENT, ...tree]), table([AGENT])];
  const ended: { pid: number; others: number }[] = [];
  let i = 0;
  const watch = new MemoryWatch({ watched: () => true, table: async () => ticks[i++], footprints: async () => new Map(), onJobEnd: (_seat, job, others) => ended.push({ pid: job.pid, others }) });
  await watch.tick();
  assert.deepEqual(watch.jobs(seatHash("seat-key-AAAA")).map((j) => j.pid), [200, 300], "the runner and the scorer; the workers are the runner's");
  await watch.tick();
  assert.deepEqual(ended, [{ pid: 200, others: 1 }], "one report: the longest-running, and the other job that ended with it");
});

test("the hub tells the seat in its room, which wakes its wait, and records job_end", async () => {
  const dir = mkdtempSync(join(tmpdir(), "job-end-"));
  try {
    const hub = new Hub({ dataDir: dir });
    hub.bindSeat("seat-key-AAAA", "sess-a");
    const a = hub.join("jobs", "ann", "claude", { requireChallenge: false, nudgeAfterMs: 0, expectedParticipants: 0 }, undefined, "sess-a").participant;
    const b = hub.join("jobs", "bob", "claude", {}, undefined, "sess-b").participant;
    await hub.wait("jobs", a.id, a.lastSeenSeq, 0);
    const seen = hub.getRoom("jobs").messages.at(-1)!.seq;
    const waiting = hub.wait("jobs", a.id, seen, 5000);
    const t = Date.now();
    hub.jobEnded(seatHash("seat-key-AAAA"), { pid: 8148, command: "python3 score_op.py --start 16:15", elapsed_s: 5400 });
    const msgs = await waiting;
    assert.ok(Date.now() - t < 1000, "the seat's wait returns at once, not when its hold ends");
    assert.equal(msgs.length, 1);
    assert.match(msgs[0].content, /^@ann your job has ended: pid 8148 \(python3 score_op\.py --start 16:15\), after 1 h 30 min\./);
    assert.ok(msgs[0].mentions?.includes(a.id), "addressed to the seat, so a hold_until_actionable wait wakes for it too");
    assert.ok(!msgs[0].mentions?.includes(b.id));
    const ev = readFileSync(join(dir, "jobs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type === "job_end");
    assert.deepEqual(ev.map(({ ts, ...e }) => e), [{ type: "job_end", room: "jobs", seat: "ann", pid: 8148, command: "python3 score_op.py --start 16:15", ran_s: 5400, told: true }]);
    // a seat that is not waiting on the hub is inside a tool call of its own (a three-minute test run in the foreground)
    // and has the result already: recorded, not said
    hub.jobEnded(seatHash("seat-key-AAAA"), { pid: 9001, command: "npm test", elapsed_s: 190 });
    assert.equal(hub.getRoom("jobs").messages.filter((m) => /your job has ended/.test(m.content)).length, 1, "no second line");
    const all = readFileSync(join(dir, "jobs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type === "job_end");
    assert.deepEqual(all.map((e) => [e.pid, e.told]), [[8148, true], [9001, false]]);
    // several processes gone on one tick are one line
    const again = hub.wait("jobs", a.id, hub.getRoom("jobs").messages.at(-1)!.seq, 5000);
    hub.jobEnded(seatHash("seat-key-AAAA"), { pid: 200, command: "python3 runner.py", elapsed_s: 300 }, 3);
    assert.match((await again)[0].content, /pid 200 \(python3 runner\.py\), after 5 min, and 3 other processes of yours with it\./);
    // a seat key nobody holds: nothing said, nothing thrown
    hub.jobEnded(seatHash("seat-key-none"), { pid: 1, command: "x", elapsed_s: 100 });
    assert.equal(hub.getRoom("jobs").messages.filter((m) => /your job has ended/.test(m.content)).length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a job that outlives its seat is followed, and the room is told when it ends (bench-facts 2026-10-11)", async () => {
  // the seat's agent (pid 100) dies of the usage limit; the benchmark it detached (pid 103, adopted by launchd) runs on
  const BENCH = "  103     1 300000       40:00 node reviewbench-bench.mts --run h-a1";
  const ticks = [table([AGENT, BENCH]), table([BENCH.replace("40:00", "40:15")]), table([BENCH.replace("40:00", "55:00")]), table([]), table([])];
  const ended: { seat: string; job: Job }[] = [];
  let i = 0, held = true;
  const watch = new MemoryWatch({ watched: () => held, table: async () => ticks[i++], footprints: async () => new Map(), onJobEnd: (seat, job) => ended.push({ seat, job }) });
  await watch.tick();
  held = false; // the participant is marked left: no room holds this seat key any more
  await watch.tick(); await watch.tick();
  assert.equal(ended.length, 0, "still running after its seat left: not reported as ended");
  assert.deepEqual(watch.jobs(seatHash("seat-key-AAAA")), [], "and not a live seat's job");
  await watch.tick();
  assert.deepEqual(ended.map((e) => [e.seat === seatHash("seat-key-AAAA"), e.job.pid, e.job.elapsed_s]), [[true, 103, 3300]], "reported when it ends, with how long it ran");
  await watch.tick();
  assert.equal(ended.length, 1, "once");
});

test("the hub tells the room a departed seat's job has ended, and names it when the seat exits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "job-end-departed-"));
  try {
    const hub = new Hub({ dataDir: dir });
    hub.bindSeat("seat-key-AAAA", "sess-a");
    const a = hub.join("jobs", "ann", "claude", { requireChallenge: false, nudgeAfterMs: 0, expectedParticipants: 0 }, undefined, "sess-a").participant;
    const b = hub.join("jobs", "bob", "claude", {}, undefined, "sess-b").participant;
    const job = { pid: 103, command: "node reviewbench-bench.mts --run h-a1", elapsed_s: 2400 };
    (hub.memory as unknown as { watching: Map<string, Job[]> }).watching.set(seatHash("seat-key-AAAA"), [{ ...job, detached: true }, { pid: 104, command: "python3 -c sleep", elapsed_s: 90 }]);
    hub.recordSeatExit("seat-key-AAAA", "exit 1: usage limit");
    assert.match(hub.getRoom("jobs").messages.at(-1)!.content, /^ann's process exited with a job still counted as running: pid 103 \(node reviewbench-bench\.mts --run h-a1\), 40 min in\. It has no owner now/);
    hub.leave("jobs", a.id, "process exited");
    // a seat that left the room before its process exited is named too: its detached job is just as ownerless
    hub.recordSeatExit("seat-key-AAAA", "exit 0");
    assert.equal(hub.getRoom("jobs").messages.filter((m) => /exited with a job still counted as running: pid 103/.test(m.content)).length, 2);
    const waiting = hub.wait("jobs", b.id, hub.getRoom("jobs").messages.at(-1)!.seq, 5000);
    const t = Date.now();
    hub.jobEnded(seatHash("seat-key-AAAA"), { ...job, elapsed_s: 5400 });
    const msgs = await waiting;
    assert.ok(Date.now() - t < 1000, "a seat waiting in the room hears at once");
    assert.match(msgs[0].content, /^A job ann started before leaving is no longer running: pid 103 \(node reviewbench-bench\.mts --run h-a1\), after 1 h 30 min\. Nobody is waiting on it/);
    const ev = readFileSync(join(dir, "jobs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type === "job_end");
    assert.deepEqual(ev.map(({ ts, ...e }) => e), [{ type: "job_end", room: "jobs", seat: "ann", pid: 103, command: job.command, ran_s: 5400, told: false, departed: true }]);
    // a seat key no room ever held: still nothing said, nothing thrown
    hub.jobEnded(seatHash("seat-key-none"), { pid: 1, command: "x", elapsed_s: 100 });
    assert.equal(hub.getRoom("jobs").messages.filter((m) => /is no longer running/.test(m.content)).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a departed seat's job whose pid number is reused by another process is reported as ended (review/6ecee967)", async () => {
  const BENCH = "  103     1 300000       40:00 node reviewbench-bench.mts --run h-a1";
  // the benchmark ends, and an unrelated process without the seat key later holds pid 103 with a fresh clock
  const other = parseTable("  103     1  20000       00:05 /usr/bin/some-daemon", "");
  const ticks = [table([AGENT, BENCH]), table([BENCH.replace("40:00", "41:00")]), other, other];
  const ended: number[] = [];
  let i = 0, held = true;
  const watch = new MemoryWatch({ watched: () => held, table: async () => ticks[i++], footprints: async () => new Map(), onJobEnd: (_s, job) => ended.push(job.elapsed_s) });
  await watch.tick();
  held = false;
  await watch.tick();
  assert.deepEqual(ended, [], "still the same process: followed");
  await watch.tick();
  assert.deepEqual(ended, [2460], "the pid now belongs to something younger than the job was: the job has ended");
  await watch.tick();
  assert.equal(ended.length, 1, "once, and the other process is not followed");
});

test("what a departed seat ran in the foreground is not followed or announced (dev room swarm-214213-94xp)", async () => {
  // the seat's last tool call (pid 104, a child of its shell) dies with it; its detached benchmark (pid 103) runs on
  const BENCH = "  103     1 300000       40:00 node reviewbench-bench.mts --run h-a1", FG = "  104   100  20000       01:30 python3 -c sleep";
  const ticks = [table([AGENT, BENCH, FG]), table([BENCH]), table([])];
  const ended: number[] = [];
  let i = 0, held = true;
  const watch = new MemoryWatch({ watched: () => held, table: async () => ticks[i++], footprints: async () => new Map(), alive: (pid) => pid === 103, onJobEnd: (_s, job, others) => ended.push(job.pid, others) });
  await watch.tick();
  assert.deepEqual(watch.outliving(seatHash("seat-key-AAAA")).map((j) => j.pid), [103], "only the detached one can outlive the seat");
  held = false;
  await watch.tick();
  assert.deepEqual(ended, [], "the foreground command ended with its seat: nobody is told");
  await watch.tick();
  assert.deepEqual(ended, [103, 0], "the detached job's end is reported, alone");
});

test("a job its seat started directly is its child until the seat exits, and is followed all the same (review/f2dbce54-verifier)", async () => {
  // pid 103 is a child of the agent (pid 100) in every sample taken while the seat lives; launchd adopts it only afterwards
  const CHILD = "  103   100 300000       40:00 node reviewbench-bench.mts --run h-a1", FG = "  104   100  20000       01:30 python3 -c sleep";
  const ticks = [table([AGENT, CHILD, FG]), table([CHILD.replace("  100 ", "    1 ").replace("40:00", "40:15")]), table([CHILD.replace("  100 ", "    1 ").replace("40:00", "55:00")]), table([]), table([])];
  const ended: number[] = [];
  let i = 0, held = true;
  const watch = new MemoryWatch({ watched: () => held, table: async () => ticks[i++], footprints: async () => new Map(), alive: (pid) => pid === 103, onJobEnd: (_s, job, others) => ended.push(job.pid, others) });
  await watch.tick();
  assert.deepEqual(watch.outliving(seatHash("seat-key-AAAA")).map((j) => j.pid), [103], "as the seat exits it is alive, so it is the job the room is told has no owner; the dead foreground command is not");
  held = false;
  await watch.tick();
  await watch.tick();
  assert.deepEqual(ended, [], "still running: nothing said, and the foreground command that died with the seat is nobody's news");
  await watch.tick();
  assert.deepEqual(ended, [103, 0], "its end is reported once it is gone");
  await watch.tick();
  assert.equal(ended.length, 2, "once");
});
