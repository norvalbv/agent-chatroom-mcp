/** node --import tsx scripts/paper-fig-data.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { wilson95, buildFigData } from "./paper-fig-data.js";

function suiteRun(task: string, arm: string, seed: number, outcome: string, cost = 0.01) {
  return {
    schemaVersion: 1 as const, task_id: task, arm, seed, model: "claude-sonnet-5", outcome, passed: outcome === "task_pass", reason: outcome,
    usage: { cost_usd: cost, coverage: "complete" as const, seats: 1, seats_with_usage: 1 },
    turns: { summed: 5, coverage: "complete" as const },
    wall_clock: { started_at: "2026-09-18T00:00:00.000Z", completed_at: "2026-09-18T00:01:00.000Z", duration_ms: 60000 },
  };
}

function kGroup(task: string, seed: number, k: number, passed: boolean, votes: Record<string, number>, cost = 0.5) {
  return {
    schemaVersion: 2 as const, task_id: task, arm: "K", seed, model: "claude-sonnet-5", outcome: passed ? "task_pass" : "task_fail",
    passed, reason: passed ? "task_pass" : "task_fail", k, usage: { cost_usd: cost, coverage: "complete" as const },
    selection: { rule: "plurality", winner_attempt: 1, votes },
    attempts: Array.from({ length: k }, (_, i) => ({ index: i + 1, answer: "x", passed, outcome: passed ? "task_pass" : "task_fail", cost_usd: cost / k })),
  };
}

function fixtureDirs() {
  const suite = mkdtempSync(join(tmpdir(), "fig-data-suite-"));
  const armK = mkdtempSync(join(tmpdir(), "fig-data-armk-"));
  return { suite, armK };
}

function writeSuite(dir: string, runs: ReturnType<typeof suiteRun>[]) {
  runs.forEach((r, i) => {
    const d = join(dir, `${r.task_id}-${r.arm}-seed${r.seed}-${i}`);
    mkdirSync(d);
    writeFileSync(join(d, "result.json"), JSON.stringify(r));
  });
}

function writeArmK(dir: string, groups: ReturnType<typeof kGroup>[]) {
  groups.forEach((g) => {
    const d = join(dir, `${g.task_id}-K-seed${g.seed}`);
    mkdirSync(d);
    writeFileSync(join(d, "result.json"), JSON.stringify(g));
  });
}

test("wilson95: undefined (null bounds) at n=0, never a 0-width interval", () => {
  const w = wilson95(0, 0);
  assert.equal(w.lo, null);
  assert.equal(w.hi, null);
  assert.equal(w.p, null);
});

test("wilson95: bounds contain the point estimate and widen as n shrinks", () => {
  const big = wilson95(70, 100);
  const small = wilson95(7, 10);
  assert.ok(big.lo !== null && big.hi !== null && big.lo <= 0.7 && big.hi >= 0.7);
  assert.ok(small.hi! - small.lo! > big.hi! - big.lo!, "smaller n must give a wider interval");
});

test("buildFigData: pass_rates includes arm K from the arm-K table, cost_vs_accuracy joins by (task,arm)", () => {
  const { suite, armK } = fixtureDirs();
  try {
    writeSuite(suite, [
      suiteRun("t1", "A", 101, "task_pass", 0.1), suiteRun("t1", "A", 102, "task_fail", 0.1),
      suiteRun("t1", "C", 101, "task_pass", 0.5), suiteRun("t1", "C", 102, "task_pass", 0.5),
    ]);
    // buildArmKTable's default seed window is 101-140 (paper/amendments.md's confirmatory grid); fixture seeds must fall inside it.
    writeArmK(armK, [kGroup("t1", 101, 3, true, { x: 2, y: 1 }, 0.3), kGroup("t1", 102, 3, false, { x: 1, y: 1, z: 1 }, 0.3)]);
    const data = buildFigData(suite, armK);
    const arms = new Set(data.pass_rates.filter((p) => p.task === "t1").map((p) => p.arm));
    assert.deepEqual([...arms].sort(), ["A", "C", "K"]);
    const kRow = data.pass_rates.find((p) => p.task === "t1" && p.arm === "K")!;
    assert.equal(kRow.pass, 1);
    assert.equal(kRow.n, 2);
    const kCost = data.cost_vs_accuracy.find((p) => p.task === "t1" && p.arm === "K")!;
    assert.equal(kCost.rate, kRow.rate, "cost_vs_accuracy must join the same rate as pass_rates, not recompute it");
    assert.ok(data.vote_distributions.some((v) => v.task === "t1"));
    const gv = data.armk_group_votes.filter((v: any) => v.task === "t1").sort((a: any, b: any) => a.seed - b.seed);
    assert.equal(gv.length, 2);
    assert.ok(Math.abs(gv[0].winner_share - 2 / 3) < 1e-9, `seed 101 winner_share expected 2/3, got ${gv[0].winner_share}`);
    assert.equal(gv[0].passed, true);
    assert.ok(Math.abs(gv[1].winner_share - 1 / 3) < 1e-9, `seed 102 winner_share expected 1/3, got ${gv[1].winner_share}`);
    assert.equal(gv[1].passed, false);
  } finally {
    rmSync(suite, { recursive: true, force: true });
    rmSync(armK, { recursive: true, force: true });
  }
});

test("buildFigData: cost_per_correct is null (not 0) with zero task_pass", () => {
  const { suite, armK } = fixtureDirs();
  try {
    writeSuite(suite, [suiteRun("t2", "A", 1, "task_fail", 0.2)]);
    const data = buildFigData(suite, armK);
    const cell = data.cost_per_correct.find((c) => c.task === "t2" && c.arm === "A")!;
    assert.equal(cell.cost_per_correct, null);
  } finally {
    rmSync(suite, { recursive: true, force: true });
    rmSync(armK, { recursive: true, force: true });
  }
});

test("end-to-end CLI: writes fig-data.json matching the real committed rq1-suite/rq1-arm-k numbers", () => {
  const outDir = mkdtempSync(join(tmpdir(), "fig-data-out-"));
  try {
    const script = resolve("scripts/paper-fig-data.ts");
    const outPath = join(outDir, "fig-data.json");
    const result = spawnSync(process.execPath, [
      "--import", "tsx", script, "bench/results/rq1-suite", "bench/results/rq1-arm-k", "--out", outPath,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.ok(existsSync(outPath));
    const data = JSON.parse(readFileSync(outPath, "utf8"));
    // Numbers fixed in the room brief and bench/results/rq1-suite/rq1-table.md, bench/results/rq1-arm-k/rq1-armk-table.md.
    const find = (task: string, arm: string) => data.pass_rates.find((p: any) => p.task === task && p.arm === arm);
    assert.equal(find("stamp-interpreter", "A").pass, 33);
    assert.equal(find("stamp-interpreter", "C").pass, 40);
    assert.equal(find("stamp-interpreter", "K").pass, 36);
    assert.equal(find("stamp-2", "A").pass, 28);
    assert.equal(find("stamp-2", "C").pass, 40);
    assert.equal(find("stamp-2", "K").pass, 39);
    assert.equal(find("bench-printf-format", "A").pass, 14);
    assert.equal(find("bench-printf-format", "C").pass, 6);
    assert.equal(find("bench-printf-format", "K").pass, 7);
    assert.equal(data.warnings.length, 0);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

console.log("PAPER FIG DATA OK");
