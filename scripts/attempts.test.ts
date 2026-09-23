/** Offline: src/attempts.ts selection and routing rules (no claude, no git). */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attemptPrompt, hideProtected, pickWinner, planAttempts, restoreProtected, type AttemptResult } from "../src/attempts.js";

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

// protected paths: hidden from the attempt, and anything it writes there is discarded before the check
const dir = mkdtempSync(join(tmpdir(), "attempts-test-"));
try {
  const g = (...a: string[]) => spawnSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { encoding: "utf8" });
  g("init", "-q");
  mkdirSync(join(dir, "tests"));
  writeFileSync(join(dir, "tests", "spec.test.js"), "assert(real)\n");
  writeFileSync(join(dir, "impl.js"), "old\n");
  g("add", "-A");
  g("commit", "-q", "-m", "base");
  const base = g("rev-parse", "HEAD").stdout.trim();
  process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "t";
  process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "t@t";
  const hidden = hideProtected(dir, ["tests/"]);
  assert.equal(existsSync(join(dir, "tests", "spec.test.js")), false, "the attempt cannot read the tests");
  // the attempt rewrites impl and plants a trivially-passing test
  writeFileSync(join(dir, "impl.js"), "new\n");
  mkdirSync(join(dir, "tests"), { recursive: true });
  writeFileSync(join(dir, "tests", "spec.test.js"), "assert(true)\n");
  writeFileSync(join(dir, "tests", "extra.test.js"), "pass\n");
  g("add", "-A");
  g("commit", "-q", "-m", "attempt");
  const tampered = restoreProtected(dir, base, hidden, ["tests/"]);
  assert.deepEqual(tampered.sort(), ["tests/extra.test.js", "tests/spec.test.js"]);
  assert.equal(readFileSync(join(dir, "tests", "spec.test.js"), "utf8"), "assert(real)\n", "the check sees pristine tests");
  assert.equal(existsSync(join(dir, "tests", "extra.test.js")), false, "planted tests are removed");
  assert.equal(readFileSync(join(dir, "impl.js"), "utf8"), "new\n", "the attempt's real work is kept");
  assert.equal(g("status", "--porcelain").stdout, "", "restoration is committed, so merging the winner brings no test edits");
  // an attempt that never touched tests reports nothing tampered, and tests still come back
  const h2 = hideProtected(dir, ["tests/"]);
  assert.deepEqual(restoreProtected(dir, base, h2, ["tests/"]), []);
  assert.equal(readFileSync(join(dir, "tests", "spec.test.js"), "utf8"), "assert(real)\n");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("attempts.test: OK");
