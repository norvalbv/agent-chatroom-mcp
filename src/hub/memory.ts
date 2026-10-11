/**
 * Seat memory: what each seat's processes hold, and a budget the hub enforces (swarm-094251-5y46: three seats' scripts
 * held 45.6, 22 and 8.9 GB on a 24 GB machine; in 1,318 recorded shell commands no seat looked at memory once, and
 * nothing in the hub or launcher measured it; board evidence/seat-memory in swarm-003601-tky5).
 * - Whose: every process a seat starts inherits CHATROOM_SEAT_KEY and keeps it after nohup hands it to PID 1, so the
 *   process table groups by seat with no wrapper (as src/hub/caller.ts does for one caller).
 * - How much: the larger of resident size (ps) and footprint (`top`, macOS). Resident size under-reports a process
 *   whose pages are compressed or swapped, which is the case that matters (45.6 GB cannot be resident on 24 GB), and
 *   it does so within a minute for an idle process: measured here, a script that read 800 MB and slept showed 834 MB
 *   resident for 32 s and 11 MB at 48 s with its footprint unchanged at 807 MB; in dev room swarm-010108-n9m2 three
 *   1.2 GB scripts went unseen for 93 s. So the footprint is read on every tick under a budget, and on every
 *   FOOTPRINT_EVERY-th tick when the hub only measures (`top` costs about a second).
 * - The budget (CHATROOM_SEAT_MEMORY_MB, off when unset) is on what the seat started, not on the seat's own agent
 *   process: at WARN_AT of it the seat is told; at the budget the hub stops that seat's largest process by PID and tells
 *   the seat which, how large and what to do instead (arXiv:2602.09345: act on the tool's process, keep the agent, say
 *   the number in words). The OS cannot do this here: macOS refuses RLIMIT_AS, RLIMIT_RSS and RLIMIT_DATA.
 * Never signalled: the seat's agent process, a process without a seat key, a process of a key no participant holds.
 */
import { execFile } from "node:child_process";
import { seatHash } from "./liveness.js";

export interface Proc { pid: number; ppid: number; rssKb: number; elapsedS: number; command: string; key: string | null }
export interface SeatMemory {
  /** what the seat started (its agent process excluded), in MB */
  mb: number;
  /** the seat's own agent process: reported, never counted against the budget and never stopped */
  agent_mb: number;
  processes: number;
  /** the largest process the seat started */
  top: { pid: number; mb: number; command: string } | null;
  /** the highest `mb` seen for this seat */
  peak_mb: number;
  budget_mb: number | null;
  at: string;
}
/** warn: past WARN_AT of the budget. over: past the budget on one sample (stopped on the next unless it shrinks).
 * ended: the process an "over" named exited by itself before the next check (a near miss: nothing was stopped). */
export type MemoryEvent =
  | { kind: "warn" | "over" | "ended"; seat: string; mb: number; budget_mb: number; top: NonNullable<SeatMemory["top"]> }
  | { kind: "stop"; seat: string; mb: number; budget_mb: number; top: NonNullable<SeatMemory["top"]>; signal: "SIGTERM" | "SIGKILL" };
/** Processes carrying a seat key no active participant of this hub holds: a seat that left, or another hub's. Reported, never signalled. */
export interface Unattributed { mb: number; processes: number; top: { pid: number; mb: number; command: string }[] }

export const WARN_AT = 0.7;
/** below this share of the budget a seat may be warned again */
const REARM_AT = 0.5;
/** a process under this share of the budget is not worth stopping: the seat is told its total instead */
const STOP_FLOOR = 0.1;
/** with no budget to enforce, the footprint is read on every this-many-th tick */
const FOOTPRINT_EVERY = 4;
const KEY = /(?:^|\s)CHATROOM_SEAT_KEY=([\w-]{8,100})/;
const mbOf = (kb: number) => Math.round(kb / 1024);

/** `[[dd-]hh:]mm:ss` as ps prints elapsed time, in seconds. */
export function elapsedSeconds(etime: string): number {
  const [days, rest] = etime.includes("-") ? [Number(etime.split("-")[0]), etime.split("-")[1]!] : [0, etime];
  return days * 86_400 + rest.split(":").map(Number).reduce((s, n) => s * 60 + (Number.isFinite(n) ? n : 0), 0);
}

/**
 * The process table from two ps outputs: `ps -Ao pid=,ppid=,rss=,etime=,command=` and, for the seat keys,
 * `ps eww -Ao pid=,command=` (the environment follows the command; the system hides it for its own binaries).
 */
export function parseTable(plain: string, withEnv: string): Proc[] {
  const keys = new Map<number, string>();
  for (const line of withEnv.split("\n")) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    const key = m && KEY.exec(m[2]!)?.[1];
    if (m && key) keys.set(Number(m[1]), key);
  }
  const table: Proc[] = [];
  for (const line of plain.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m) table.push({ pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), elapsedS: elapsedSeconds(m[4]!), command: m[5]!, key: keys.get(Number(m[1])) ?? null });
  }
  return table;
}

/** `top -l 1 -stats pid,mem`: pid -> footprint in KB (resident + compressed + swapped). */
export function parseFootprints(top: string): Map<number, number> {
  const unit: Record<string, number> = { B: 1 / 1024, K: 1, M: 1024, G: 1024 * 1024, T: 1024 * 1024 * 1024 };
  const out = new Map<number, number>();
  for (const line of top.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+(?:\.\d+)?)([BKMGT])[+-]?\s*$/.exec(line);
    if (m) out.set(Number(m[1]), Math.round(Number(m[2]) * unit[m[3]!]!));
  }
  return out;
}

/**
 * Per seat key: the agent process (the oldest process carrying the key: the launcher started it before it could start
 * anything) and what it started. `footprintKb` replaces resident size where known.
 */
export function seatUsage(table: Proc[], footprintKb?: Map<number, number>): Map<string, { agent: Proc; own: (Proc & { kb: number })[]; kb: number; agentKb: number }> {
  const size = (p: Proc) => Math.max(p.rssKb, footprintKb?.get(p.pid) ?? 0);
  const byKey = new Map<string, Proc[]>();
  for (const p of table) if (p.key) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);
  const out = new Map<string, { agent: Proc; own: (Proc & { kb: number })[]; kb: number; agentKb: number }>();
  for (const [key, procs] of byKey) {
    const agent = procs.reduce((a, b) => (b.elapsedS > a.elapsedS || (b.elapsedS === a.elapsedS && b.pid < a.pid) ? b : a));
    const own = procs.filter((p) => p !== agent).map((p) => ({ ...p, kb: size(p) })).sort((a, b) => b.kb - a.kb);
    out.set(key, { agent, own, kb: own.reduce((s, p) => s + p.kb, 0), agentKb: size(agent) });
  }
  return out;
}

/** A process a seat started that is doing or awaiting real work, as the idle rule needs it (src/hub/idle.ts). */
export interface Job { pid: number; command: string; elapsed_s: number }
/** Not jobs: a sleep, the shells around a command, and the tools a seat watches a job with. A seat in a sleep loop is
 * idle (swarm-094251-5y46); one whose scorer starts at 16:15 is waiting (swarm-100951-0btz-build, pid 8148). */
const NOT_A_JOB = /^(?:sleep|sh|bash|zsh|dash|fish|tail|cat|tee|watch|timeout|caffeinate|env|nohup|time)$/;
/** Younger than this it is a tool call still running, which the work ledger already counts as a step. */
export const JOB_MIN_S = 60;
export function jobsOf(own: readonly Proc[]): Job[] {
  return own
    .filter((p) => p.elapsedS >= JOB_MIN_S && !NOT_A_JOB.test((p.command.trim().split(/\s+/)[0] ?? "").replace(/^.*\//, "").replace(/^-/, "")))
    .map((p) => ({ pid: p.pid, command: shownCommand(p.command), elapsed_s: p.elapsedS }))
    .sort((a, b) => b.elapsed_s - a.elapsed_s);
}

const sh = (cmd: string, args: string[], timeout = 5_000) =>
  new Promise<string>((done) => execFile(cmd, args, { encoding: "utf8", timeout, maxBuffer: 64 << 20 }, (_err, out) => done(out ?? "")));

export interface MemoryWatchOptions {
  budgetMb?: number;
  /** seat key hashes the hub should watch: the ones a participant holds */
  watched: (seat: string) => boolean;
  onSample?: (seat: string, memory: SeatMemory) => void;
  onEvent?: (event: MemoryEvent) => void;
  /** test seams */
  table?: () => Promise<Proc[]>;
  footprints?: () => Promise<Map<number, number>>;
  kill?: (pid: number, signal: "SIGTERM" | "SIGKILL") => void;
}

export class MemoryWatch {
  private readonly bySeat = new Map<string, SeatMemory>();
  private readonly jobsBySeat = new Map<string, Job[]>();
  private readonly warned = new Set<string>();
  /** seats whose last sample was over budget: one sample is a thin basis for stopping a job, two in a row is not */
  private readonly over = new Set<string>();
  /** the process each "over" named, until it is stopped or ends by itself */
  private readonly named = new Map<string, NonNullable<SeatMemory["top"]>>();
  private others: Unattributed = { mb: 0, processes: 0, top: [] };
  /** pid the last tick asked to stop, per seat: still there on the next tick means it ignored SIGTERM */
  private readonly asked = new Map<string, number>();
  private running = false;
  private ticks = 0;
  readonly budgetMb: number | null;

  constructor(private readonly o: MemoryWatchOptions) {
    this.budgetMb = o.budgetMb && o.budgetMb > 0 ? o.budgetMb : null;
  }

  get(seat: string | undefined): SeatMemory | undefined { return seat ? this.bySeat.get(seat) : undefined; }
  /** The jobs a seat has running as of the last tick (jobsOf): none for a seat with no key or nothing started. */
  jobs(seat: string | undefined): Job[] { return (seat && this.jobsBySeat.get(seat)) || []; }
  /** What tagged processes of no live seat hold (a recorder a finished room left running, a respawned seat's old script). */
  unattributed(): Unattributed { return this.others; }

  /** One pass over the process table. Never overlaps itself; a failed ps is an empty table, not an error. */
  async tick(): Promise<MemoryEvent[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const table = await (this.o.table ?? (async () => parseTable(await sh("ps", ["-Ao", "pid=,ppid=,rss=,etime=,command="]), await sh("ps", ["eww", "-Ao", "pid=,command="]))))();
      // only when some watched seat has started something: an idle hub does not run top
      const busy = [...seatUsage(table)].some(([key, u]) => u.own.length > 0 && this.o.watched(seatHash(key)));
      const footprint = busy && (this.budgetMb !== null || this.ticks++ % FOOTPRINT_EVERY === 0);
      const usage = seatUsage(table, footprint ? await (this.o.footprints ?? (async () => (process.platform === "darwin" ? parseFootprints(await sh("top", ["-l", "1", "-stats", "pid,mem"], 10_000)) : new Map<number, number>())))() : undefined);
      const events: MemoryEvent[] = [];
      const at = new Date().toISOString();
      const seen = new Set<string>();
      const orphans: (Proc & { kb: number })[] = [];
      for (const [key, u] of usage) {
        const seat = seatHash(key);
        if (!this.o.watched(seat)) { orphans.push({ ...u.agent, kb: u.agentKb }, ...u.own); continue; }
        seen.add(seat);
        this.jobsBySeat.set(seat, jobsOf(u.own));
        const biggest = u.own[0];
        const top = biggest ? { pid: biggest.pid, mb: mbOf(biggest.kb), command: biggest.command.slice(0, 200) } : null;
        const mb = mbOf(u.kb);
        const memory: SeatMemory = { mb, agent_mb: mbOf(u.agentKb), processes: u.own.length, top, peak_mb: Math.max(mb, this.bySeat.get(seat)?.peak_mb ?? 0), budget_mb: this.budgetMb, at };
        this.bySeat.set(seat, memory);
        this.o.onSample?.(seat, memory);
        const pending = this.named.get(seat);
        if (pending && this.budgetMb && !table.some((p) => p.pid === pending.pid)) {
          this.named.delete(seat);
          this.over.delete(seat);
          events.push({ kind: "ended", seat, mb, budget_mb: this.budgetMb, top: pending });
        }
        if (!this.budgetMb || !top) continue;
        if (mb >= this.budgetMb && top.mb >= this.budgetMb * STOP_FLOOR) {
          if (!this.over.has(seat)) {
            this.over.add(seat);
            this.warned.add(seat);
            this.named.set(seat, top);
            events.push({ kind: "over", seat, mb, budget_mb: this.budgetMb, top });
            continue;
          }
          const signal = this.asked.get(seat) === top.pid ? "SIGKILL" : "SIGTERM";
          try { (this.o.kill ?? ((pid, sig) => process.kill(pid, sig)))(top.pid, signal); } catch { continue; }
          this.asked.set(seat, top.pid);
          this.named.delete(seat);
          events.push({ kind: "stop", seat, mb, budget_mb: this.budgetMb, top, signal });
        } else {
          this.asked.delete(seat);
          this.over.delete(seat);
          if (mb >= this.budgetMb * WARN_AT && !this.warned.has(seat)) {
            this.warned.add(seat);
            events.push({ kind: "warn", seat, mb, budget_mb: this.budgetMb, top });
          } else if (mb < this.budgetMb * REARM_AT) this.warned.delete(seat);
        }
      }
      orphans.sort((a, b) => b.kb - a.kb);
      this.others = { mb: mbOf(orphans.reduce((n, p) => n + p.kb, 0)), processes: orphans.length, top: orphans.slice(0, 5).map((p) => ({ pid: p.pid, mb: mbOf(p.kb), command: p.command.slice(0, 200) })) };
      // a seat with nothing running any more reads as 0, not as its last sample
      for (const seat of [...this.jobsBySeat.keys()]) if (!seen.has(seat)) this.jobsBySeat.delete(seat);
      for (const [seat, last] of this.bySeat) {
        if (seen.has(seat)) continue;
        this.over.delete(seat);
        if (last.mb === 0 && !last.top) continue;
        const memory: SeatMemory = { ...last, mb: 0, agent_mb: 0, processes: 0, top: null, at };
        this.bySeat.set(seat, memory);
        this.o.onSample?.(seat, memory);
      }
      for (const e of events) this.o.onEvent?.(e);
      return events;
    } finally {
      this.running = false;
    }
  }
}

/**
 * What the seat is told, in words it can act on: the number, the process, and the cheaper way with the exact setting
 * (the correction arrives when the job fails, not only in a brief). CHATROOM_SEAT_MEMORY_HINT adds a room's own line,
 * e.g. where its helper lives.
 */
/**
 * A command as a seat recognises it: the interpreter's install directory dropped and, past `n` characters, its start and
 * its end kept (the script and its arguments are at the end; two reviewers' seats saw only "…/Contents/MacOS/Py").
 */
export function shownCommand(command: string, n = 140): string {
  const c = command.replace(/^\/(?:[^\s/]+\/)+/, "");
  return c.length <= n ? c : `${c.slice(0, 40)}…${c.slice(c.length - (n - 41))}`;
}

export function memoryNotice(e: MemoryEvent, hint = process.env.CHATROOM_SEAT_MEMORY_HINT ?? ""): string {
  const what = `pid ${e.top.pid} (${e.top.mb} MB): ${shownCommand(e.top.command)}`;
  if (e.kind === "ended") return `MEMORY: ${what}, which was over your ${e.budget_mb} MB budget, ended by itself before the next check. Nothing was stopped; the processes you started now hold ${e.mb} MB.`;
  const limit = Math.max(256, Math.floor((e.budget_mb * 0.6) / 256) * 256);
  const how = `Do not load a whole file: read it in chunks or as a stream. In DuckDB run \`SET memory_limit='${limit}MB'; SET threads=2; SET temp_directory='/tmp/duckdb-spill';\` first (its default is 80% of this machine's RAM for every process). Select only the columns and rows you need, and run one large job at a time. Your budget is in $CHATROOM_SEAT_MEMORY_MB.${hint ? ` ${hint}` : ""}`;
  if (e.kind === "warn") return `MEMORY: the processes you started hold ${e.mb} MB of your ${e.budget_mb} MB budget. Largest: ${what}. Past ${e.budget_mb} MB the hub stops your largest process. ${how}`;
  if (e.kind === "over") return `MEMORY: the processes you started hold ${e.mb} MB, over your ${e.budget_mb} MB budget. Largest: ${what}. It will be stopped at the next check, in a few seconds, unless it shrinks. ${how}`;
  return `MEMORY: the processes you started held ${e.mb} MB, over your ${e.budget_mb} MB budget, so the hub stopped your largest one (${"signal" in e ? e.signal : "SIGTERM"}): ${what}. Nothing else of yours was touched. Rerun it so that it needs less. ${how}`;
}
