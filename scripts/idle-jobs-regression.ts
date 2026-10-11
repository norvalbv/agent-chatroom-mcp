/**
 * A room waiting on a job is not a stalled room (evidence pack item 6, telemetry gap G8). Run: npx tsx --test scripts/idle-jobs-regression.ts
 *
 * 5 of the 7 room_idle signals in the last 21 room logs fired while seats were waiting on a scheduled job, and each
 * was answered with "waiting on build2-op scoring (PID 8148, starts 16:15)". In all 7 the hub's memory watcher
 * already held a process a seat had started (0btz-build pid 71199, a python job, through five signals). The idle rule
 * now reads that: a quiet room where a seat has a job running is recorded as waiting (room_waiting, with the seat,
 * pid, command and how long) and is not told it has gone quiet, for up to ROOM_JOB_WAIT_MS; past that it is told, with
 * the job named. A sleep loop is not a job: swarm-094251-5y46, the room the idle signal was built for, must still be told.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub } from "../src/hub.js";
import { ROOM_IDLE_MS, ROOM_JOB_WAIT_MS, checkRoomIdle, type SeatJobs } from "../src/hub/idle.js";
import { seatHash } from "../src/hub/liveness.js";
import { MemoryWatch, jobsOf, parseTable, seatUsage } from "../src/hub/memory.js";

const QUIET = "has gone quiet";
function room3(name: string, dataDir?: string) {
  const hub = new Hub({ dataDir });
  const opts = { requireChallenge: false, nudgeAfterMs: 0, expectedParticipants: 0 };
  const [a, b, c] = ["A", "B", "C"].map((n, i) => hub.join(name, n, "claude", i ? {} : opts, undefined, `s-${name}-${n}`).participant);
  for (const p of [a, b, c]) hub.heartbeat(name, p.id, { tool: "Bash", detail: `python3 first_${p.name}.py` });
  return { hub, room: hub.getRoom(name), a, b, c };
}
function elapse(hub: Hub, name: string, ms: number) {
  const room = hub.getRoom(name);
  const back = (iso: string) => new Date(Date.parse(iso) - ms).toISOString();
  for (const p of room.participants.values()) p.joinedAt = back(p.joinedAt);
  for (const m of room.messages) m.ts = back(m.ts);
  for (const e of room.board.values()) e.updatedAt = back(e.updatedAt);
  room.workAt = (room.workAt ?? []).map((t) => t - ms);
  if (room.idle) room.idle = { ...room.idle, since: back(room.idle.since), toldAt: back(room.idle.toldAt) };
  if (room.waiting) room.waiting = { ...room.waiting, since: back(room.waiting.since) };
}
const lines = (hub: Hub, name: string) => hub.getRoom(name).messages.filter((m) => m.from.id === "system" && m.content.includes(QUIET));
const job = { pid: 8148, command: "python3 score_op.py --start 16:15", elapsed_s: 5400 };
const jobsFor = (name: string, jobs = [job]): SeatJobs => (p) => (p.name === name ? jobs : []);

test("what counts as a job: something a seat started that is not a sleep or the shell around one", () => {
  const plain = [
    "  100     1 800000    02:00:00 claude -p brief",
    "  101   100  20000       10:00 /bin/zsh -c -l source /x/snapshot.sh && eval 'sleep 600' < /dev/null",
    "  102   101    900       10:00 sleep 600",
    "  103     1 300000    01:30:00 /opt/homebrew/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/Resources/Python.app/Contents/MacOS/Python score_op.py --start 16:15",
    "  104   100  20000       00:20 python3 quick.py",
    "  105   100   1000       40:00 tail -f run.log",
    "  200     1 500000    02:00:00 claude -p other",
    "  201   200    900       09:00 sleep 590",
    // review/966debc8, from this machine's live table: a private hub left up for 16.7 h and a recorder 30 h old are not jobs
    "  300     1 500000    20:00:00 claude -p third",
    "  301     1 150000    16:42:00 node dist/index.js",
    "  302     1  90000  1-06:00:00 python3 recorder.py --market all",
    "  303     1  90000    05:59:00 node /x/worktree/dist/hubd.js --always",
    "  304     1  90000    05:59:00 python3 backtest.py --window 12-16",
  ].join("\n");
  const env = ["100 claude CHATROOM_SEAT_KEY=seat-key-AAAA", "101 zsh CHATROOM_SEAT_KEY=seat-key-AAAA", "102 sleep CHATROOM_SEAT_KEY=seat-key-AAAA", "103 Python CHATROOM_SEAT_KEY=seat-key-AAAA",
    "104 python3 CHATROOM_SEAT_KEY=seat-key-AAAA", "105 tail CHATROOM_SEAT_KEY=seat-key-AAAA", "200 claude CHATROOM_SEAT_KEY=seat-key-BBBB", "201 sleep CHATROOM_SEAT_KEY=seat-key-BBBB",
    "300 claude CHATROOM_SEAT_KEY=seat-key-CCCC", "301 node CHATROOM_SEAT_KEY=seat-key-CCCC", "302 python3 CHATROOM_SEAT_KEY=seat-key-CCCC", "303 node CHATROOM_SEAT_KEY=seat-key-CCCC", "304 python3 CHATROOM_SEAT_KEY=seat-key-CCCC"].join("\n");
  const usage = seatUsage(parseTable(plain, env));
  const a = jobsOf(usage.get("seat-key-AAAA")!.own);
  assert.deepEqual(a.map((j) => j.pid), [103], "the scheduled scorer; not the sleep, its shell, a tail, or a 20-second script");
  assert.equal(a[0].elapsed_s, 5400);
  assert.match(a[0].command, /score_op\.py/);
  assert.deepEqual(jobsOf(usage.get("seat-key-BBBB")!.own), [], "a seat in a sleep loop has no job (swarm-094251-5y46)");
  assert.deepEqual(jobsOf(usage.get("seat-key-CCCC")!.own).map((j) => j.pid), [304], "a 6-hour backtest is a job; a hub, its supervisor and a 30-hour recorder are things left running");
});

test("the memory watcher keeps each seat's jobs from the table it already reads", async () => {
  const watch = new MemoryWatch({
    watched: () => true,
    table: async () => parseTable("  100     1 800000    02:00:00 claude -p brief\n  103     1 300000    01:30:00 python3 score_op.py",
      "100 claude CHATROOM_SEAT_KEY=seat-key-AAAA\n103 python3 CHATROOM_SEAT_KEY=seat-key-AAAA"),
    footprints: async () => new Map(),
  });
  await watch.tick();
  assert.deepEqual(watch.jobs(seatHash("seat-key-AAAA")).map((j) => j.pid), [103]);
  assert.deepEqual(watch.jobs(seatHash("seat-key-none")), []);
  assert.deepEqual(watch.jobs(undefined), []);
});

test("a quiet room with a job running is recorded as waiting and not told; when the job ends and nobody picks up, it is", () => {
  const dir = mkdtempSync(join(tmpdir(), "idle-jobs-"));
  try {
    const { hub, room } = room3("jobs-wait", dir);
    elapse(hub, "jobs-wait", ROOM_IDLE_MS + 60_000);
    checkRoomIdle(hub, room, Date.now(), jobsFor("B"));
    assert.equal(lines(hub, "jobs-wait").length, 0, "waiting on B's scorer: no 'gone quiet' line");
    const view = (hub.summary(room) as unknown as { waiting?: { jobs: { seat: string; pid: number; command: string; elapsed_min: number }[] }; idle?: unknown });
    assert.equal(view.idle, undefined);
    assert.deepEqual(view.waiting?.jobs, [{ seat: "B", pid: 8148, command: "python3 score_op.py --start 16:15", elapsed_min: 90 }], "room_status says what the room waits on");
    checkRoomIdle(hub, room, Date.now(), jobsFor("B"));
    const events = () => readFileSync(join(dir, "jobs-wait.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const waits = events().filter((e) => e.type === "room_waiting");
    assert.equal(waits.length, 1, "one event per episode, not one per sweep");
    assert.deepEqual({ state: waits[0].state, steps: waits[0].steps, seats: waits[0].seats, jobs: waits[0].jobs }, { state: "start", steps: 0, seats: 3, jobs: [{ seat: "B", pid: 8148, command: "python3 score_op.py --start 16:15", elapsed_s: 5400 }] });

    // the job ends; half an hour on nobody has done anything with its result
    elapse(hub, "jobs-wait", 40 * 60_000);
    checkRoomIdle(hub, room, Date.now(), jobsFor("nobody"));
    assert.equal(lines(hub, "jobs-wait").length, 1, "no job any more and still quiet: told");
    const end = events().filter((e) => e.type === "room_waiting").at(-1);
    assert.equal(end.state, "end");
    assert.equal(end.waited_min, 40);
    assert.equal(end.then, "idle");
    assert.equal((hub.summary(room) as unknown as { waiting?: unknown }).waiting, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("work resuming ends the wait without a line", () => {
  const { hub, room, a, b, c } = room3("jobs-resume");
  elapse(hub, "jobs-resume", ROOM_IDLE_MS + 60_000);
  checkRoomIdle(hub, room, Date.now(), jobsFor("A"));
  assert.ok(room.waiting);
  for (const p of [a, b, c]) for (let i = 0; i < 6; i++) hub.heartbeat("jobs-resume", p.id, { tool: "Bash", detail: `python3 use_result_${p.name}_${i}.py` });
  checkRoomIdle(hub, room, Date.now(), jobsFor("A"));
  assert.equal(room.waiting, undefined);
  assert.equal(lines(hub, "jobs-resume").length, 0);
});

test("a job is not an excuse for ever: past the wait limit the room is told, with the job named", () => {
  const { hub, room } = room3("jobs-long");
  elapse(hub, "jobs-long", ROOM_IDLE_MS + 60_000);
  checkRoomIdle(hub, room, Date.now(), jobsFor("C"));
  elapse(hub, "jobs-long", ROOM_JOB_WAIT_MS + 60_000);
  checkRoomIdle(hub, room, Date.now(), jobsFor("C", [{ ...job, elapsed_s: job.elapsed_s + ROOM_JOB_WAIT_MS / 1000 }]));
  const [line] = lines(hub, "jobs-long");
  assert.ok(line, "told once the wait has outlasted the limit");
  assert.match(line.content, /C has a job running \(pid 8148, .*score_op\.py.*\)/, "the line names the job, so nobody has to answer 'waiting on PID 8148'");
});

test("the control: the same quiet room with no job is told at once, as before", () => {
  const { hub, room } = room3("jobs-none");
  elapse(hub, "jobs-none", ROOM_IDLE_MS + 60_000);
  checkRoomIdle(hub, room, Date.now(), () => []);
  assert.equal(lines(hub, "jobs-none").length, 1);
  assert.doesNotMatch(lines(hub, "jobs-none")[0].content, /job running/);
});

test("the silence nudge does not tell a room to propose a conclusion while a seat's job is running", async () => {
  const nudged = async (withJob: boolean) => {
    const hub = new Hub({});
    const name = `jobs-nudge-${withJob}`;
    const [a] = ["A", "B"].map((n, i) => hub.join(name, n, "claude", i ? {} : { requireChallenge: false, nudgeAfterMs: 40, expectedParticipants: 0 }, undefined, `s-${name}-${n}`).participant);
    if (withJob) hub.jobsOf = (p) => (p.id === a.id ? [job] : []);
    hub.send(name, a.id, "the scorer has started; its table lands in six minutes", undefined, true);
    await new Promise((r) => setTimeout(r, 150));
    return hub.getRoom(name).messages.filter((m) => m.from.id === "system" && /should propose a conclusion/.test(m.content)).length;
  };
  assert.ok((await nudged(false)) >= 1, "the control: a silent short room with no job is nudged");
  assert.equal(await nudged(true), 0, "waiting on a job is not a discussion that has converged");
});
