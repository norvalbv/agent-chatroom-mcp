/**
 * A hub that blocks its own event loop is not a stalled machine (decision/machine-load, evidence/machine-load).
 * On research-swarm (swarm-164210-9f66, 25 Oct), 6 of the 9 "MACHINE: this machine is stalling ... every process on
 * this machine stalls with it, bots and feeds included" episodes began within 0.5 s of a breakout's creation, all 5
 * breakouts among them. Each time the hub ran `git worktree add` with spawnSync for each recruit, at 1-5% of a core
 * and load 0.7-2.8 on 8 cores; process.cpuUsage() does not count a child's CPU, so the probe read "starved". Measured
 * on this Mac: an independent 20 ms timer stayed at most 17 ms late through 4 batches of 3 worktrees that held the
 * process making them 5.7-12.4 s. On that line the room flagged a live order "machine-adjacent" and the chair stopped
 * spawning during forward tests. Now an idle reference clock on its own thread (jHiccup's control process) says
 * which it was: late with the hub, the machine stalled; on time, the hub blocked itself.
 * Run: npx tsx scripts/machine-blocked-regression.ts
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachMachineWatch, MachineWatch, machineNotice, type MachineEvent, type MachineSample } from "../src/telemetry/machine.js";
import { Hub } from "../src/hub.js";
import { runMetrics, parseRoomLog } from "../src/run-metrics.js";
import { escalationMetrics } from "../src/metrics/escalation-metrics.js";

const sample: MachineSample = { load1: 1.9, ncpu: 8, swap_used_mb: null, free_mb: 27644 };
const T0 = Date.parse("2026-10-25T22:29:25.955Z");
type Start = Extract<MachineEvent, { kind: "stall_start" }>;
type End = Extract<MachineEvent, { kind: "stall_end" }>;
const observe = (w: MachineWatch, ...a: [number, number, number | null, number | null]) =>
  (w.observe as (now: number, drift: number, cpu: number | null, ref: number | null) => MachineEvent | undefined)(...a);

// 1. the episode logic: bk3's 22:29:25 tick (2155 ms late, hub at 5% of a core) with the reference clock on time
{
  const events: MachineEvent[] = [];
  const w = new MachineWatch({ onEvent: (e) => events.push(e), sample: () => sample, busiest: async () => [] });
  observe(w, T0 + 2155, 2155, 0.05, 12);
  observe(w, T0 + 70_000, 4, 0.01, 3);
  assert.deepEqual(events.map((e) => [e.kind, "cause" in e ? e.cause : ""]), [["stall_start", "blocked"], ["stall_end", "blocked"]], "the hub late and its reference clock on time: the hub blocked itself");
  const [start, end] = events as [Start, End];
  assert.equal((start as Start & { ref_drift_ms?: number }).ref_drift_ms, 12, "the start records how late the reference was");
  assert.equal((end as End & { ref_max_drift_ms?: number }).ref_max_drift_ms, 12, "and the end the worst of it over the episode");
  for (const line of [machineNotice(start), machineNotice(end)]) {
    assert.doesNotMatch(line, /every process on this machine stalls/i, "a blocked hub never says every process stalled");
    assert.doesNotMatch(line, /needs\//, "a hub blocking itself is not a limit of the machine for the owner");
  }
  const said = machineNotice(end);
  assert.match(said, /^MACHINE: the hub was blocked from 22:29:25 to 22:29:28 UTC \(worst 2\.2 s\)/);
  assert.match(said, /reference clock[^.]*stayed on time \(worst 12 ms\)/);
  assert.match(said, /this machine did not stall/);
  assert.match(said, /measured outside the hub[^.]*need not be excluded/, "what a seat timing a bot or a feed should do: nothing");

  // the reference late too: the machine, as before
  const m: MachineEvent[] = [];
  const mw = new MachineWatch({ onEvent: (e) => m.push(e), sample: () => sample });
  observe(mw, T0 + 2155, 2155, 0.05, 2080);
  assert.equal((m[0] as Start).cause, "machine", "the reference clock was late as well: every thread here was starved");
  assert.match(machineNotice(m[0]!), /every process on this machine stalls with it/i);
  // no reference (a hub without one, or a log from before it): the machine, as before
  const n: MachineEvent[] = [];
  observe(new MachineWatch({ onEvent: (e) => n.push(e), sample: () => sample }), T0 + 2155, 2155, 0.05, null);
  assert.equal((n[0] as Start).cause, "machine");

  // an episode that opens blocked and then finds the machine stalling says so when it does
  const esc: MachineEvent[] = [];
  const ew = new MachineWatch({ onEvent: (e) => esc.push(e), sample: () => sample });
  observe(ew, T0 + 2000, 2000, 0.03, 9);
  observe(ew, T0 + 9000, 4000, 0.02, 3900);
  observe(ew, T0 + 80_000, 5, 0.01, 2);
  assert.deepEqual(esc.map((e) => [e.kind, "cause" in e ? e.cause : ""]), [["stall_start", "blocked"], ["stall_start", "machine"], ["stall_end", "machine"]], "the machine stalling inside a blocked spell opens the machine's line then");
  assert.equal((esc[1] as Start).from, new Date(T0 + 5000).toISOString(), "from when the late tick was due");
}

// 2. in the hub: a blocked episode is recorded at both ends but said once, at its end; run-metrics counts it apart
{
  const dataDir = mkdtempSync(join(tmpdir(), "machine-blocked-"));
  try {
    const hub = new Hub({ dataDir });
    hub.join("mb-a", "A", "test", { nudgeAfterMs: 0 }, undefined, "s1");
    const watch = attachMachineWatch(hub, 0);
    observe(watch, T0 + 2155, 2155, 0.05, 12);
    observe(watch, T0 + 70_000, 4, 0.01, 3);
    const ev = parseRoomLog(readFileSync(join(dataDir, "mb-a.jsonl"), "utf8"));
    const stalls = ev.filter((e) => e.type === "machine_stall");
    assert.deepEqual(stalls.map((e) => [e.event, e.cause]), [["start", "blocked"], ["end", "blocked"]], "both ends recorded, with the cause");
    assert.equal(stalls[0].ref_drift_ms, 12);
    const lines = ev.filter((e) => e.type === "message" && e.msg.kind === "system" && /^MACHINE:/.test(e.msg.content));
    assert.equal(lines.length, 1, "one line, at the end: nothing in the room has to act on it while it lasts");
    assert.match(lines[0].msg.content, /this machine did not stall/);
    const metrics = runMetrics(ev);
    assert.equal(metrics.machine?.stalls, 0, "a hub that blocked itself is not counted as the machine stalling");
    assert.equal((metrics.machine as { hub_blocks?: number } | undefined)?.hub_blocks, 1, "it is counted as the hub's");
    // nor is it the first evidence that this machine limits the work (the escalation benchmark's scorer)
    const esc = escalationMetrics([{ type: "room", room: "mb" }, ...ev.filter((e) => e.type === "machine_stall")]);
    assert.equal(esc.firstEvidence, undefined, "a blocked hub is not evidence of a machine constraint");
    assert.equal(escalationMetrics([{ type: "room", room: "mb" }, { ...stalls[0], cause: "machine" }]).firstEvidence?.how, "event", "a machine stall still is");
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
}

// 3. live: the hub's own thread blocked in spawnSync, as `git worktree add` did, while the machine is idle
{
  const events: MachineEvent[] = [];
  const w = new MachineWatch({ onEvent: (e) => events.push(e), sample: () => sample, busiest: async () => [] });
  w.start(100);
  await new Promise((r) => setTimeout(r, 600));
  spawnSync("sleep", ["2"]);
  await new Promise((r) => setTimeout(r, 400));
  (w as { stop?: () => void }).stop?.();
  const start = events.find((e): e is Start => e.kind === "stall_start");
  assert.ok(start, "the 2 s block is an episode");
  assert.equal(start.cause, "blocked", "spawnSync blocked only the hub's thread; the reference clock kept time");
  assert.ok(((start as Start & { ref_drift_ms?: number }).ref_drift_ms ?? Infinity) < 1000, "the reference was on time");
}

// 4. live: the whole process starved (SIGSTOP stops every thread, as a starved machine does): still the machine
{
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { MachineWatch } from "./src/telemetry/machine.ts";
    const w = new MachineWatch({ onEvent: (e) => console.log(JSON.stringify(e)), sample: () => ({ load1: 0, ncpu: 1, swap_used_mb: null, free_mb: 0 }), busiest: async () => [] });
    w.start(100);
    setTimeout(() => console.log("ready"), 600);
    setTimeout(() => process.exit(0), 20_000);
  `], { stdio: ["ignore", "pipe", "inherit"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  for (let i = 0; i < 100 && !out.includes("ready"); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(out.includes("ready"), "the child's watch is running");
  process.kill(child.pid!, "SIGSTOP");
  await new Promise((r) => setTimeout(r, 2000));
  process.kill(child.pid!, "SIGCONT");
  let start: Start | undefined;
  for (let i = 0; i < 40 && !start; i++) {
    await new Promise((r) => setTimeout(r, 100));
    start = out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as MachineEvent).find((e): e is Start => e.kind === "stall_start");
  }
  child.kill();
  assert.ok(start, "the 2 s stop is an episode");
  assert.equal(start.cause, "machine", "every thread was stopped, the reference clock too: the machine");
}

console.log("machine-blocked-regression OK");
process.exit(0);
