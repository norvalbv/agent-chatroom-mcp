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

export interface Proc { pid: number; ppid: number; rssKb: number; elapsedS: number; command: string; key: string | null;
  /** the seat key of its nearest keyed ancestor, when it shows none of its own (macOS hides a system binary's environment).
   * Used for the job signal only: memory accounting and the budget's stop stay on processes that carry the key themselves. */
  inherited?: string }
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
  /** no budget is set, and what the seat started passed the mark: recorded and said, never stopped (telemetry gap G11) */
  | { kind: "high"; seat: string; mb: number; mark_mb: number; top: NonNullable<SeatMemory["top"]> }
  | { kind: "stop"; seat: string; mb: number; budget_mb: number; top: NonNullable<SeatMemory["top"]>; signal: "SIGTERM" | "SIGKILL" };
/** Processes carrying a seat key no active participant of this hub holds: a seat that left, or another hub's. Reported, never signalled. */
export interface Unattributed { mb: number; processes: number; top: { pid: number; mb: number; command: string }[] }

export const WARN_AT = 0.7;
/** With no budget, the size at which a seat's processes are recorded and the seat told (CHATROOM_SEAT_MEMORY_MARK_MB, 0 = off). */
const MARK_MB = process.env.CHATROOM_SEAT_MEMORY_MARK_MB === undefined ? 2000 : Number(process.env.CHATROOM_SEAT_MEMORY_MARK_MB);
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
  // macOS prints no environment for its own binaries (/bin/sh, /bin/zsh, sleep, curl), so a shell script a seat started
  // carried no key and belonged to nobody (the verifier's ./slow_probe.sh; dev room swarm-212818-t3sr). A process with
  // no key of its own is marked with its nearest keyed ancestor's (Proc.inherited).
  const byPid = new Map(table.map((p) => [p.pid, p]));
  for (const p of table) {
    if (p.key) continue;
    for (let up = byPid.get(p.ppid), hops = 0; up && hops < 32; up = byPid.get(up.ppid), hops++) {
      if (keys.has(up.pid)) { p.inherited = keys.get(up.pid)!; break; }
    }
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

const pidAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };
/** Alive and this user's: a seat's job never turns into another user's process, so EPERM means its pid was reused */
export const ownPidAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** A process a seat started that is doing or awaiting real work, as the idle rule needs it (src/hub/idle.ts). */
export interface Job { pid: number; command: string; elapsed_s: number;
  /** launchd has adopted it (ppid 1): it does not end with the seat that started it, as a foreground command does */
  detached?: true }
/** Not jobs: a sleep, the shells around a command, and the tools a seat watches a job with. A seat in a sleep loop is
 * idle (swarm-094251-5y46); one whose scorer starts at 16:15 is waiting (swarm-100951-0btz-build, pid 8148). */
const NOT_A_JOB = /^(?:sleep|sh|bash|zsh|dash|fish|tail|cat|tee|watch|timeout|caffeinate|env|nohup|time)$/;
/** Nor a server a seat left running: a private hub, its supervisor or a launcher never ends, so a room is not waiting on
 * it (review/966debc8: on this machine a 16.7-hour-old dev hub read as a job). */
const A_SERVER = /(?:^|[\s/])(?:dist\/(?:index|hubd|swarm)\.js|src\/(?:index|hubd|swarm)\.ts)(?:\s|$)/;
/** Younger than this it is a tool call still running, which the work ledger already counts as a step. */
export const JOB_MIN_S = 60;
/** Older than this it is not something a room waits on but something left running (the Polymarket lab's recorders were 30
 * hours old in the same review): a run is 8 hours and a scorer scheduled inside it is younger. CHATROOM_JOB_MAX_S. */
export const JOB_MAX_S = Number(process.env.CHATROOM_JOB_MAX_S) > 0 ? Number(process.env.CHATROOM_JOB_MAX_S) : 6 * 3600;
/** A shell that is itself the job: it runs a script file ("/bin/sh ./slow_count.sh", "bash scripts/run.sh"), or it is a
 * "sh -c" the seat sent to the background, which launchd has adopted (ppid 1). The seat's own foreground tool wrapper
 * ("zsh -c ... eval '<command>'", a child of the agent) is neither (devroom/integration-verifier finding 2). */
const SHELL = /^(?:sh|bash|zsh|dash|fish)$/;
function shellJob(p: Proc): boolean {
  const words = p.command.trim().split(/\s+/);
  if (!SHELL.test((words[0] ?? "").replace(/^.*\//, "").replace(/^-/, ""))) return false;
  // -c in any spelling: alone, inside a short-flag cluster ("-lc", how Codex runs every tool call) or after long options
  // ("--norc -c"); long options and other short flags are skipped when looking for the script word (review/3e17117f)
  const isC = (w: string) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(w);
  const first = words.slice(1).find((w) => isC(w) || !/^--?[a-zA-Z][\w-]*$/.test(w));
  if (first === undefined) return false;
  return isC(first) ? p.ppid === 1 : true;
}
export function jobsOf(own: readonly Proc[]): Job[] {
  const jobs = own.filter((p) => p.elapsedS >= JOB_MIN_S && p.elapsedS <= JOB_MAX_S && !A_SERVER.test(p.command) &&
    (shellJob(p) || !NOT_A_JOB.test((p.command.trim().split(/\s+/)[0] ?? "").replace(/^.*\//, "").replace(/^-/, ""))));
  // a job that is a tree of processes is one job: its root (review/304c9538: a runner with three workers ended as four lines)
  const pids = new Set(jobs.map((p) => p.pid));
  return jobs
    .filter((p) => !pids.has(p.ppid))
    .map((p) => ({ pid: p.pid, command: shownCommand(p.command), elapsed_s: p.elapsedS, ...(p.ppid === 1 ? { detached: true as const } : {}) }))
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
  /** a process counted as a seat's job on an earlier tick is gone: with how long it had run when last seen. Several
   * gone on the same tick are one report: the longest-running, and how many others ended with it. */
  /** `pids`: every process of the seat that ended in this look, the reported `job` among them (wake/<pid> is keyed by any of them) */
  onJobEnd?: (seat: string, job: Job, others: number, pids: number[]) => void;
  /** Pids seats have named on the board (wake/<pid>, src/hub/wake.ts), each with its seat. Followed by pid alone: macOS
   * hides the environment of /bin/sh and /bin/bash, so a detached shell script (`nohup sh round.sh &`) shows no seat key,
   * and launchd adopts it before a look can tie it to a keyed ancestor (dev room swarm-214213-94xp: its end was never said). */
  registered?: () => { seat: string; pid: number }[];
  /** whether a process exists now (tests); default: signal 0 */
  alive?: (pid: number) => boolean;
  /** test seams */
  table?: () => Promise<Proc[]>;
  footprints?: () => Promise<Map<number, number>>;
  kill?: (pid: number, signal: "SIGTERM" | "SIGKILL") => void;
}

export class MemoryWatch {
  private readonly bySeat = new Map<string, SeatMemory>();
  private readonly jobsBySeat = new Map<string, Job[]>();
  /** every process once counted as a job and still in the table, so its end is reported even after it stops counting */
  private readonly watching = new Map<string, Job[]>();
  private readonly warned = new Set<string>();
  /** seats whose last sample was over budget: one sample is a thin basis for stopping a job, two in a row is not */
  private readonly over = new Set<string>();
  /** the process each "over" named, until it is stopped or ends by itself */
  private readonly named = new Map<string, NonNullable<SeatMemory["top"]>>();
  private others: Unattributed = { mb: 0, processes: 0, top: [] };
  /** pid the last tick asked to stop, per seat: still there on the next tick means it ignored SIGTERM */
  private readonly asked = new Map<string, number>();
  /** Whose each key-less pid was when last seen under a keyed ancestor, with when it started: a script launchd has
   * since adopted has no keyed ancestor left and no readable environment, and is still that seat's. Dropped when the
   * pid is gone or was reused. */
  private readonly ownerOf = new Map<number, { key: string; startedMs: number }>();
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
  /** The jobs of a seat that can outlive it or have: those launchd had adopted, then any other whose process is alive now.
   * Asked as the seat exits: a job the seat started directly is its child until that moment and shows ppid 1 only in the
   * next sample (review/f2dbce54-verifier), while a foreground command that ended with the seat is gone already. */
  outliving(seat: string | undefined): Job[] {
    const had = (seat && this.watching.get(seat)) || [];
    return [...had.filter((j) => j.detached), ...had.filter((j) => !j.detached && (this.o.alive ?? pidAlive)(j.pid))];
  }

  private reportEnded(seat: string, ended: Job[]): void {
    if (!ended.length) return;
    const [first, ...rest] = [...ended].sort((a, b) => b.elapsed_s - a.elapsed_s);
    this.o.onJobEnd?.(seat, first, rest.length, ended.map((j) => j.pid));
  }

  /** One pass over the process table. Never overlaps itself; a failed ps is an empty table, not an error. */
  async tick(): Promise<MemoryEvent[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const table = await (this.o.table ?? (async () => parseTable(await sh("ps", ["-Ao", "pid=,ppid=,rss=,etime=,command="]), await sh("ps", ["eww", "-Ao", "pid=,command="]))))();
      // (a test's own table is the whole truth unless the test also says what is alive: its pids are made up)
      const confirm = this.o.alive ?? (this.o.table ? () => false : ownPidAlive);
      const nowMs = Date.now();
      for (const p of table) {
        const startedMs = nowMs - p.elapsedS * 1000;
        const was = this.ownerOf.get(p.pid);
        // the same pid with the same start time (to ps's one-second grain, and a little for the tick) is the same process
        if (!p.key && !p.inherited && was && Math.abs(was.startedMs - startedMs) < 5_000) p.inherited = was.key;
        if (!p.key && p.inherited) this.ownerOf.set(p.pid, { key: p.inherited, startedMs });
      }
      for (const { seat, pid } of this.o.registered?.() ?? []) {
        const p = table.find((x) => x.pid === pid);
        if (!p || (this.watching.get(seat) ?? []).some((j) => j.pid === pid)) continue;
        // named by its seat, so its end is news whoever its parent is: it counts as detached from the start
        this.watching.set(seat, [...(this.watching.get(seat) ?? []), { pid, command: shownCommand(p.command), elapsed_s: p.elapsedS, detached: true }]);
      }
      const alivePids = new Set(table.map((p) => p.pid));
      for (const pid of [...this.ownerOf.keys()]) if (!alivePids.has(pid)) this.ownerOf.delete(pid);
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
        // the seat's jobs: what it started with its key showing, and what shows no key but descends from it
        const jobs = jobsOf([...u.own, ...table.filter((p) => !p.key && p.inherited === key)]);
        this.jobsBySeat.set(seat, jobs);
        // gone from the table, not merely too old to count as a job any more: a process still running has not ended
        // and not merely missing from this one look: ps on a loaded machine can return a short table, which on hub 7717 told
        // a seat three times that a job still running had ended (swarm-092526-89rn, pid 87064), so signal 0 has the last word
        const listed = new Set(table.map((p) => p.pid));
        const alive = { has: (pid: number) => listed.has(pid) || confirm(pid) };
        this.reportEnded(seat, (this.watching.get(seat) ?? []).filter((was) => !alive.has(was.pid)));
        this.watching.set(seat, [...jobs, ...(this.watching.get(seat) ?? []).filter((was) => alive.has(was.pid) && !jobs.some((j) => j.pid === was.pid))]);
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
        // no budget: nothing is enforced, but a seat past the mark is recorded and told once per crossing (on hub 7717
        // budget_mb was null and four seats peaked at 2.5-3.5 GB with no event at all)
        if (!this.budgetMb && top && MARK_MB > 0) {
          if (mb >= MARK_MB && !this.warned.has(seat)) { this.warned.add(seat); events.push({ kind: "high", seat, mb, mark_mb: MARK_MB, top }); }
          else if (mb < MARK_MB * REARM_AT) this.warned.delete(seat);
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
      // a seat with nothing left in the table (its agent process included) has no jobs; the ones it had have ended
      for (const [seat, jobs] of [...this.watching]) {
        if (seen.has(seat)) continue;
        // still holding a place, with nothing left in the table: everything it had has ended, as before
        if (this.o.watched(seat)) {
          // the same short table can drop the seat's agent row too (review/5f2f4e41-opus-3): what signal 0 still finds
          // running is kept, not ended
          const running = jobs.filter((was) => table.some((p) => p.pid === was.pid) || confirm(was.pid));
          this.reportEnded(seat, jobs.filter((was) => !running.includes(was)));
          if (running.length) this.watching.set(seat, running); else this.watching.delete(seat);
          this.jobsBySeat.delete(seat);
          continue;
        }
        // a seat that has left: what it ran in the foreground ended with it and is nobody's news (dev room
        // swarm-214212-*: a 90-second command the leaving seat had just run was announced as its job). Only what launchd
        // has adopted is announced.
        // a job that outlives its seat (a detached benchmark whose seat hit the usage limit) is followed until it ends, so
        // the room it was started for hears of it; it is no longer one of a live seat's jobs, and is never signalled
        // nothing but the pid ties a row to a job whose seat is gone, and a round is long enough for the number to come
        // round again (review/6ecee967): a row that has run for less time than the job had is another process
        const same = (was: Job) => table.find((x) => x.pid === was.pid && x.elapsedS >= was.elapsed_s);
        // which it is, is read from each sample after the seat has gone and not only from the last one before: a job the
        // seat started directly was its child until it exited (review/f2dbce54-verifier). So what is still running is
        // kept, and its end is news only once launchd has been seen to hold it.
        this.reportEnded(seat, jobs.filter((was) => was.detached && !same(was)));
        const left = jobs.flatMap((was) => { const p = same(was); return p ? [{ ...was, elapsed_s: p.elapsedS, ...(p.ppid === 1 ? { detached: true as const } : {}) }] : []; });
        if (left.length) this.watching.set(seat, left); else this.watching.delete(seat);
        this.jobsBySeat.delete(seat);
      }
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
  if (e.kind === "high") {
    const what = `pid ${e.top.pid} (${e.top.mb} MB): ${shownCommand(e.top.command)}`;
    return `MEMORY: the processes you started hold ${e.mb} MB, past ${e.mark_mb} MB. Largest: ${what}. No budget is enforced on this hub, so nothing will be stopped, but this machine and its memory are shared: do not load a whole file, read it in chunks or as a stream, and check what a job holds before starting the next.`;
  }
  if (e.kind === "ended") return `MEMORY: ${what}, which was over your ${e.budget_mb} MB budget, ended by itself before the next check. Nothing was stopped; the processes you started now hold ${e.mb} MB.`;
  const limit = Math.max(256, Math.floor((e.budget_mb * 0.6) / 256) * 256);
  const how = `Do not load a whole file: read it in chunks or as a stream. In DuckDB run \`SET memory_limit='${limit}MB'; SET threads=2; SET temp_directory='/tmp/duckdb-spill';\` first (its default is 80% of this machine's RAM for every process). Select only the columns and rows you need, and run one large job at a time. Your budget is in $CHATROOM_SEAT_MEMORY_MB.${hint ? ` ${hint}` : ""}`;
  if (e.kind === "warn") return `MEMORY: the processes you started hold ${e.mb} MB of your ${e.budget_mb} MB budget. Largest: ${what}. Past ${e.budget_mb} MB the hub stops your largest process. ${how}`;
  if (e.kind === "over") return `MEMORY: the processes you started hold ${e.mb} MB, over your ${e.budget_mb} MB budget. Largest: ${what}. It will be stopped at the next check, in a few seconds, unless it shrinks. ${how}`;
  return `MEMORY: the processes you started held ${e.mb} MB, over your ${e.budget_mb} MB budget, so the hub stopped your largest one (${"signal" in e ? e.signal : "SIGTERM"}): ${what}. Nothing else of yours was touched. Rerun it so that it needs less. ${how}`;
}
