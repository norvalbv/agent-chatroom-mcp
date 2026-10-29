/**
 * The stray sweep: stop every process whose working directory lies under a directory a run owns. Killing a seat
 * reaches only the seat itself; what a seat started in its own process group (a detached dev hub, a background
 * watcher) survives that and, once the seat is gone, is re-parented to init with nothing left to stop it.
 *
 * Moved here unchanged from scripts/pool-run.ts so src/swarm.ts can reuse it (docs/reuse-survey-2026-09-23.md,
 * "Process containment and the stray sweep": keep the lsof-cwd sweep, since macOS has no PID namespaces or
 * cgroups, and reuse it in swarm.ts's timeout and SIGTERM paths). A process that changes directory out of the
 * swept tree escapes it; that is accepted, as it already was in pool-run.
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { runRooms } from "./launch/run-rooms.js";

export const inside = (child: string, parent: string) => child === parent || child.startsWith(parent + sep);
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pids whose working directory lies under dir: seats' background jobs and any dev hub a seat launched, which run in
 * their own process groups and so escape the group kills (devHubRule tells workers on this hub to start one). */
export function pidsUnder(dir: string): number[] {
  const pids = new Set<number>();
  if (existsSync("/proc/self/cwd")) {
    for (const p of readdirSync("/proc").filter((n) => /^\d+$/.test(n))) {
      try { const cwd = readlinkSync(`/proc/${p}/cwd`); if (inside(cwd, dir)) pids.add(Number(p)); } catch {}
    }
  } else {
    let pid = 0;
    const sample = spawnSync("lsof", ["-w", "-d", "cwd", "-Fpn"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 10_000 });
    if (sample.error || sample.status !== 0) throw new Error(`cwd enumeration failed: ${sample.error?.message ?? sample.stderr ?? sample.status}`);
    for (const line of sample.stdout.split("\n")) {
      if (line.startsWith("p")) pid = Number(line.slice(1));
      else if (line.startsWith("n") && inside(line.slice(1), dir)) pids.add(pid);
    }
  }
  pids.delete(process.pid);
  return [...pids];
}

/** SIGTERM, then SIGKILL, every process under dir except `spare`; returns how many distinct processes it stopped. */
export async function stopStrays(dir: string, spare: (number | undefined)[] = [], observe?: (pids: number[]) => void): Promise<number> {
  const stopped = new Set<number>();
  for (let pass = 0; pass < 3; pass++) {
    const found = pidsUnder(dir).filter((p) => !spare.includes(p));
    observe?.(found);
    if (!found.length) break;
    for (const p of found) { stopped.add(p); try { process.kill(p, "SIGTERM"); } catch {} }
    await delay(1000);
    for (const p of pidsUnder(dir).filter((p) => found.includes(p))) { try { process.kill(p, "SIGKILL"); } catch {} }
  }
  return stopped.size;
}

export interface WorktreeSweep {
  path: string;
  scope: "worktree" | "root";
  targeted: number[];
  /** Targeted PIDs confirmed gone by signal 0 returning ESRCH, never merely absent from this cwd. */
  stopped: number;
  stoppedPids: number[];
  escaped: number[];
  unknown: number[];
  /** Absent when enumeration failed: an unknown result must not look empty. */
  remaining?: number[];
  error?: string;
}
export interface StraySweep { reason: string; at: string; worktrees: WorktreeSweep[]; ownershipUnknown?: string[]; error?: string }

/** Run seats and recruits have sibling roots (<run>/<seat>, <room>/<recruit>). Explicit rooms also include
 * parent-linked breakouts from runRooms. Never cross a symlink or a near-prefix sibling belonging to another run. */
export function runWorktreePaths(projects: string[], run: string, rooms: string[] = [], provenWorktrees: string[] = []): { path: string; scope: WorktreeSweep["scope"] }[] {
  const paths = new Map<string, WorktreeSweep["scope"]>();
  for (const project of new Set(projects)) {
    const trees = resolve(project, ".swarm-worktrees");
    if (!existsSync(trees) || !lstatSync(trees).isDirectory()) continue;
    for (const entry of readdirSync(trees, { withFileTypes: true })) {
      if (!entry.isDirectory() || !(entry.name === run || entry.name.startsWith(`${run}-`) || rooms.includes(entry.name))) continue;
      const prefixed = entry.name === run || entry.name.startsWith(`${run}-`);
      const root = realpathSync(resolve(trees, entry.name));
      if (!inside(root, realpathSync(trees))) continue;
      for (const seat of readdirSync(root, { withFileTypes: true })) {
        const path = resolve(root, seat.name);
        if (seat.isDirectory() && (prefixed || provenWorktrees.includes(path))) paths.set(realpathSync(path), "worktree");
      }
      if (prefixed) paths.set(root, "root");
    }
  }
  return [...paths].map(([path, scope]) => ({ path, scope }));
}

/** Leaf worktrees first, then root fallbacks. A failed child stop may be retried by its root; targeted counts
 * are attempts per row. Signal 0 confirms termination; a process that moved cwd remains escaped or unknown. */
export async function sweepRunWorktrees(projects: string[], run: string, rooms: string[] = [], provenWorktrees: string[] = []): Promise<WorktreeSweep[]> {
  const rows: WorktreeSweep[] = [];
  for (const path of runWorktreePaths(projects, run, rooms, provenWorktrees)) {
    const targeted = new Set<number>();
    const row: WorktreeSweep = { ...path, targeted: [], stopped: 0, stoppedPids: [], escaped: [], unknown: [] };
    rows.push(row);
    try {
      await stopStrays(path.path, [], (pids) => pids.forEach(p => targeted.add(p)));
      row.remaining = pidsUnder(path.path);
      for (const pid of targeted) {
        try { process.kill(pid, 0); if (!row.remaining.includes(pid)) row.escaped.push(pid); }
        catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ESRCH") row.stoppedPids.push(pid);
          else row.unknown.push(pid);
        }
      }
      row.stopped = row.stoppedPids.length;
    } catch (e) { row.error = e instanceof Error ? e.message : String(e); }
    row.targeted = [...targeted];
  }
  return rows;
}

/** Same ownership as the report: include parent-linked breakouts while the hub is reachable, with filesystem
 * prefix discovery as the offline fallback. A linked launcher and its canonical checkout may both own roots. */
export async function collectRunSweep(o: { cwd: string; commonDir?: string; startedAt: number; run: string; rooms: string[]; url: string; reason: string; log: (line: string) => void }): Promise<StraySweep> {
  const rooms = [...o.rooms];
  try {
    const response = await fetch(`${o.url}/rooms`, { signal: AbortSignal.timeout(2_000) });
    if (response.ok) rooms.push(...runRooms(await response.json() as { name: string; parent?: string }[], o.run, rooms, o.log));
  } catch { /* filesystem run-prefix discovery also works with the hub down */ }
  const projects = [o.cwd, ...(o.commonDir?.endsWith("/.git") ? [dirname(o.commonDir)] : [])];
  const sweep: StraySweep = { reason: o.reason, at: new Date().toISOString(), worktrees: [] };
  const nonprefixed = rooms.filter(r => r !== o.run && !r.startsWith(`${o.run}-`));
  const proven: string[] = [];
  if (nonprefixed.length) try {
    const response = await fetch(`${o.url}/agents`, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) throw new Error(`agent records HTTP ${response.status}`);
    const agents = await response.json() as { name: string; room: string; startedAt: string; workspace?: { worktree: string; branch: string } }[];
    for (const a of agents) {
      if (!nonprefixed.includes(a.room) || !a.workspace || !(Date.parse(a.startedAt) >= o.startedAt)) continue;
      const path = resolve(a.workspace.worktree), branch = `swarm/${a.room}/${a.name}`;
      if (a.workspace.branch !== branch || !projects.some(p => path === resolve(p, ".swarm-worktrees", a.room, a.name))) continue;
      try {
        if (statSync(path).birthtimeMs < Math.max(o.startedAt, Date.parse(a.startedAt))) continue; // never adopt a directory reused by this spawn
        const actual = spawnSync("git", ["-C", path, "branch", "--show-current"], { encoding: "utf8", timeout: 5_000 });
        if (actual.status === 0 && actual.stdout.trim() === branch) proven.push(path);
      } catch { /* without branch and creation evidence this path stays untouched */ }
    }
    sweep.ownershipUnknown = nonprefixed.filter(room => !proven.some(p => dirname(p).endsWith(`/${room}`)));
  } catch { sweep.ownershipUnknown = nonprefixed; }
  try { sweep.worktrees = await sweepRunWorktrees(projects, o.run, rooms, proven); }
  catch (e) { sweep.error = e instanceof Error ? e.message : String(e); }
  const n = new Set(sweep.worktrees.flatMap(w => w.stoppedPids)).size;
  if (n) o.log(`${o.reason}: stopped ${n} process(es) still running in this run's worktrees`);
  if (sweep.error) o.log(`${o.reason}: stray sweep failed: ${sweep.error}`);
  if (sweep.ownershipUnknown?.length) o.log(`${o.reason}: unproven breakout worktrees left untouched: ${sweep.ownershipUnknown.join(", ")}`);
  for (const w of sweep.worktrees) if (w.error || w.remaining?.length || w.escaped.length || w.unknown.length) o.log(`${o.reason}: stray sweep incomplete in ${w.path}: ${w.error ?? `remaining ${w.remaining!.join(", ")}; escaped ${w.escaped.join(", ")}; unknown ${w.unknown.join(", ")}`}`);
  return sweep;
}
