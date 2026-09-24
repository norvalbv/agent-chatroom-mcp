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
import { existsSync, readdirSync, readlinkSync } from "node:fs";
import { sep } from "node:path";

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
    for (const line of (spawnSync("lsof", ["-w", "-d", "cwd", "-Fpn"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout ?? "").split("\n")) {
      if (line.startsWith("p")) pid = Number(line.slice(1));
      else if (line.startsWith("n") && inside(line.slice(1), dir)) pids.add(pid);
    }
  }
  pids.delete(process.pid);
  return [...pids];
}

/** SIGTERM, then SIGKILL, every process under dir except `spare`; returns how many distinct processes it stopped. */
export async function stopStrays(dir: string, spare: (number | undefined)[] = []): Promise<number> {
  const stopped = new Set<number>();
  for (let pass = 0; pass < 3; pass++) {
    const found = pidsUnder(dir).filter((p) => !spare.includes(p));
    if (!found.length) break;
    for (const p of found) { stopped.add(p); try { process.kill(p, "SIGTERM"); } catch {} }
    await delay(1000);
    for (const p of pidsUnder(dir).filter((p) => found.includes(p))) { try { process.kill(p, "SIGKILL"); } catch {} }
  }
  return stopped.size;
}
