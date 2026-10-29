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
import { existsSync, lstatSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
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
  /** Targeted PIDs no longer observed under this path, never an attempted-signal count. */
  stopped: number;
  stoppedPids: number[];
  /** Absent when enumeration failed: an unknown result must not look empty. */
  remaining?: number[];
  error?: string;
}
export interface StraySweep { reason: string; at: string; worktrees: WorktreeSweep[]; error?: string }

/** Run seats and recruits have sibling roots (<run>/<seat>, <room>/<recruit>). Explicit rooms also include
 * parent-linked breakouts from runRooms. Never cross a symlink or a near-prefix sibling belonging to another run. */
export function runWorktreePaths(projects: string[], run: string, rooms: string[] = []): { path: string; scope: WorktreeSweep["scope"] }[] {
  const paths = new Map<string, WorktreeSweep["scope"]>();
  for (const project of new Set(projects)) {
    const trees = resolve(project, ".swarm-worktrees");
    if (!existsSync(trees) || !lstatSync(trees).isDirectory()) continue;
    for (const entry of readdirSync(trees, { withFileTypes: true })) {
      if (!entry.isDirectory() || !(entry.name === run || entry.name.startsWith(`${run}-`) || rooms.includes(entry.name))) continue;
      const root = realpathSync(resolve(trees, entry.name));
      if (!inside(root, realpathSync(trees))) continue;
      for (const seat of readdirSync(root, { withFileTypes: true })) {
        if (seat.isDirectory()) paths.set(realpathSync(resolve(root, seat.name)), "worktree");
      }
      paths.set(root, "root");
    }
  }
  return [...paths].map(([path, scope]) => ({ path, scope }));
}

/** Leaf worktrees first, then root fallbacks. A failed child stop may be retried by its root; targeted counts
 * are attempts per row, while stoppedPids are observed removals, so a failed signal is never reported as a stop. */
export async function sweepRunWorktrees(projects: string[], run: string, rooms: string[] = []): Promise<WorktreeSweep[]> {
  const rows: WorktreeSweep[] = [];
  for (const path of runWorktreePaths(projects, run, rooms)) {
    const targeted = new Set<number>();
    const row: WorktreeSweep = { ...path, targeted: [], stopped: 0, stoppedPids: [] };
    rows.push(row);
    try {
      await stopStrays(path.path, [], (pids) => pids.forEach(p => targeted.add(p)));
      row.remaining = pidsUnder(path.path);
      row.stoppedPids = [...targeted].filter(p => !row.remaining!.includes(p));
      row.stopped = row.stoppedPids.length;
    } catch (e) { row.error = e instanceof Error ? e.message : String(e); }
    row.targeted = [...targeted];
  }
  return rows;
}

/** Same ownership as the report: include parent-linked breakouts while the hub is reachable, with filesystem
 * prefix discovery as the offline fallback. A linked launcher and its canonical checkout may both own roots. */
export async function collectRunSweep(o: { cwd: string; commonDir?: string; run: string; rooms: string[]; url: string; reason: string; log: (line: string) => void }): Promise<StraySweep> {
  const rooms = [...o.rooms];
  try {
    const response = await fetch(`${o.url}/rooms`, { signal: AbortSignal.timeout(2_000) });
    if (response.ok) rooms.push(...runRooms(await response.json() as { name: string; parent?: string }[], o.run, rooms, o.log));
  } catch { /* filesystem run-prefix discovery also works with the hub down */ }
  const projects = [o.cwd, ...(o.commonDir?.endsWith("/.git") ? [dirname(o.commonDir)] : [])];
  const sweep: StraySweep = { reason: o.reason, at: new Date().toISOString(), worktrees: [] };
  try { sweep.worktrees = await sweepRunWorktrees(projects, o.run, rooms); }
  catch (e) { sweep.error = e instanceof Error ? e.message : String(e); }
  const n = new Set(sweep.worktrees.flatMap(w => w.stoppedPids)).size;
  if (n) o.log(`${o.reason}: stopped ${n} process(es) still running in this run's worktrees`);
  if (sweep.error) o.log(`${o.reason}: stray sweep failed: ${sweep.error}`);
  for (const w of sweep.worktrees) if (w.error || w.remaining?.length) o.log(`${o.reason}: stray sweep incomplete in ${w.path}: ${w.error ?? `remaining PIDs ${w.remaining!.join(", ")}`}`);
  return sweep;
}
