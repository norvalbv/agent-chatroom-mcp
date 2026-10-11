/**
 * Seat memory: what each seat's processes hold, and a budget the hub enforces (swarm-094251-5y46: three seats' scripts
 * held 45.6, 22 and 8.9 GB on a 24 GB machine; in 1,318 recorded shell commands no seat looked at memory once, and
 * nothing in the hub or launcher measured it; board evidence/seat-memory in swarm-003601-tky5).
 * - Whose: every process a seat starts inherits CHATROOM_SEAT_KEY and keeps it after nohup hands it to PID 1, so the
 *   process table groups by seat with no wrapper (as src/hub/caller.ts does for one caller).
 * - How much: resident size from ps on every tick. Resident size under-reports a process whose pages are compressed or
 *   swapped, which is the case that matters (45.6 GB cannot be resident on 24 GB), so once a seat is near its budget
 *   the figure is the footprint from `top` (macOS; 0.7 s a call, so not on every tick).
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
export type MemoryEvent =
  | { kind: "warn"; seat: string; mb: number; budget_mb: number; top: NonNullable<SeatMemory["top"]> }
  | { kind: "stop"; seat: string; mb: number; budget_mb: number; top: NonNullable<SeatMemory["top"]>; signal: "SIGTERM" | "SIGKILL" };

export const WARN_AT = 0.7;
/** below this share of the budget a seat may be warned again */
const REARM_AT = 0.5;
/** resident size past this share of the budget: read the footprint instead */
const FOOTPRINT_AT = 0.4;
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
  private readonly warned = new Set<string>();
  /** pid the last tick asked to stop, per seat: still there on the next tick means it ignored SIGTERM */
  private readonly asked = new Map<string, number>();
  private running = false;
  readonly budgetMb: number | null;

  constructor(private readonly o: MemoryWatchOptions) {
    this.budgetMb = o.budgetMb && o.budgetMb > 0 ? o.budgetMb : null;
  }

  get(seat: string | undefined): SeatMemory | undefined { return seat ? this.bySeat.get(seat) : undefined; }

  /** One pass over the process table. Never overlaps itself; a failed ps is an empty table, not an error. */
  async tick(): Promise<MemoryEvent[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const table = await (this.o.table ?? (async () => parseTable(await sh("ps", ["-Ao", "pid=,ppid=,rss=,etime=,command="]), await sh("ps", ["eww", "-Ao", "pid=,command="]))))();
      let usage = seatUsage(table);
      const budgetKb = this.budgetMb ? this.budgetMb * 1024 : null;
      const near = budgetKb !== null && [...usage].some(([key, u]) => this.o.watched(seatHash(key)) && u.kb >= budgetKb * FOOTPRINT_AT);
      if (near) usage = seatUsage(table, await (this.o.footprints ?? (async () => (process.platform === "darwin" ? parseFootprints(await sh("top", ["-l", "1", "-stats", "pid,mem"], 10_000)) : new Map<number, number>())))());
      const events: MemoryEvent[] = [];
      const at = new Date().toISOString();
      const seen = new Set<string>();
      for (const [key, u] of usage) {
        const seat = seatHash(key);
        if (!this.o.watched(seat)) continue;
        seen.add(seat);
        const biggest = u.own[0];
        const top = biggest ? { pid: biggest.pid, mb: mbOf(biggest.kb), command: biggest.command.slice(0, 200) } : null;
        const mb = mbOf(u.kb);
        const memory: SeatMemory = { mb, agent_mb: mbOf(u.agentKb), processes: u.own.length, top, peak_mb: Math.max(mb, this.bySeat.get(seat)?.peak_mb ?? 0), budget_mb: this.budgetMb, at };
        this.bySeat.set(seat, memory);
        this.o.onSample?.(seat, memory);
        if (!this.budgetMb || !top) continue;
        if (mb >= this.budgetMb) {
          const signal = this.asked.get(seat) === top.pid ? "SIGKILL" : "SIGTERM";
          try { (this.o.kill ?? ((pid, sig) => process.kill(pid, sig)))(top.pid, signal); } catch { continue; }
          this.asked.set(seat, top.pid);
          events.push({ kind: "stop", seat, mb, budget_mb: this.budgetMb, top, signal });
        } else {
          this.asked.delete(seat);
          if (mb >= this.budgetMb * WARN_AT && !this.warned.has(seat)) {
            this.warned.add(seat);
            events.push({ kind: "warn", seat, mb, budget_mb: this.budgetMb, top });
          } else if (mb < this.budgetMb * REARM_AT) this.warned.delete(seat);
        }
      }
      // a seat with nothing running any more reads as 0, not as its last sample
      for (const [seat, last] of this.bySeat) {
        if (seen.has(seat) || (last.mb === 0 && !last.top)) continue;
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

/** What the seat is told, in words it can act on: the number, the process, and the cheaper way. */
export function memoryNotice(e: MemoryEvent): string {
  const what = `pid ${e.top.pid} (${e.top.mb} MB): ${e.top.command.slice(0, 120)}`;
  const how = "Do not load a whole file: read it in chunks or as a stream; in DuckDB `SET memory_limit='<n>GB'; SET threads=2;` and set a temp_directory so it spills to disk; select only the columns and rows you need; run one large job at a time.";
  if (e.kind === "warn") return `MEMORY: the processes you started hold ${e.mb} MB of your ${e.budget_mb} MB budget. Largest: ${what}. At ${e.budget_mb} MB the hub stops your largest process. ${how}`;
  return `MEMORY: the processes you started held ${e.mb} MB, over your ${e.budget_mb} MB budget, so the hub stopped your largest one (${e.signal}): ${what}. Nothing else of yours was touched. Rerun it so that it needs less. ${how}`;
}
