/**
 * Arm K statistics (paper/prereg-arm-k.md): k independent arm-A attempts per (task, seed), one submitted by
 * an oracle-free selector. Reads group results from an arm-K directory (bench/results/rq1-arm-k) and the
 * arm A / arm C runs from the suite directory (bench/results/rq1-suite, never modified). Reports K vs C and
 * K vs A by Fisher's exact test with Holm-Bonferroni across every arm-K comparison, cost per correct answer,
 * the vote distribution per group, and the oracle ceiling (any of the k attempts passes), which is a bound
 * and NOT an arm.
 *
 * Usage: node --import tsx scripts/paper-rq1-armk.ts SUITE_DIR ARM_K_DIR [--out PREFIX]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeCell, loadRunResults, type RunResult } from "./paper-rq1-table.js";
import { fisherExactTest, holmBonferroni } from "./rq1-stats.js";

export interface KAttempt {
  index: number;
  answer: string | null;
  passed: boolean;
  outcome: string;
  /** null = usage lost for this attempt; never summed as zero. */
  cost_usd: number | null;
}

export interface KGroup extends Omit<RunResult, "usage"> {
  usage: { cost_usd: number | null; coverage: "complete" | "partial" | "none" };
  k: number;
  passed: boolean;
  selection: { rule: string; winner_attempt: number | null; votes: Record<string, number> };
  attempts: KAttempt[];
}

export function loadKGroups(dir: string): { groups: KGroup[]; warnings: string[] } {
  const groups: KGroup[] = [];
  const warnings: string[] = [];
  if (!existsSync(dir)) return { groups, warnings: [`arm-K dir does not exist: ${dir}`] };
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name, "result.json");
    if (!existsSync(path)) continue;
    try {
      const p = JSON.parse(readFileSync(path, "utf8"));
      if (p?.schemaVersion !== 1 || p.arm !== "K" || typeof p.task_id !== "string" || typeof p.seed !== "number" ||
          !Array.isArray(p.attempts) || !p.usage || typeof p.selection?.votes !== "object") {
        warnings.push(`skipped (not an arm-K group result): ${name}/result.json`);
        continue;
      }
      groups.push(p as KGroup);
    } catch (e) {
      warnings.push(`skipped (invalid JSON): ${name}/result.json: ${String(e)}`);
    }
  }
  return { groups, warnings };
}

export interface KComparison {
  vs: "C" | "A";
  k_pass: number; k_n: number; other_pass: number; other_n: number;
  test: "fisher";
  p_value: number | null;
  p_holm: number | null;
  significant_holm_0_05: boolean | null;
}

export interface KTaskRow {
  task: string;
  k_groups: number;
  k_pass: number;
  k_fail: number;
  comparisons: KComparison[];
  /** Total known cost / passes; "unknown" when any group's cost is unknown, "undefined" with no pass. */
  cost_per_correct: number | "unknown" | "undefined";
  mean_cost_known: number | null;
  cost_unknown_groups: number;
  mean_cost_c: number | null;
  mean_cost_a: number | null;
  /** Realized mean K spend per seed must not exceed arm C's (prereg). null when either is unknown. */
  matched_cost_ok: boolean | null;
  /** Vote distribution per group: sorted counts of distinct answers ("7-2-1") -> number of groups. */
  vote_distribution: Record<string, number>;
  /** NOT an arm: the bound on what any selector could reach. */
  ceiling: { any_pass: number; groups: number; rate: number | null };
}

export interface KTable { tasks: KTaskRow[]; }

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

function voteShape(votes: Record<string, number>): string {
  const counts = Object.values(votes).sort((a, b) => b - a);
  return counts.length ? counts.join("-") : "none";
}

export function buildArmKTable(suiteRuns: RunResult[], groups: KGroup[]): KTable {
  const tasks = [...new Set(groups.map((g) => g.task_id))].sort();
  const rows: KTaskRow[] = [];
  const pending: { row: KTaskRow; cmp: KComparison }[] = [];
  for (const task of tasks) {
    const gs = groups.filter((g) => g.task_id === task);
    const kPass = gs.filter((g) => g.passed).length;
    const row: KTaskRow = {
      task, k_groups: gs.length, k_pass: kPass, k_fail: gs.length - kPass, comparisons: [],
      cost_per_correct: "undefined", mean_cost_known: null, cost_unknown_groups: 0, mean_cost_c: null, mean_cost_a: null,
      matched_cost_ok: null, vote_distribution: {}, ceiling: { any_pass: 0, groups: gs.length, rate: null },
    };
    const known = gs.filter((g) => typeof g.usage.cost_usd === "number" && g.usage.coverage === "complete");
    row.cost_unknown_groups = gs.length - known.length;
    row.mean_cost_known = mean(known.map((g) => g.usage.cost_usd as number));
    if (kPass > 0) row.cost_per_correct = row.cost_unknown_groups > 0 ? "unknown" : known.reduce((a, g) => a + (g.usage.cost_usd as number), 0) / kPass;
    for (const g of gs) {
      const shape = voteShape(g.selection.votes);
      row.vote_distribution[shape] = (row.vote_distribution[shape] ?? 0) + 1;
    }
    row.ceiling.any_pass = gs.filter((g) => g.attempts.some((a) => a.passed)).length;
    row.ceiling.rate = gs.length ? row.ceiling.any_pass / gs.length : null;
    for (const vs of ["C", "A"] as const) {
      const cell = computeCell(task, vs, suiteRuns.filter((r) => r.task_id === task && r.arm === vs));
      if (vs === "C") row.mean_cost_c = cell.n ? mean(suiteRuns.filter((r) => r.task_id === task && r.arm === "C").map((r) => r.usage.cost_usd)) : null;
      else row.mean_cost_a = cell.n ? mean(suiteRuns.filter((r) => r.task_id === task && r.arm === "A").map((r) => r.usage.cost_usd)) : null;
      if (!cell.n) continue;
      const f = fisherExactTest(kPass, gs.length - kPass, cell.task_pass, cell.task_fail);
      const cmp: KComparison = { vs, k_pass: kPass, k_n: gs.length, other_pass: cell.task_pass, other_n: cell.task_pass + cell.task_fail, test: "fisher", p_value: f.p_value, p_holm: null, significant_holm_0_05: null };
      row.comparisons.push(cmp);
      pending.push({ row, cmp });
    }
    if (row.cost_unknown_groups === 0 && row.mean_cost_known !== null && row.mean_cost_c !== null) row.matched_cost_ok = row.mean_cost_known <= row.mean_cost_c;
    rows.push(row);
  }
  const withP = pending.filter((x) => x.cmp.p_value !== null);
  const adj = holmBonferroni(withP.map((x) => x.cmp.p_value as number));
  withP.forEach((x, i) => { x.cmp.p_holm = adj[i]; x.cmp.significant_holm_0_05 = adj[i] < 0.05; });
  return { tasks: rows };
}

const fmt = (n: number | null, d = 4) => (n === null ? "n/a" : n.toFixed(d));

export function renderArmKMarkdown(t: KTable): string {
  let md = "## Arm K (k independent single-agent attempts, oracle-free selection)\n\n";
  md += `Holm-Bonferroni is applied across all ${t.tasks.reduce((a, r) => a + r.comparisons.length, 0)} arm-K comparisons below (K vs C and K vs A, every task).\n\n`;
  md += "| task | groups | K pass | K vs | other pass/n | Fisher p | Holm p | significant (Holm, 0.05) |\n|---|---|---|---|---|---|---|---|\n";
  for (const r of t.tasks) for (const c of r.comparisons)
    md += `| ${r.task} | ${r.k_groups} | ${r.k_pass}/${r.k_groups} | ${c.vs} | ${c.other_pass}/${c.other_n} | ${fmt(c.p_value, 6)} | ${fmt(c.p_holm, 6)} | ${c.significant_holm_0_05 ?? "n/a"} |\n`;
  md += "\n### Cost (arm K cost is the sum over all k attempts, killed attempts included)\n\n";
  md += "| task | mean K cost/seed (known) | groups with unknown cost | mean C cost | mean A cost | K <= C | K cost per correct |\n|---|---|---|---|---|---|---|\n";
  for (const r of t.tasks) {
    const cpc = typeof r.cost_per_correct === "number" ? `$${r.cost_per_correct.toFixed(4)}` : r.cost_per_correct;
    md += `| ${r.task} | ${fmt(r.mean_cost_known)} | ${r.cost_unknown_groups} | ${fmt(r.mean_cost_c)} | ${fmt(r.mean_cost_a)} | ${r.matched_cost_ok ?? "unknown"} | ${cpc} |\n`;
  }
  md += "\n### Vote distribution per group (sorted answer counts, e.g. 7-2-1 = seven attempts agree, two agree, one alone; none = no attempt answered)\n\n";
  for (const r of t.tasks) md += `- ${r.task}: ${Object.entries(r.vote_distribution).sort(([, a], [, b]) => b - a).map(([s, n]) => `${s} x${n}`).join(", ") || "n/a"}\n`;
  md += "\n### Oracle ceiling (NOT an arm: any of the k attempts passes; a bound on what selection could reach, never a result)\n\n";
  md += "| task | groups where any attempt passes | ceiling |\n|---|---|---|\n";
  for (const r of t.tasks) md += `| ${r.task} | ${r.ceiling.any_pass}/${r.ceiling.groups} | ${fmt(r.ceiling.rate, 3)} |\n`;
  return md;
}

async function main() {
  const argv = process.argv.slice(2);
  const suite = argv.shift(), armK = argv.shift();
  if (!suite || !armK) throw Error("Usage: paper-rq1-armk.ts SUITE_DIR ARM_K_DIR [--out PREFIX]");
  let out: string | undefined;
  while (argv.length) {
    const opt = argv.shift();
    if (opt === "--out") out = argv.shift();
    else throw Error(`Unknown option ${opt}`);
  }
  const { runs, warnings: w1 } = loadRunResults(resolve(suite));
  const { groups, warnings: w2 } = loadKGroups(resolve(armK));
  const md = renderArmKMarkdown(buildArmKTable(runs, groups)) + [...w1, ...w2].map((w) => `\n- warning: ${w}`).join("");
  const prefix = resolve(out ?? join(resolve(armK), "rq1-arm-k-table"));
  mkdirSync(dirname(prefix), { recursive: true });
  writeFileSync(`${prefix}.md`, md);
  console.log(md);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(String(error)); process.exitCode = 1; });
}
