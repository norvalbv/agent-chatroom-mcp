/**
 * The hub reads a working tree without taking its index lock (friction/git-index-lock, swarm-180216-182a;
 * claim/git-index-lock). Run: npx tsx scripts/git-no-lock-regression.ts
 *
 * A seat's `git add` / `git commit` failed three times in a row with "Unable to create .../index.lock: File exists".
 * Sampled in that room: a dev hub started from a seat's worktree ran `git -C <that worktree> status --porcelain`
 * (codeState), and plain `git status` rewrites the index under index.lock when a file's stat data changed. A reader
 * must pass --no-optional-locks. The check: after a tracked file is touched, reading the tree leaves the index file
 * itself (its inode) alone.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";
import { planSnapshot } from "../src/spawner.js";

const git = (cwd: string, ...args: string[]) => spawnSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
function repo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "no-lock-")));
  git(dir, "init", "-q");
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, "add", "a.txt");
  assert.equal(git(dir, "commit", "-q", "-m", "base").status, 0);
  return dir;
}
/** Make the index stale without changing content: git must re-stat a.txt, and a locking reader then rewrites the index. */
const touch = (dir: string) => { const t = new Date(Date.now() + 5_000); utimesSync(join(dir, "a.txt"), t, t); };
const indexId = (dir: string) => statSync(join(dir, ".git", "index")).ino;

const made: string[] = [];
const cases: [string, () => void][] = [
  ["the fixture works: plain `git status` rewrites the index", () => {
    const dir = repo(); made.push(dir);
    touch(dir);
    const before = indexId(dir);
    git(dir, "status", "--porcelain");
    assert.notEqual(indexId(dir), before, "git status took the lock and replaced the index");
  }],
  ["codeState reads HEAD and dirtiness without replacing the index", () => {
    const dir = repo(); made.push(dir);
    touch(dir);
    const before = indexId(dir);
    const st = Hub.codeState(dir);
    assert.equal(st?.dirty, false);
    assert.equal(indexId(dir), before, "the index file was rewritten: the read took index.lock");
    writeFileSync(join(dir, "b.txt"), "untracked\n");
    assert.equal(Hub.codeState(dir)?.dirty, true, "dirtiness is still seen");
    assert.equal(indexId(dir), before);
  }],
  ["a challenger snapshot plan reads the proposer's tree without replacing its index", () => {
    const dir = repo(); made.push(dir);
    touch(dir);
    const before = indexId(dir);
    assert.ok(planSnapshot(dir, "room"), "a snapshot was planned");
    assert.equal(indexId(dir), before, "the index file was rewritten: the read took index.lock");
  }],
];
let failed = 0;
for (const [name, test] of cases) {
  try { test(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message.split("\n")[0] : error}`); }
}
for (const dir of made) rmSync(dir, { recursive: true, force: true });
if (failed) { console.error(`GIT NO LOCK: ${failed}/${cases.length} failed`); process.exitCode = 1; }
else console.log(`GIT NO LOCK OK (${cases.length} cases)`);
