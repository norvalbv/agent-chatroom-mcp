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
    // a seat key nobody holds: nothing said, nothing thrown
    hub.jobEnded(seatHash("seat-key-none"), { pid: 1, command: "x", elapsed_s: 100 });
    assert.equal(hub.getRoom("jobs").messages.filter((m) => /your job has ended/.test(m.content)).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
