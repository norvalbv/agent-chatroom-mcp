/** node --import tsx scripts/paper-rq1-family.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildExploratoryK, buildFamilyTests, FAMILIES } from "./paper-rq1-family.js";
import type { KGroup } from "./paper-rq1-armk.js";
import type { RunResult } from "./paper-rq1-table.js";

function base(task: string, arm: string, seed: number, passed: boolean): RunResult {
  return {
    schemaVersion: 1, task_id: task, arm, seed, model: "m", outcome: passed ? "task_pass" : "task_fail",
    usage: { cost_usd: 0.1, coverage: "complete", seats: 1, seats_with_usage: 1 },
    turns: { summed: 4, coverage: "complete" },
    wall_clock: { started_at: "2026-09-19T00:00:00.000Z", completed_at: "2026-09-19T00:01:00.000Z", duration_ms: 60000 },
  } as RunResult;
}
function kGroup(task: string, seed: number, passed: boolean): KGroup {
  return {
    ...base(task, "K", seed, passed),
    usage: { cost_usd: 0.5, coverage: "complete", seats: 3, seats_with_usage: 3 },
    k: 3, passed, selection: { rule: "r", winner_attempt: 1, votes: { good: 2, bad: 1 } },
    attempts: [1, 2, 3].map((i) => ({ index: i, answer: passed ? "good" : "bad", null_vote: false, passed, outcome: passed ? "task_pass" : "task_fail", cost_usd: 0.166 })),
  } as KGroup;
}

test("family pooling sums two tasks sharing a family and keeps a single-task family unpooled", () => {
  const runs: RunResult[] = [];
  // interpreter family: stamp-interpreter 8/10 A, 10/10 C; stamp-2 6/10 A, 10/10 C -> pooled A 14/20, C 20/20
  for (let s = 1; s <= 10; s++) {
    runs.push(base("stamp-interpreter", "A", s, s <= 8), base("stamp-interpreter", "C", s, true));
    runs.push(base("stamp-2", "A", s, s <= 6), base("stamp-2", "C", s, true));
    runs.push(base("bench-printf-format", "A", s, s <= 3), base("bench-printf-format", "C", s, s <= 2));
  }
  const tests = buildFamilyTests(runs);
  assert.equal(tests.length, Object.keys(FAMILIES).length);
  const interp = tests.find((t) => t.family.startsWith("interpreter"))!;
  assert.equal(interp.a.pass, 14);
  assert.equal(interp.a.n, 20);
  assert.equal(interp.c.pass, 20);
  const printf = tests.find((t) => t.family.startsWith("printf"))!;
  assert.equal(printf.a.pass, 3);
  assert.equal(printf.c.pass, 2);
  // Holm across m=2: the larger raw p is never smaller than its own raw value, and both are <= 1.
  for (const t of tests) {
    assert.ok(t.p_holm !== null && t.p_value !== null);
    assert.ok(t.p_holm! >= t.p_value! - 1e-9);
    assert.ok(t.p_holm! <= 1);
  }
});

test("family-pooled numbers reproduce the committed rq1-suite/rq1-arm-k figures exactly", () => {
  // Numbers from bench/results/rq1-suite/rq1-table.md and bench/results/rq1-arm-k/rq1-armk-table.md,
  // reconstructed as raw pass/fail counts (not re-typed as a p-value) to check this script's arithmetic
  // against paper/amendments.md's hand-verified 0.059 / 0.0033 and the verifier's 0.069 printf check.
  const runs: RunResult[] = [];
  const push = (task: string, arm: string, pass: number, fail: number) => {
    let s = 0;
    for (let i = 0; i < pass; i++) runs.push(base(task, arm, s++, true));
    for (let i = 0; i < fail; i++) runs.push(base(task, arm, s++, false));
  };
  push("stamp-interpreter", "A", 33, 7);
  push("stamp-interpreter", "C", 40, 0);
  push("stamp-2", "A", 28, 12);
  push("stamp-2", "C", 40, 0);
  push("bench-printf-format", "A", 14, 26);
  push("bench-printf-format", "C", 6, 34);
  const tests = buildFamilyTests(runs);
  const printf = tests.find((t) => t.family.startsWith("printf"))!;
  assert.equal(+printf.p_value!.toFixed(4), 0.0692, "matches verifier/prechecks: A vs C printf Fisher p=0.0692, NOT significant");

  const kGroups: KGroup[] = [];
  const pushK = (task: string, pass: number, fail: number) => {
    let s = 101; // buildExploratoryK restricts to the confirmatory seed range 101-140, matching bench/results/rq1-arm-k
    for (let i = 0; i < pass; i++) kGroups.push(kGroup(task, s++, true));
    for (let i = 0; i < fail; i++) kGroups.push(kGroup(task, s++, false));
  };
  pushK("stamp-interpreter", 36, 4);
  pushK("stamp-2", 39, 1);
  const exploratory = buildExploratoryK(runs, kGroups);
  const vsC = exploratory.find((e) => e.vs === "C")!;
  const vsA = exploratory.find((e) => e.vs === "A")!;
  assert.equal(vsC.k.pass, 75);
  assert.equal(vsC.k.n, 80);
  assert.equal(+vsC.p_value!.toFixed(3), 0.059, "matches paper/amendments.md: family-pooled K 75/80 vs C 80/80 p=0.059");
  assert.equal(+vsA.p_value!.toFixed(4), 0.0033, "matches paper/amendments.md: K vs A 61/80 p=0.0033");
});
