/**
 * Where recruits work: a write recruit's own git worktree and branch, a read-only checker's detached snapshot, and the
 * project a seat's worktree belongs to (moved out of spawner.ts). A write recruit's worktree is made here off the hub's
 * event loop (WorktreeMaker): `git worktree add` run with spawnSync inside the hub held it, and every room on it,
 * 1.8-3.8 s per breakout of 3 recruits on research-swarm (evidence/machine-load, decision/machine-load).
 */
import { execFile, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import { carryHooks, hooksOff, type HooksCarried } from "../worktree-hooks.js";

/** Where a write recruit works: .swarm-worktrees/<room>/<name> on branch swarm/<room>/<name> of the repository holding `cwd`. Undefined outside a git repository. Creates nothing. */
export function recruitWorkspace(cwd: string, room: string, name: string): { root: string; worktree: string; branch: string } | undefined {
  const top = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (top.status !== 0) return undefined;
  const root = top.stdout.trim();
  return { root, worktree: resolve(root, ".swarm-worktrees", room, name), branch: `swarm/${room}/${name}` };
}

/**
 * The commit a write recruit's branch starts from: HEAD of `from`, its recruiter's worktree, when that is a checkout of
 * the repository `root` belongs to. Without one, `git worktree add` starts at the HEAD of the project checkout, which
 * can be far behind the commit a room was launched on: swarm-123021-1nwp-audit #33, "Recruit worktrees are cut from
 * main-checkout HEAD 7c43aef4 (#781, Oct 3) ... The machine-rules command therefore runs gpt-5.6-sol" (the room ran in
 * devkit-correctness-swarm, a worktree of devkit, at eadfcdc2). Undefined when there is no such worktree.
 */
export function recruitBase(root: string, from?: string): { sha: string; from: string } | undefined {
  if (!from) return undefined;
  const common = (d: string) => {
    const r = spawnSync("git", ["-C", d, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", timeout: 5_000 });
    return r.status === 0 ? r.stdout.trim() : undefined;
  };
  const mine = common(from);
  if (!mine || mine !== common(root)) return undefined;
  const head = spawnSync("git", ["-C", from, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 5_000 });
  return head.status === 0 && head.stdout.trim() ? { sha: head.stdout.trim(), from } : undefined;
}

/**
 * `git worktree add -b <branch> <dir> [<base>]` in `root`; without a base the branch starts at root's HEAD. An async
 * child, never spawnSync: run inside the hub, checking out a project's files held its event loop, and every room on it,
 * 1.8-3.8 s per breakout of 3 recruits on research-swarm (evidence/machine-load, decision/machine-load).
 */
export function createRecruitWorktree(root: string, dir: string, branch: string, base?: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((done) => {
    execFile("git", ["-C", root, "worktree", "add", "-b", branch, dir, ...(base ? [base] : [])], { encoding: "utf8" }, (err, _out, stderr) =>
      done(err ? { ok: false, error: (stderr.trim().split("\n").pop() || err.message).slice(0, 300) } : { ok: true }));
  });
}

/** The project a seat's worktree belongs to (the repository its .git is shared with), or undefined outside git. A recruit
 * of that seat works there, not in the hub's own directory (swarm-003601-tky5: a hub started from the agent-chatroom-mcp
 * checkout for a Polymarket room would have put builder recruits in agent-chatroom-mcp). */
export function projectOf(worktree: string): string | undefined {
  const r = spawnSync("git", ["-C", worktree, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", timeout: 5_000 });
  if (r.status !== 0) return undefined;
  const common = r.stdout.trim();
  if (basename(common) === ".git") return dirname(common);
  const top = spawnSync("git", ["-C", worktree, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 5_000 });
  return top.status === 0 ? top.stdout.trim() : undefined;
}

/** A detached checkout of a proposer's commit for a read-only checker: `dir` (outside the repository), the commit, how many files of the live tree it leaves out. */
export interface Snapshot { repo: string; dir: string; sha: string; dirty: number; sub: string }

/**
 * Where a fresh challenger checks `src` (the proposer's worktree): a detached worktree of its HEAD in the OS temp dir,
 * so the checker's shell can neither move nor rewrite the tree the proposer is still working in (swarm-000525-jcz8
 * remaining/recruiting 2; Claude Code isolates subagents the same way, with only tracked files of HEAD). Undefined
 * outside a git checkout or before the first commit. Creates nothing.
 */
export function planSnapshot(src: string, label: string): Snapshot | undefined {
  const g = (...args: string[]) => spawnSync("git", ["-C", src, ...args], { encoding: "utf8" });
  const top = g("rev-parse", "--show-toplevel");
  const head = g("rev-parse", "HEAD");
  if (top.status !== 0 || head.status !== 0) return undefined;
  const repo = top.stdout.trim();
  // read-only: without --no-optional-locks this takes the proposer's index.lock while they may be committing
  const status = spawnSync("git", ["--no-optional-locks", "-C", src, "status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8" });
  const dirty = status.status === 0 ? status.stdout.split("\n").filter(Boolean).length : 0;
  const sub = relative(realpathSync(repo), realpathSync(src));
  const dir = resolve(tmpdir(), `chatroom-snapshot-${label.replace(/[^\w-]/g, "-").slice(0, 60)}-${randomUUID().slice(0, 8)}`);
  return { repo, dir, sha: head.stdout.trim(), dirty, sub };
}

/** Make the planned snapshot; false (nothing made) when git refuses. node_modules is linked from the proposer's tree so the checker can run the project's scripts. */
export function createSnapshot(plan: Snapshot): boolean {
  const made = spawnSync("git", ["-C", plan.repo, "worktree", "add", "--detach", "--quiet", plan.dir, plan.sha], { encoding: "utf8" });
  if (made.status !== 0) return false;
  const modules = resolve(plan.repo, "node_modules");
  if (existsSync(modules) && !existsSync(resolve(plan.dir, "node_modules"))) {
    try { symlinkSync(modules, resolve(plan.dir, "node_modules")); } catch {}
  }
  return true;
}

/** Remove a snapshot: the node_modules link first (never what it points at), then the worktree and git's record of it. */
export function removeSnapshot(plan: Pick<Snapshot, "repo" | "dir">): void {
  try { unlinkSync(resolve(plan.dir, "node_modules")); } catch {}
  const removed = spawnSync("git", ["-C", plan.repo, "worktree", "remove", "--force", plan.dir], { encoding: "utf8" });
  if (removed.status !== 0) {
    try { rmSync(plan.dir, { recursive: true, force: true }); } catch {}
    spawnSync("git", ["-C", plan.repo, "worktree", "prune"], { encoding: "utf8" });
  }
}

export const workspaceOf = (cwd: string, room: string, name: string, baseDir?: string) => {
  const ws = recruitWorkspace(cwd, room, name);
  const base = ws && recruitBase(ws.root, baseDir);
  return ws && { worktree: ws.worktree, branch: ws.branch, ...(base ? { base } : {}) };
};

/** One write recruit's worktree, as made: how long git ran, how long it waited behind the ones before it, and why git refused. */
export interface WorktreeMade { branch: string; ms: number; waited_ms: number; ok: boolean; error?: string }

/**
 * Makes write recruits' worktrees one at a time, each in an async child: the hub answers every room while git checks
 * the files out, and a batch of recruits writes its trees to disk one after another, not all at once.
 */
export class WorktreeMaker {
  /** the commit hooks carried into each worktree made here */
  readonly hooksIn = new Map<string, HooksCarried>();
  private queue: Promise<unknown> = Promise.resolve();

  /** The worktree's directory once it exists (at once if it already did), or undefined when git refuses; `made` hears of each one git ran for. */
  make(ws: { root: string; worktree: string; branch: string }, base: { sha: string } | undefined, made?: (e: WorktreeMade) => void): Promise<string | undefined> {
    if (existsSync(ws.worktree)) return Promise.resolve(ws.worktree);
    const queued = Date.now();
    const done = this.queue.then(async () => {
      const started = Date.now();
      // cut from the recruiter's HEAD when it has a worktree of this repository, else from the project checkout's HEAD
      const r = await createRecruitWorktree(ws.root, ws.worktree, ws.branch, base?.sha);
      made?.({ branch: ws.branch, ms: Date.now() - started, waited_ms: started - queued, ok: r.ok, ...(r.error ? { error: r.error } : {}) });
      return r.ok ? this.fitOut(ws.root, ws.worktree) : undefined;
    });
    this.queue = done.catch(() => {});
    return done;
  }

  /** node_modules linked so builds and tests work there, and the repository's commit hooks carried in */
  private fitOut(root: string, dir: string): string {
    const mods = resolve(root, "node_modules");
    if (existsSync(mods) && !existsSync(resolve(dir, "node_modules"))) {
      try {
        symlinkSync(mods, resolve(dir, "node_modules"), "dir");
      } catch {}
    }
    // and no hooks runner either: without this every commit a write recruit makes skips the repository's hooks
    // CHATROOM_SEAT_HOOKS=off (the launcher's --seat-hooks off): the run chose ungated seat commits
    this.hooksIn.set(dir, process.env.CHATROOM_SEAT_HOOKS === "off" ? hooksOff(root) : carryHooks(root, dir));
    return dir;
  }
}
