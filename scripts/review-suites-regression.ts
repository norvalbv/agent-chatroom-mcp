/**
 * A reviewer runs the suites that reach the files a commit touches, not only the author's new test (board
 * friction/told-run-grep-suites, swarm-092526-89rn). Three commits in that room passed review and broke a suite the
 * reviewer never ran: 2021467b broke speaker-identity, 02927c93 broke claude-lean-flags and seat-env, and 3976124a broke
 * seat-env. seat-env never names env.ts or swarm.ts; it reaches them through imports, so grepping a file's name misses it.
 * suitesFor() follows the static import graph from each offline-suite script into src/, and adds scripts that name the
 * file directly (prompts, other scripts).
 * Run: npx tsx scripts/review-suites-regression.ts
 */
import assert from "node:assert/strict";
import { suitesFor } from "./review-suites.js";

const cases: [string, () => void][] = [];
const test = (name: string, run: () => void) => cases.push([name, run]);

test("2021467b (prompts + src/swarm.ts) selects speaker-identity", () => {
  const s = suitesFor(["prompts/loop.md", "prompts/minimal.md", "prompts/terse.md", "scripts/topic-once-regression.ts", "src/swarm.ts"]);
  assert.ok(s.includes("speaker-identity-regression.ts"), s.join(" "));
  assert.ok(s.includes("topic-once-regression.ts"), "a changed suite is itself selected");
});

test("02927c93 (env, status-view, index, server, swarm) selects claude-lean-flags and seat-env, reached only by imports", () => {
  const s = suitesFor(["scripts/join-topic-held-regression.ts", "src/env.ts", "src/hub/status-view.ts", "src/index.ts", "src/server.ts", "src/swarm.ts"]);
  for (const want of ["claude-lean-flags-regression.ts", "seat-env-regression.ts", "join-topic-held-regression.ts"]) assert.ok(s.includes(want), `${want} missing`);
});

test("3976124a (env + swarm) selects seat-env", () => {
  const s = suitesFor(["scripts/seat-compact-default-regression.ts", "scripts/seat-compact-window-regression.ts", "src/env.ts", "src/swarm.ts"]);
  assert.ok(s.includes("seat-env-regression.ts"));
});

test("a prompt edit selects the suites that read that prompt", () => {
  const s = suitesFor(["prompts/verifier.md"]);
  assert.ok(s.includes("topic-once-regression.ts") && s.includes("verify-fail-to-pass-regression.ts"), s.join(" "));
});

test("a leaf module selects a few suites, not the whole offline suite", () => {
  const s = suitesFor(["src/metrics/cache-reset.ts"]);
  assert.ok(s.includes("cache-reset-regression.ts") && s.length <= 3, s.join(" ")); // this file names it too
});

for (const [n, run] of cases) {
  try { run(); console.log(`ok - ${n}`); } catch (e) { console.error(`FAIL - ${n}\n${(e as Error).stack}`); process.exitCode = 1; }
}
if (!process.exitCode) console.log("REVIEW SUITES OK");
