/** node --import tsx scripts/paper-rq1-armk.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { holmBonferroni } from "./rq1-stats.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArmKTable, loadKGroups, renderArmKMarkdown, type KGroup } from "./paper-rq1-armk.js";
import type { RunResult } from "./paper-rq1-table.js";

const ALL = { seedMin: 0, seedMax: 1e9 };
function base(task: string, arm: string, seed: number, passed: boolean, cost = 0.1) {
  return {
    schemaVersion: 1 as const, task_id: task, arm, seed, model: "m", outcome: passed ? "task_pass" : "task_fail",
    usage: { cost_usd: cost, coverage: "complete" as const, seats: 1, seats_with_usage: 1 },
    turns: { summed: 4, coverage: "complete" as const },
    wall_clock: { started_at: "2026-09-19T00:00:00.000Z", completed_at: "2026-09-19T00:01:00.000Z", duration_ms: 60000 },
  } as RunResult;
}
function kGroup(task: string, seed: number, passes: boolean[], selectedPass: boolean, cost: number | null, votes: Record<string, number>): KGroup {
  return {
    ...base(task, "K", seed, selectedPass, cost ?? 0),
    usage: { cost_usd: cost as number, coverage: cost === null ? "partial" : "complete", seats: passes.length, seats_with_usage: passes.length },
    k: passes.length, passed: selectedPass, selection: { rule: "r", winner_attempt: 1, votes },
    attempts: passes.map((p, i) => ({ index: i + 1, answer: p ? "good" : "bad", passed: p, outcome: p ? "task_pass" : "task_fail", cost_usd: cost === null ? null : cost / passes.length })),
  } as KGroup;
}

test("holmBonferroni: step-down adjusted, monotone, capped at 1", () => {
  const adj = holmBonferroni([0.01, 0.04, 0.03]);
  assert.deepEqual(adj.map((v) => +v.toFixed(6)), [0.03, 0.06, 0.06]);
  assert.deepEqual(holmBonferroni([0.9, 0.8]), [1, 1]);
  assert.deepEqual(holmBonferroni([]), []);
});

test("K vs C and K vs A Fisher with Holm across all K comparisons; ceiling labelled not an arm", () => {
  const runs: RunResult[] = [];
  const groups: KGroup[] = [];
  for (const task of ["t1", "t2"]) {
    for (let s = 1; s <= 10; s++) {
      runs.push(base(task, "A", s, s <= 5), base(task, "C", s, true, 0.6));
      groups.push(kGroup(task, s, [true, false, true], task === "t1" ? true : s <= 5, 0.5, { good: 2, bad: 1 }));
    }
  }
  const t = buildArmKTable(runs, groups, ALL);
  assert.equal(t.tasks.length, 2);
  const t1 = t.tasks.find((x) => x.task === "t1")!;
  assert.equal(t1.k_pass, 10);
  assert.equal(t1.comparisons.length, 2);
  assert.deepEqual(t1.comparisons.map((c) => c.vs), ["C", "A"]);
  assert.ok(t1.comparisons.every((c) => c.test === "fisher"));
  assert.ok(t1.comparisons.every((c) => c.p_holm !== null && c.p_holm >= c.p_value!));
  assert.equal(t.tasks.flatMap((x) => x.comparisons).length, 4);
  assert.equal(t1.ceiling.any_pass, 10);
  assert.equal(t1.cost_per_correct, 5 / 10);
  assert.equal(t1.vote_distribution["2-1"], 10);
  const md = renderArmKMarkdown(t);
  assert.match(md, /NOT an arm/);
  assert.match(md, /Holm/);
});

test("unknown group cost is never summed as zero; cost_per_correct undefined", () => {
  const runs = [base("t", "A", 1, true), base("t", "C", 1, true)];
  const groups = [kGroup("t", 1, [true, true], true, 0.4, { good: 2 }), kGroup("t", 2, [true, true], true, null, { good: 2 })];
  const t = buildArmKTable(runs, groups, ALL);
  const row = t.tasks[0];
  assert.equal(row.cost_unknown_groups, 1);
  assert.equal(row.mean_cost_known, 0.4);
  assert.equal(row.cost_per_correct, "unknown");
});

test("null-vote groups (all attempts unanswered) count as fail in the denominator", () => {
  const runs = [base("t", "A", 1, true), base("t", "C", 1, true)];
  const g = kGroup("t", 1, [false, false], false, 0.1, { "(none)": 2 });
  const t = buildArmKTable(runs, [g], ALL);
  assert.equal(t.tasks[0].k_fail, 1);
  assert.equal(t.tasks[0].ceiling.any_pass, 0);
});

test("Holm family stays fixed at 6 on partial data; pilot seeds excluded; lost attempt cost is unknown", () => {
  const runs: RunResult[] = [];
  const groups: KGroup[] = [];
  for (let s = 101; s <= 140; s++) { runs.push(base("t", "A", s, s <= 133), base("t", "C", s, true)); groups.push(kGroup("t", s, [true], true, 0.5, { good: 1 })); }
  groups.push(kGroup("t", 1, [false], false, 0.5, { bad: 1 }));
  const t = buildArmKTable(runs, groups);
  assert.equal(t.tasks[0].k_groups, 40);
  const vsA = t.tasks[0].comparisons.find((c) => c.vs === "A")!;
  assert.equal(+vsA.p_value!.toFixed(6), 0.011738);
  assert.equal(+vsA.p_holm!.toFixed(4), +(0.011738 * 6).toFixed(4));
  const lost = kGroup("t", 101, [true, true], true, 0.4, { good: 2 });
  lost.attempts[1].cost_usd = null;
  assert.equal(buildArmKTable(runs, [lost], ALL).tasks[0].cost_unknown_groups, 1);
});

test("spend match is judged per seed over paired seeds, not against the whole-grid C mean", () => {
  const runs: RunResult[] = [];
  const groups: KGroup[] = [];
  for (let s = 101; s <= 104; s++) { runs.push(base("t", "A", s, true, 0.05), base("t", "C", s, true, s === 101 ? 0.2 : 2)); }
  groups.push(kGroup("t", 101, [true], true, 0.5, { good: 1 })); // only seed 101 run so far: K 0.5 > C 0.2 at that seed
  const row = buildArmKTable(runs, groups).tasks[0];
  assert.equal(row.mean_cost_c, 0.2);
  assert.equal(row.paired_cost_diff, 0.3);
  assert.equal(row.matched_cost_ok, false);
});

test("a group shaped like scripts/bench-ak.ts output (schemaVersion 2, code task, null answers) loads; only killed/absent attempts are null votes", () => {
  const dir = mkdtempSync(join(tmpdir(), "armk-load-"));
  try {
    const attempt = (i: number, over: object) => ({ index: i, root: "r", answer: null, outcome: "task_pass", passed: true, cost_usd: 0.08, turns: 5, wall_ms: 30000, exit_code: 0, signal: null, killed_by_deadline: false, runner_failure: null, ...over });
    const group = {
      schemaVersion: 2, task_id: "bench-printf-format", arm: "K", k: 4, seed: 101, model: "sonnet", selector: "mbr-exec",
      selection: { rule: "mbr", winner_attempt: 1, votes: { "sig-a": 2, "sig-b": 1 } },
      outcome: "task_pass", passed: true,
      usage: { cost_usd: 0.32, cost_usd_known_sum: 0.32, cost_usd_unknown_attempts: 0 },
      turns_total: 20, wall_clock: { duration_ms: 90000 },
      attempts: [attempt(1, {}), attempt(2, { passed: false, outcome: "task_fail" }), attempt(3, { outcome: "timeout", passed: false, killed_by_deadline: true }), attempt(4, { outcome: "no_result", passed: false, cost_usd: 0.08 })],
    };
    mkdirSync(join(dir, "bench-printf-format-K-seed101"));
    writeFileSync(join(dir, "bench-printf-format-K-seed101", "result.json"), JSON.stringify(group));
    const { groups, warnings } = loadKGroups(dir);
    assert.deepEqual(warnings, []);
    assert.equal(groups.length, 1);
    const runs = [base("bench-printf-format", "A", 101, true), base("bench-printf-format", "C", 101, true, 0.7)];
    const row = buildArmKTable(runs, groups).tasks[0]!;
    assert.equal(row.cost_unknown_groups, 0, "a null-free cost with no coverage field is known");
    assert.equal(row.null_attempts, 2, "code-task answers are null for every attempt; only the killed and the no-result attempt are null votes");
    assert.equal(row.ceiling.any_pass, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
