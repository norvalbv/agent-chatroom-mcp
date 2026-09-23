/** Offline: src/attempts.ts selection and routing rules (no claude, no git). */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attemptPrompt, exportAttemptTree, landAttempt, pickWinner, planAttempts, type AttemptResult } from "../src/attempts.js";

const r = (index: number, passed: boolean, ran = true): AttemptResult => ({ index, branch: `b${index}`, dir: `d${index}`, ran, passed, check_exit: passed ? 0 : 1, cost_usd: null, tampered: [] });

// the check decides, not agreement: one passing minority attempt beats two agreeing failures
assert.equal(pickWinner([r(1, false), r(2, true), r(3, false)])?.index, 2);
// lowest index among passes, regardless of input order
assert.equal(pickWinner([r(3, true), r(1, true), r(2, false)])?.index, 1);
// nothing passed: no winner, never a guess
assert.equal(pickWinner([r(1, false), r(2, false)]), null);
// an attempt whose claude run failed does not win even if the check happens to pass on the untouched tree
assert.equal(pickWinner([r(1, true, false), r(2, false)]), null);

// no check: refused with the one-agent rule
const noCheck = planAttempts({ n: 3 });
assert.equal(noCheck.ok, false);
assert.match(noCheck.ok ? "" : noCheck.reason, /run one agent/);
assert.equal(planAttempts({ n: 3, check: "   " }).ok, false);
assert.equal(planAttempts({ n: 0, check: "npm test" }).ok, false);
assert.deepEqual(planAttempts({ n: 3, check: "npm test" }), { ok: true, n: 3 });

// the check stays hidden: the prompt never names it
assert.doesNotMatch(attemptPrompt("fix printf"), /npm|test|--check/);

// protected paths: absent from the attempt's tree AND history, and anything it writes there never reaches the branch
const root = mkdtempSync(join(tmpdir(), "attempts-test-"));
try {
  const repo = join(root, "repo");
  mkdirSync(join(repo, "tests"), { recursive: true });
  const g = (dir: string, ...a: string[]) => spawnSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { encoding: "utf8" });
  g(repo, "init", "-q");
  writeFileSync(join(repo, "tests", "spec.test.js"), "assert(real)\n");
  writeFileSync(join(repo, "impl.js"), "old\n");
  g(repo, "add", "-A");
  g(repo, "commit", "-q", "-m", "base");
  const base = g(repo, "rev-parse", "HEAD").stdout.trim();

  const work = join(root, "work");
  const start = exportAttemptTree(repo, base, work, ["tests/"]);
  assert.equal(existsSync(join(work, "tests")), false, "the attempt's tree has no tests");
  assert.equal(existsSync(join(work, "impl.js")), true, "the rest of base is there");
  assert.equal(g(work, "log", "--all", "--oneline").stdout.trim().split("\n").length, 1, "one commit: no history to dig the tests out of");
  assert.notEqual(g(work, "cat-file", "-e", `${base}:tests/spec.test.js`).status, 0, "base's objects are not reachable from the attempt");
  assert.ok(!g(work, "rev-parse", "--git-common-dir").stdout.includes(repo), "not a worktree sharing the source repo's object store");

  // the attempt rewrites impl and plants a trivially-passing test
  writeFileSync(join(work, "impl.js"), "new\n");
  mkdirSync(join(work, "tests"));
  writeFileSync(join(work, "tests", "spec.test.js"), "assert(true)\n");
  writeFileSync(join(work, "tests", "extra.test.js"), "pass\n");
  writeFileSync(join(work, "added.js"), "x\n");

  const check = join(root, "check");
  assert.equal(g(repo, "worktree", "add", "-q", "-b", "attempts/t/1", check, base).status, 0);
  const landed = landAttempt(work, start, check, ["tests/"], "attempt 1");
  assert.equal(landed.applied, true);
  assert.deepEqual(landed.tampered.sort(), ["tests/extra.test.js", "tests/spec.test.js"]);
  assert.equal(readFileSync(join(check, "tests", "spec.test.js"), "utf8"), "assert(real)\n", "the check sees pristine tests");
  assert.equal(existsSync(join(check, "tests", "extra.test.js")), false, "planted tests never land");
  assert.equal(readFileSync(join(check, "impl.js"), "utf8"), "new\n", "the attempt's real work lands");
  assert.equal(readFileSync(join(check, "added.js"), "utf8"), "x\n", "new files land too");
  assert.equal(g(check, "status", "--porcelain").stdout, "", "landed work is committed on the attempt branch");
  assert.deepEqual(g(repo, "diff", "--name-only", base, "attempts/t/1").stdout.trim().split("\n").sort(), ["added.js", "impl.js"], "merging the winner brings no test edits");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("attempts.test: OK");
