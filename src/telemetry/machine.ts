/**
 * Machine stalls: when this machine starves every process on it, the rooms are told (evidence/machine in swarm-073112-zcd7).
 * In swarm-185621-lc0a (live money) the hub's loop lag p50 went from 21 ms to 14.4 s at 19:30-19:38 with its own rss
 * and sessions flat, and the crypto bot's Binance ticks stalled past 1 s in the same minutes (#235): the laptop, not the
 * hub or the network. The hub sampled seat processes only (src/hub/memory.ts), so no room log recorded it and the seats
 * read their own stall as market latency until one of them correlated it by hand.
 * - How: a timer due every PROBE_MS that fires STALL_MS or more late opens an episode (a starved hub is a starved
 *   machine unless the hub itself is busy, so the line carries load and swap to tell the two apart). The episode is
 *   said once when it opens and once when QUIET_MS have passed on time, with its window and worst drift
 *   (arXiv:2003.04824: performance on shared machines moves in regimes; a measurement is only meaningful tagged with its regime).
 * - CHATROOM_MACHINE_WATCH_MS=0 turns the probe off (src/index.ts).
 */
import { execFile } from "node:child_process";
import { cpus, freemem, loadavg, platform } from "node:os";
import type { Hub } from "../hub.js";

export interface MachineSample { load1: number; ncpu: number; swap_used_mb: number | null; free_mb: number }
/** a process among the busiest when a stall began (ps: CPU share is the kernel's decaying average) */
export interface Busy { pid: number; cpu: number; mb: number; command: string }
/** machine: the hub was starved (it used little CPU while late), so every process here was; hub: the hub itself was busy */
export type StallCause = "machine" | "hub";
export type MachineEvent =
  | { kind: "stall_start"; at: string; drift_ms: number; cause: StallCause; hub_cpu: number | null; sample: MachineSample }
  | { kind: "stall_end"; since: string; last_late: string; seconds: number; late_ticks: number; max_drift_ms: number; cause: StallCause; sample: MachineSample; busiest?: Busy[] }
  /** the timers were suspended for minutes: the machine slept (a laptop lid), which is not load */
  | { kind: "sleep"; at: string; slept_s: number; sample: MachineSample };

export const PROBE_MS = 500;
export const STALL_MS = 1000;
export const QUIET_MS = 60_000;
/** a tick this late is a machine that slept, not one that stalled */
export const SLEEP_MS = 300_000;
/** the hub used at least this share of one core across a late tick: the hub was busy, not starved */
export const HUB_BUSY = 0.8;

let swapMb: number | null = null;
let swapAt = 0;
/** Swap in use, refreshed in the background at most once a minute (macOS sysctl; null elsewhere or until the first read). */
function swapUsedMb(): number | null {
  if (platform() === "darwin" && Date.now() - swapAt > 60_000) {
    swapAt = Date.now();
    execFile("sysctl", ["-n", "vm.swapusage"], { timeout: 5_000 }, (err, out) => {
      const m = !err && /used = ([\d.]+)M/.exec(out);
      if (m) swapMb = Math.round(Number(m[1]));
    });
  }
  return swapMb;
}

export function machineSample(): MachineSample {
  return { load1: Math.round(loadavg()[0]! * 10) / 10, ncpu: cpus().length, swap_used_mb: swapUsedMb(), free_mb: Math.round(freemem() / 1048576) };
}

/** The three busiest processes by CPU, from ps; [] when ps fails. */
export function busiest(): Promise<Busy[]> {
  return new Promise((done) => execFile("ps", ["-Ao", "pid=,pcpu=,rss=,comm="], { timeout: 10_000, maxBuffer: 8 << 20 }, (err, out) => {
    if (err) return done([]);
    const rows = out.split("\n").map((l) => /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ pid: Number(m[1]), cpu: Math.round(Number(m[2])), mb: Math.round(Number(m[3]) / 1024), command: m[4]!.split("/").pop()!.slice(0, 60) }))
      .filter((r) => r.pid !== process.pid);
    done(rows.sort((a, b) => b.cpu - a.cpu).slice(0, 3));
  }));
}

export interface MachineWatchOptions {
  onEvent: (e: MachineEvent) => void;
  sample?: () => MachineSample;
  /** what was busy when an episode began, said at its end (lc0a could not tell what held the CPU at 19:28-19:38) */
  busiest?: () => Promise<Busy[]>;
}

export class MachineWatch {
  private open: { since: number; last: number; ticks: number; max: number; cause: StallCause; busiest?: Busy[] } | null = null;
  constructor(private readonly o: MachineWatchOptions) {}
  sample(): MachineSample { return (this.o.sample ?? machineSample)(); }

  /**
   * One probe tick at `nowMs` that fired `driftMs` late, while the hub used `hubCpu` of one core (null: unknown).
   * Returns the event it caused, if any.
   */
  observe(nowMs: number, driftMs: number, hubCpu: number | null = null): MachineEvent | undefined {
    const iso = (t: number) => new Date(t).toISOString();
    let e: MachineEvent | undefined;
    if (driftMs >= SLEEP_MS) {
      // an open episode is not closed by a sleep: it closes after its quiet minute as usual
      e = { kind: "sleep", at: iso(nowMs - driftMs), slept_s: Math.round(driftMs / 1000), sample: this.sample() };
    } else if (driftMs >= STALL_MS) {
      if (!this.open) {
        const cause: StallCause = hubCpu !== null && hubCpu >= HUB_BUSY ? "hub" : "machine";
        const open: NonNullable<MachineWatch["open"]> = { since: nowMs, last: nowMs, ticks: 1, max: driftMs, cause };
        this.open = open;
        if (cause === "machine") void (this.o.busiest ?? busiest)().then((b) => { open.busiest = b; }, () => {});
        e = { kind: "stall_start", at: iso(nowMs), drift_ms: Math.round(driftMs), cause, hub_cpu: hubCpu === null ? null : Math.round(hubCpu * 100) / 100, sample: this.sample() };
      } else {
        this.open.last = nowMs; this.open.ticks++; this.open.max = Math.max(this.open.max, driftMs);
      }
    } else if (this.open && nowMs - this.open.last >= QUIET_MS) {
      const o = this.open;
      this.open = null;
      e = { kind: "stall_end", since: iso(o.since), last_late: iso(o.last), seconds: Math.round((o.last - o.since) / 1000), late_ticks: o.ticks, max_drift_ms: Math.round(o.max), cause: o.cause, sample: this.sample(), ...(o.busiest?.length ? { busiest: o.busiest } : {}) };
    }
    if (e) this.o.onEvent(e);
    return e;
  }

  /** Probe every PROBE_MS; unref'd, so it never keeps a process alive. */
  start(probeMs = PROBE_MS): void {
    // swap is read in the background: start it now, so the first room's baseline has it (dev room 4hkb's had null)
    swapUsedMb();
    let due = Date.now() + probeMs;
    let last = Date.now();
    let cpu = process.cpuUsage();
    const tick = () => {
      const now = Date.now();
      // the hub's own CPU over the interval: busy while late is the hub's doing, idle while late is the machine's
      const used = process.cpuUsage(cpu);
      const share = now > last ? (used.user + used.system) / 1000 / (now - last) : null;
      cpu = process.cpuUsage(); last = now;
      try { this.observe(now, Math.max(0, now - due), share); } catch {}
      due = now + probeMs;
      setTimeout(tick, probeMs).unref();
    };
    setTimeout(tick, probeMs).unref();
  }
}

const hhmmss = (iso: string) => iso.slice(11, 19);
const secs = (ms: number) => `${Math.round(ms / 100) / 10} s`;
const load = (s: MachineSample) => `load ${s.load1} on ${s.ncpu} cores${s.swap_used_mb === null ? "" : `, swap ${s.swap_used_mb} MB used`}`;

/** The room line for an episode: what was measured, what it means for anything timed on this machine, what to do. */
export function machineNotice(e: MachineEvent): string {
  if (e.kind === "sleep") {
    return `MACHINE: this machine slept for ${Math.round(e.slept_s / 60)} min from ${hhmmss(e.at)} UTC (the hub's timers were suspended). ` +
      `A recorder or bot running across that window has a gap there; it is not market silence.`;
  }
  if (e.cause === "hub") {
    if (e.kind === "stall_start") return `MACHINE: the hub itself was busy: its ${PROBE_MS / 1000} s timer fired ${secs(e.drift_ms)} late at ${hhmmss(e.at)} UTC while it used ${Math.round((e.hub_cpu ?? 0) * 100)}% of a core (${load(e.sample)}). Hub replies may lag; processes outside the hub were not necessarily affected.`;
    return `MACHINE: the hub's busy spell from ${hhmmss(e.since)} to ${hhmmss(e.last_late)} UTC is over (worst ${secs(e.max_drift_ms)}).`;
  }
  if (e.kind === "stall_start") {
    return `MACHINE: this machine is stalling: the hub's own ${PROBE_MS / 1000} s timer fired ${secs(e.drift_ms)} late at ${hhmmss(e.at)} UTC (${load(e.sample)}). ` +
      `${e.hub_cpu === null ? "E" : `The hub used ${Math.round(e.hub_cpu * 100)}% of a core meanwhile, so it was starved, not busy: e`}very process on this machine stalls with it, bots and feeds included. A second line says when it is over.`;
  }
  const dur = `${Math.floor(e.seconds / 60)} min ${e.seconds % 60} s`;
  return `MACHINE: the stall from ${hhmmss(e.since)} to ${hhmmss(e.last_late)} UTC is over (${dur}, ${e.late_ticks} late tick${e.late_ticks === 1 ? "" : "s"}, worst ${secs(e.max_drift_ms)}). ` +
    `Now ${load(e.sample)}.${e.busiest?.length ? ` Busiest as it began: ${e.busiest.map((b) => `${b.command} (pid ${b.pid}) ${b.cpu}% CPU, ${b.mb} MB`).join("; ")}.` : ""} A latency, fill time or feed lag measured in that window is this machine's, not the market's: exclude it or measure again. ` +
    `If stalls recur, this machine is a limit of the experiment: write it down as needs/<name> for the owner rather than working around it.`;
}

/**
 * The watch on a hub: each room with an active seat records the machine it opened on (the first tick after it opens)
 * and is told each episode at its start and its end. probeMs 0 returns the watch without starting the probe (tests).
 * Rooms on a long-lived hub stay open after their seats leave, so a room nobody is in is not told.
 */
export function attachMachineWatch(hub: Hub, probeMs = PROBE_MS): MachineWatch {
  const seen = new Set<string>();
  const live = () => [...hub.rooms.values()].filter((r) => (r.state === "open" || r.state === "stalled") && [...r.participants.values()].some((p) => p.active));
  const now = () => new Date().toISOString();
  const watch = new MachineWatch({
    onEvent: (e) => {
      const text = machineNotice(e);
      for (const room of live()) {
        const { kind, ...rest } = e;
        hub.persist({ type: "machine_stall", room: room.name, event: kind === "stall_start" ? "start" : "end", ...rest, ts: now() });
        hub.post(room, "system", undefined, text);
      }
    },
  });
  const observe = watch.observe.bind(watch);
  watch.observe = (nowMs, driftMs, hubCpu = null) => {
    for (const room of live()) {
      if (seen.has(room.name)) continue;
      seen.add(room.name);
      hub.persist({ type: "machine", room: room.name, sample: watch.sample(), ts: now() });
    }
    return observe(nowMs, driftMs, hubCpu);
  };
  if (probeMs > 0) watch.start(probeMs);
  return watch;
}
