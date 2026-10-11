/** Commit hooks for a seat's fresh git worktree (launcher seats and write recruits). No hub import: used by swarm.ts and spawner.ts. */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/** shared: the hooks directory is one every worktree already uses; present: the worktree has it; copied; missing: the main checkout has none to copy; off: the run turned the copy off (--seat-hooks off). */
export interface HooksCarried { hooks: "shared" | "present" | "copied" | "missing" | "off"; path?: string; files?: number }

/**
 * A relative core.hooksPath (husky's `.husky/_`) is resolved inside each worktree, and its contents are untracked, so
 * `git worktree add` leaves a seat with no hooks and every commit it makes is ungated (bugs.md 4: devkit doctor,
 * "core.hooksPath .husky/_ resolves to nothing"). The main checkout's directory is copied in, not linked: a link would
 * let a seat rewrite the hooks of the checkout it was isolated from. Never runs `git config`.
 */
export function carryHooks(root: string, worktree: string): HooksCarried {
  const path = spawnSync("git", ["-C", root, "config", "--get", "core.hooksPath"], { encoding: "utf8", timeout: 5_000 }).stdout?.trim();
  // unset: <common .git>/hooks, shared by every worktree; absolute: one directory for all of them
  if (!path || isAbsolute(path) || path.startsWith("~")) return { hooks: "shared" };
  const from = resolve(root, path);
  const to = resolve(worktree, path);
  if (existsSync(to)) return { hooks: "present", path };
  if (!existsSync(from)) return { hooks: "missing", path };
  try {
    cpSync(from, to, { recursive: true });
    // the copy must never show up as the seat's own change to commit
    if (!existsSync(resolve(to, ".gitignore"))) writeFileSync(resolve(to, ".gitignore"), "*\n");
    return { hooks: "copied", path, files: readdirSync(to).filter((f) => f !== ".gitignore").length };
  } catch {
    return { hooks: "missing", path };
  }
}

/**
 * What --seat-hooks off can do for this repository: with a relative core.hooksPath (husky) the hooks are simply not
 * copied, so the seat's commits are ungated; with it unset or absolute the hooks are shared by every worktree, and
 * turning the copy off stops nothing (review/69f1f804). Never runs `git config` to change that.
 */
export function hooksOff(root: string): HooksCarried {
  const path = spawnSync("git", ["-C", root, "config", "--get", "core.hooksPath"], { encoding: "utf8", timeout: 5_000 }).stdout?.trim();
  return !path || isAbsolute(path) || path.startsWith("~") ? { hooks: "shared" } : { hooks: "off", path };
}

/** One line for a launcher or recruit log. */
export function hooksLine(name: string, h: HooksCarried): string {
  if (h.hooks === "copied") return `${name}: commit hooks copied into its worktree (${h.path}, ${h.files} file(s))`;
  if (h.hooks === "missing") return `${name}: NO commit hooks in its worktree: core.hooksPath is ${h.path}, which the main checkout does not have, so its commits are ungated`;
  if (h.hooks === "off") return `${name}: commit hooks NOT copied (--seat-hooks off): its commits are ungated`;
  return `${name}: commit hooks ${h.hooks === "present" ? `already in its worktree (${h.path})` : "shared with the main checkout (core.hooksPath unset or absolute), so they run even under --seat-hooks off"}`;
}
