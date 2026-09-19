/**
 * Reads the same committed RQ1 artifacts as scripts/paper-rq1-table.ts and scripts/paper-rq1-armk.ts
 * (never re-deriving a number those scripts already compute) and emits one JSON file,
 * paper/generated/fig-data.json, that every figure script (scripts/paper-fig.py) draws from. No figure
 * reads bench/results/* directly: this file is the single point where raw run artifacts become plotted
 * numbers, so a figure cannot drift from the tables printed in the same paper (paper/figures.md's
 * reproducibility contract).
 *
 * Usage: node --import tsx scripts/paper-fig-data.ts SUITE_DIR ARM_K_DIR [--out PATH]
 *   Defaults: SUITE_DIR=bench/results/rq1-suite ARM_K_DIR=bench/results/rq1-arm-k
 *   PATH default: paper/generated/fig-data.json
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTable, computeCell, loadRunResults, type CellStats } from "./paper-rq1-table.js";
import { buildArmKTable, loadKGroups, type KTable } from "./paper-rq1-armk.js";

/** Wilson score interval for a binomial proportion, 95% (z=1.959963985...). No external stats dependency,
 * matching rq1-stats.ts's own no-scipy convention. Undefined (both bounds null) when there is no trial to
 * bound (n=0), never silently rendered as a 0-width interval at p=0/1. */
export function wilson95(successes: number, n: number): { lo: number | null; hi: number | null; p: number | null } {
  if (n <= 0) return { lo: null, hi: null, p: null };
  const z = 1.959963984540054;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (center - margin) / denom), hi: Math.min(1, (center + margin) / denom), p };
}

export interface PassRatePoint {
  task: string;
  arm: string;
  n: number;
  pass: number;
  rate: number | null;
  ci_lo: number | null;
  ci_hi: number | null;
}

export interface CostPoint {
  task: string;
  arm: string;
  cost_per_correct: number | null; // null renders as "undefined (no task_pass)" — never 0 or Infinity
  n: number;
  pass: number;
}

export interface GroupVotePoint {
  task: string;
  seed: number;
  k: number;
  /** Size of the largest answer cluster divided by k: how much of the group agreed on the winning answer. */
  winner_share: number;
  /** Whether the group's selected (plurality/MBR-exec) attempt passed the oracle. */
  passed: boolean;
}

export interface FigData {
  generated_from: { suite_dir: string; arm_k_dir: string };
  pass_rates: PassRatePoint[];
  cost_per_correct: CostPoint[];
  vote_distributions: { task: string; distribution: Record<string, number> }[];
  /** Per-group (winner_share, passed) pairs — the mechanism figure: does agreement track correctness? */
  armk_group_votes: GroupVotePoint[];
  cost_vs_accuracy: { task: string; arm: string; cost_per_correct: number | null; rate: number | null }[];
  warnings: string[];
}

function passRatePointsFromCells(cells: CellStats[]): PassRatePoint[] {
  return cells.map((c) => {
    const n = c.success_denominator;
    const w = wilson95(c.task_pass, n);
    return { task: c.task, arm: c.arm, n, pass: c.task_pass, rate: w.p, ci_lo: w.lo, ci_hi: w.hi };
  });
}

function armKPassRatePoints(kTable: KTable): PassRatePoint[] {
  return kTable.tasks.map((r) => {
    const w = wilson95(r.k_pass, r.k_groups);
    return { task: r.task, arm: "K", n: r.k_groups, pass: r.k_pass, rate: w.p, ci_lo: w.lo, ci_hi: w.hi };
  });
}

function costPointsFromCells(cells: CellStats[]): CostPoint[] {
  return cells.map((c) => ({
    task: c.task,
    arm: c.arm,
    cost_per_correct: c.cost_per_correct === "undefined" ? null : c.cost_per_correct,
    n: c.n,
    pass: c.task_pass,
  }));
}

function armKCostPoints(kTable: KTable): CostPoint[] {
  return kTable.tasks.map((r) => ({
    task: r.task,
    arm: "K",
    cost_per_correct: typeof r.cost_per_correct === "number" ? r.cost_per_correct : null,
    n: r.k_groups,
    pass: r.k_pass,
  }));
}

/** Same confirmatory seed window buildArmKTable defaults to (paper/amendments.md: pilot seeds 1-3 stay
 * out of the test); kept as a literal default here too so armk_group_votes matches every other arm-K number
 * in this file without importing an internal from paper-rq1-armk.ts. */
const ARM_K_SEED_MIN = 101;
const ARM_K_SEED_MAX = 140;

export function buildFigData(suiteDir: string, armKDir: string): FigData {
  const { runs, warnings: w1 } = loadRunResults(suiteDir);
  const { groups, warnings: w2 } = loadKGroups(armKDir);
  const { cells } = buildTable(runs);
  const kTable = buildArmKTable(runs, groups);

  const pass_rates = [...passRatePointsFromCells(cells), ...armKPassRatePoints(kTable)];
  const cost_per_correct = [...costPointsFromCells(cells), ...armKCostPoints(kTable)];
  const vote_distributions = kTable.tasks.map((r) => ({ task: r.task, distribution: r.vote_distribution }));
  const armk_group_votes: GroupVotePoint[] = groups
    .filter((g) => g.seed >= ARM_K_SEED_MIN && g.seed <= ARM_K_SEED_MAX)
    .map((g) => {
      const counts = Object.values(g.selection.votes);
      const winner = counts.length ? Math.max(...counts) : 0;
      return { task: g.task_id, seed: g.seed, k: g.k, winner_share: g.k > 0 ? winner / g.k : 0, passed: g.passed };
    });

  const byTaskArmRate = new Map(pass_rates.map((p) => [`${p.task}|${p.arm}`, p.rate]));
  const cost_vs_accuracy = cost_per_correct.map((c) => ({
    task: c.task,
    arm: c.arm,
    cost_per_correct: c.cost_per_correct,
    rate: byTaskArmRate.get(`${c.task}|${c.arm}`) ?? null,
  }));

  return {
    generated_from: { suite_dir: suiteDir, arm_k_dir: armKDir },
    pass_rates,
    cost_per_correct,
    vote_distributions,
    armk_group_votes,
    cost_vs_accuracy,
    warnings: [...w1, ...w2],
  };
}

async function main() {
  const argv = process.argv.slice(2);
  // Kept as given (not resolve()d to an absolute path): buildFigData records these verbatim in
  // generated_from, and an absolute path would make fig-data.json differ byte-for-byte between a repo
  // root, a worktree, and another machine's checkout even when every number in it is identical.
  const suiteDir = argv[0] && !argv[0].startsWith("--") ? argv.shift()! : "bench/results/rq1-suite";
  const armKDir = argv[0] && !argv[0].startsWith("--") ? argv.shift()! : "bench/results/rq1-arm-k";
  let out = "paper/generated/fig-data.json";
  while (argv.length) {
    const opt = argv.shift();
    if (opt === "--out") out = argv.shift()!;
    else throw Error(`Unknown option ${opt}`);
  }
  const data = buildFigData(suiteDir, armKDir);
  const outPath = resolve(out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(data, null, 2) + "\n");
  console.log(`Wrote ${outPath}`);
  if (data.warnings.length) console.error(`Warnings:\n${data.warnings.map((w) => `- ${w}`).join("\n")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
