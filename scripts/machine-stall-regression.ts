/**
 * A machine stall is said in every open room (evidence/machine in swarm-073112-zcd7). In swarm-185621-lc0a (live money,
 * 22 Oct) the hub's event-loop lag p50 went from 21 ms to 14.4 s between 19:30 and 19:38 (data/hub-7717.health.log)
 * while its rss and sessions stayed flat, and in the same minutes the crypto bot's Binance ticks stalled past 1 s
 * (#235, p99 4.6 s): the laptop starved every process on it. The room learnt it by accident 25 min later; nothing in
 * the room log recorded it, because the hub sampled seat processes only. So: a timer-drift probe opens a stall episode
 * at the first tick 1 s late, says it once in each open room, and closes it after 60 s on time with its window and
 * worst drift; a room records the machine it opened on; run-metrics counts episodes. Run: npx tsx scripts/machine-stall-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachMachineWatch, MachineWatch, machineNotice, type MachineEvent, type MachineSample } from "../src/telemetry/machine.js";
import { Hub } from "../src/hub.js";
import { runMetrics, parseRoomLog } from "../src/run-metrics.js";

const sample: MachineSample = { load1: 18.2, ncpu: 10, swap_used_mb: 9966, free_mb: 310 };
const T0 = Date.parse("2026-10-22T19:30:00Z");

// 1. the episode logic, on lc0a's shape: on time, a 3.5 s tick, more late ticks, then on time for over a minute
{
  const events: MachineEvent[] = [];
  const w = new MachineWatch({ onEvent: (e) => events.push(e), sample: () => sample, busiest: async () => [{ pid: 68760, cpu: 92, mb: 2185, command: "Python" }] });
  const ticks: [number, number][] = [[0, 3], [0.5, 4], [4, 3500], [10, 20], [190, 8600], [263, 14400], [326, 5800], [380, 900], [440, 2300], [441, 10], [480, 12], [499, 8], [502, 9]];
  for (const [s, drift] of ticks) { w.observe(T0 + s * 1000, drift); await Promise.resolve(); }
  assert.deepEqual(events.map((e) => e.kind), ["stall_start", "stall_end"], "one episode: a start at the first late tick and one end after 60 s on time");
  const [start, end] = events as [Extract<MachineEvent, { kind: "stall_start" }>, Extract<MachineEvent, { kind: "stall_end" }>];
  assert.equal(start.at, "2026-10-22T19:30:04.000Z");
  assert.equal(start.drift_ms, 3500);
  assert.equal(start.cause, "machine", "no CPU reading: the machine, as before");
  assert.equal(start.from, "2026-10-22T19:30:00.500Z", "the stall began when the late tick was due, not when it fired (dev room 4hkb said 07:50:29 to 07:50:29 for an 8 s freeze from 07:50:21)");
  assert.equal(end.since, "2026-10-22T19:30:00.500Z");
  assert.equal(end.last_late, "2026-10-22T19:37:20.000Z", "the window ends at the last late tick, not when the quiet minute ran out");
  assert.equal(end.max_drift_ms, 14400);
  assert.equal(end.late_ticks, 5, "the 900 ms tick is under the 1 s mark and is not counted");
  assert.equal(end.seconds, 440);
  const said = machineNotice(start);
  assert.match(said, /^MACHINE: this machine is stalling: the hub's own 0\.5 s timer fired 3\.5 s late at 19:30:04 UTC, so it has stalled since 19:30:00 \(load 18\.2 on 10 cores, swap 9966 MB used\)\./);
  assert.match(said, /[Ee]very process on this machine stalls with it, bots and feeds included/);
  const over = machineNotice(end);
  assert.match(over, /^MACHINE: the stall from 19:30:00 to 19:37:20 UTC is over \(7 min 20 s, 5 late ticks, worst 14\.4 s\)\./);
  assert.deepEqual(end.busiest, [{ pid: 68760, cpu: 92, mb: 2185, command: "Python" }], "what was busy as the episode began rides on its end");
  assert.match(over, /Busiest as it began: Python \(pid 68760\) 92% CPU, 2185 MB\./);
  assert.match(over, /A latency, fill time or feed lag measured in that window is this machine's, not the market's/);
  assert.match(over, /needs\/<name>/, "a stall that recurs is a limit of this machine for the owner, not something to work around");
  // the hub's own CPU tells a busy hub from a starved machine
  assert.match(machineNotice({ ...start, hub_cpu: 0.03 }), /The hub used 3% of a core meanwhile, so it was starved, not busy: every process/);
  const busy: MachineEvent[] = [];
  const hw = new MachineWatch({ onEvent: (x) => busy.push(x), sample: () => sample });
  hw.observe(T0, 2500, 0.97);
  hw.observe(T0 + 61_000, 3, 0.1);
  assert.deepEqual(busy.map((x) => [x.kind, "cause" in x ? x.cause : ""]), [["stall_start", "hub"], ["stall_end", "hub"]]);
  assert.match(machineNotice(busy[0]!), /^MACHINE: the hub itself was busy: its 0\.5 s timer fired 2\.5 s late at 19:30:00 UTC while it used 97% of a core/);
  assert.doesNotMatch(machineNotice(busy[1]!), /needs\//, "a busy hub is not a limit of the machine");
  // a laptop that slept is one line, not a stall episode
  const slept: MachineEvent[] = [];
  const sw = new MachineWatch({ onEvent: (x) => slept.push(x), sample: () => sample });
  sw.observe(T0 + 3_600_000, 3_600_000 - 500, 0);
  assert.deepEqual(slept.map((x) => x.kind), ["sleep"]);
  assert.match(machineNotice(slept[0]!), /^MACHINE: this machine slept for 60 min from 19:30:00 UTC/);
  // a second episode opens only after the first has closed
  w.observe(T0 + 600_000, 1500);
  assert.equal(events.length, 3);
  assert.equal(events[2]!.kind, "stall_start");
}

// 2. in the hub: every open room gets the event and one line; a room records the machine it opened on
{
  const dataDir = mkdtempSync(join(tmpdir(), "machine-stall-"));
  try {
    const hub = new Hub({ dataDir });
    hub.join("ms-a", "A", "test", { nudgeAfterMs: 0 }, undefined, "s1");
    hub.join("ms-b", "B", "test", { nudgeAfterMs: 0 }, undefined, "s2");
    hub.join("ms-gone", "C", "test", { nudgeAfterMs: 0 }, undefined, "s3");
    hub.leave("ms-gone", hub.rooms.get("ms-gone")!.participants.values().next().value!.id, "done");
    const watch = attachMachineWatch(hub, 0);
    watch.observe(T0, 2000);
    watch.observe(T0 + 1000, 3000);
    watch.observe(T0 + 62_000, 5);
    const gone = parseRoomLog(readFileSync(join(dataDir, "ms-gone.jsonl"), "utf8"));
    assert.equal(gone.filter((e) => /^machine/.test(e.type)).length, 0, "a room nobody is in any more is not told");
    for (const room of ["ms-a", "ms-b"]) {
      const ev = parseRoomLog(readFileSync(join(dataDir, `${room}.jsonl`), "utf8"));
      const opened = ev.find((e) => e.type === "machine");
      assert.ok(opened, `${room}: the machine it opened on is recorded`);
      assert.ok(opened.sample.ncpu > 0 && typeof opened.sample.load1 === "number");
      assert.deepEqual(ev.filter((e) => e.type === "machine_stall").map((e) => e.event), ["start", "end"], `${room}: both ends of the episode`);
      const lines = ev.filter((e) => e.type === "message" && e.msg.kind === "system" && /^MACHINE:/.test(e.msg.content));
      assert.equal(lines.length, 2, `${room}: one line at the start and one at the end`);
      const m = runMetrics(ev);
      assert.deepEqual(m.machine, { stalls: 1, stalled_s: 3, worst_ms: 3000 }, `${room}: run-metrics counts the episode`);
    }
    // the hub's CPU reaches the episode through the hub's watch too (review/e3f26dee: the wrapper dropped it)
    watch.observe(T0 + 200_000, 2500, 0.95);
    const busy = parseRoomLog(readFileSync(join(dataDir, "ms-a.jsonl"), "utf8")).filter((e) => e.type === "machine_stall").at(-1);
    assert.equal(busy.cause, "hub");
    assert.equal(busy.hub_cpu, 0.95);
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
}
console.log("machine-stall-regression OK");
