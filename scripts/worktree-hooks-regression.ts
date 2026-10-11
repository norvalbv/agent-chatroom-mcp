/**
 * Seat worktrees run the repository's commit hooks (evidence-pack item 11, bugs.md 4; claim/launcher-bugs).
 * Run: npx tsx scripts/worktree-hooks-regression.ts
 *
 * core.hooksPath is the relative `.husky/_`, whose contents are untracked (`.husky/_/.gitignore` is `*`), so a fresh
 * `git worktree add` has no runner there and every commit a seat makes skips the hooks: in this repository the
 * baseline-freeze guard, in devkit its pre-commit gates. Seen again in this room: the worktree of
 * swarm-180216-182a/claude-opus-5-5-3 had `.husky/pre-commit` and no `.husky/_`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Spawner } from "../src/spawner.js";

const git = (cwd: string, ...args: string[]) =>
  spawnSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });

/** A repository whose hooks live where husky puts them: named by core.hooksPath, present on disk, not tracked. */
function repoWithHooks(hooksPath: string | null): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "wt-hooks-")));
  assert.equal(git(repo, "init", "-q").status, 0);
  if (hooksPath) {
    // written into the scratch repository's own config file; no `git config` is run
    appendFileSync(join(repo, ".git", "config"), `[core]\n\thooksPath = ${hooksPath}\n`);
    const dir = join(repo, hooksPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".gitignore"), "*\n");
    writeFileSync(join(dir, "pre-commit"), "#!/bin/sh\n[ -f BLOCKED ] && { echo 'hook: refused' >&2; exit 1; }\nexit 0\n");
    chmodSync(join(dir, "pre-commit"), 0o755);
  }
  writeFileSync(join(repo, "a.txt"), "a\n");
  git(repo, "add", "a.txt");
  assert.equal(git(repo, "commit", "-q", "-m", "base").status, 0);
  return repo;
}

/** A commit of a file the hook refuses: exit status of `git commit` in `dir`. */
function blockedCommit(dir: string): number | null {
  writeFileSync(join(dir, "BLOCKED"), "x\n");
  git(dir, "add", "BLOCKED");
  return git(dir, "commit", "-q", "-m", "should be refused").status;
}

const spawner = () => new Spawner({ mcpUrl: "http://test/mcp", defaultCwd: process.cwd(), logDir: mkdtempSync(join(tmpdir(), "wt-hooks-logs-")), dryRun: true });
const recruitWorktree = (repo: string, name: string) => (spawner() as unknown as { worktreeFor(cwd: string, room: string, name: string): string | undefined }).worktreeFor(repo, "room", name);

const made: string[] = [];
const cases: [string, () => void | Promise<void>][] = [
  ["the main checkout's hook refuses the commit (the fixture works)", () => {
    const repo = repoWithHooks(".husky/_"); made.push(repo);
    assert.equal(blockedCommit(repo), 1);
  }],
  ["a recruit's worktree runs the same hook", () => {
    const repo = repoWithHooks(".husky/_"); made.push(repo);
    const wt = recruitWorktree(repo, "builder");
    assert.ok(wt && existsSync(wt), "worktree made");
    assert.ok(existsSync(join(wt!, ".husky", "_", "pre-commit")), "the hooks runner is in the worktree");
    assert.equal(blockedCommit(wt!), 1, "a commit the hook refuses is refused in the seat's worktree too");
    assert.equal(git(wt!, "status", "--porcelain", "--", ".husky").stdout.trim(), "", "the copied runner is not something the seat would commit");
  }],
  ["the worktree holds a copy, so a seat cannot rewrite the main checkout's hooks through it", () => {
    const repo = repoWithHooks(".husky/_"); made.push(repo);
    const wt = recruitWorktree(repo, "builder")!;
    writeFileSync(join(wt, ".husky", "_", "pre-commit"), "#!/bin/sh\nexit 0\n");
    assert.equal(blockedCommit(repo), 1, "the main checkout's hook still refuses");
  }],
  ["the helper reports what it did, for the launcher's log", async () => {
    const { carryHooks } = await import("../src/worktree-hooks.js");
    const repo = repoWithHooks(".husky/_"); made.push(repo);
    const dir = join(repo, ".swarm-worktrees", "r", "s");
    assert.equal(git(repo, "worktree", "add", "-q", "-b", "b1", dir).status, 0);
    assert.deepEqual(carryHooks(repo, dir), { hooks: "copied", path: ".husky/_", files: 1 });
    assert.deepEqual(carryHooks(repo, dir), { hooks: "present", path: ".husky/_" });
    const plain = repoWithHooks(null); made.push(plain);
    const dir2 = join(plain, ".swarm-worktrees", "r", "s");
    assert.equal(git(plain, "worktree", "add", "-q", "-b", "b1", dir2).status, 0);
    assert.deepEqual(carryHooks(plain, dir2), { hooks: "shared" }, "no core.hooksPath: .git/hooks is shared by every worktree already");
    const gone = repoWithHooks(".husky/_"); made.push(gone);
    rmSync(join(gone, ".husky"), { recursive: true });
    const dir3 = join(gone, ".swarm-worktrees", "r", "s");
    assert.equal(git(gone, "worktree", "add", "-q", "-b", "b1", dir3).status, 0);
    assert.deepEqual(carryHooks(gone, dir3), { hooks: "missing", path: ".husky/_" }, "nothing to copy: said, not hidden");
  }],
];

let failed = 0;
for (const [name, test] of cases) {
  try { await test(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message.split("\n")[0] : error}`); }
}
for (const dir of made) rmSync(dir, { recursive: true, force: true });
if (failed) { console.error(`WORKTREE HOOKS: ${failed}/${cases.length} failed`); process.exitCode = 1; }
else console.log(`WORKTREE HOOKS OK (${cases.length} cases)`);
