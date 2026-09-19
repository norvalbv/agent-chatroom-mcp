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
  /** Harness-defined: no result, killed by cap/deadline, no answer (exact tasks) or candidate failed to load (code tasks). answer===null is NOT this: a code task never writes answer.txt. Optional because the current scripts/bench-ak.ts does not emit it yet; isNullVote() falls back to the outcome/killed/runner_failure fields it does emit. */
  null_vote?: boolean;
  passed: boolean;
  outcome: string;
  killed_by_deadline?: boolean;
  runner_failure?: string | null;
  /** null = usage lost for this attempt; never summed as zero. */
  cost_usd: number | null;
}

/** A null vote is an attempt that produced nothing to vote on: killed by its cap or deadline, the runner failed, or no result. An answer of null alone is not one (code tasks have no answer.txt). Trusts an explicit null_vote field when the runner sets one; otherwise infers it from the fields scripts/bench-ak.ts does emit. */
export function isNullVote(a: KAttempt): boolean {
  if (typeof a.null_vote === "boolean") return a.null_vote;
  return a.killed_by_deadline === true || !!a.runner_failure || a.outcome === "timeout" || a.outcome === "no_result" || a.outcome === "infrastructure_error";
}

export interface KGroup extends Omit<RunResult, "usage"> {
  /** coverage is absent in scripts/bench-ak.ts output, which writes cost_usd null instead when any attempt cost is unknown. */
  usage: { cost_usd: number | null; coverage?: "complete" | "partial" | "none" };
  k: number;
  passed: boolean;
  selection: { rule: string; winner_attempt: number | null; votes: Record<string, number>; /** code tasks: per attempt, whether its candidate produced a signature */ loaded?: boolean[] };
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
      if ((p?.schemaVersion !== 1 && p?.schemaVersion !== 2) || p.arm !== "K" || typeof p.task_id !== "string" || typeof p.seed !== "number" ||
          !Array.isArray(p.attempts) || !p.usage || typeof p.selection?.votes !== "object") {
        warnings.push(`skipped (not an arm-K group result): ${name}/result.json`);
        continue;
      }
      // null_vote is optional (see KAttempt/isNullVote): scripts/bench-ak.ts's actual output does not set it, and
      // isNullVote() falls back to outcome/killed_by_deadline/runner_failure, which every real group does carry.
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
  /** Mean arm-C cost over the same seeds that have a known-cost K group (paired by seed). */
  mean_cost_c: number | null;
  /** Mean of (K cost - C cost) over those paired seeds. */
  paired_cost_diff: number | null;
  mean_cost_a: number | null;
  /** Attempts with no answer (killed by cap/deadline or unparsable): null votes, still in the group and its cost. */
  null_attempts: number;
  /** Selector-side, its own column: attempts that completed and were paid for but whose candidate has no signature (selection.loaded false). Never folded into null_attempts, the harness-side starvation detector. */
  unloadable_candidates: number;
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

export interface KTableOptions {
  /** Holm family size, fixed in paper/amendments.md so it never shrinks on partial data (3 tasks x {K vs C, K vs A}). */
  familySize?: number;
  /** Confirmatory seed range; pilot seeds (1 to 3) stay out of the test. */
  seedMin?: number;
  seedMax?: number;
}

export function buildArmKTable(suiteRuns: RunResult[], allGroups: KGroup[], opts: KTableOptions = {}): KTable {
  const { familySize = 6, seedMin = 101, seedMax = 140 } = opts;
  const groups = allGroups.filter((g) => g.seed >= seedMin && g.seed <= seedMax);
  const tasks = [...new Set(groups.map((g) => g.task_id))].sort();
  const rows: KTaskRow[] = [];
  const pending: { row: KTaskRow; cmp: KComparison }[] = [];
  for (const task of tasks) {
    const gs = groups.filter((g) => g.task_id === task);
    const kPass = gs.filter((g) => g.passed).length;
    const row: KTaskRow = {
      task, k_groups: gs.length, k_pass: kPass, k_fail: gs.length - kPass, comparisons: [],
      cost_per_correct: "undefined", mean_cost_known: null, cost_unknown_groups: 0, mean_cost_c: null, paired_cost_diff: null, mean_cost_a: null,
      null_attempts: 0, unloadable_candidates: 0, matched_cost_ok: null, vote_distribution: {}, ceiling: { any_pass: 0, groups: gs.length, rate: null },
    };
    // src/result.ts stores lost usage as cost_usd 0 with coverage none/partial, so a number alone is not "known".
    const known = gs.filter((g) => typeof g.usage.cost_usd === "number" && (g.usage.coverage === undefined || g.usage.coverage === "complete") && g.attempts.every((a) => typeof a.cost_usd === "number"));
    row.null_attempts = gs.reduce((n, g) => n + g.attempts.filter(isNullVote).length, 0);
    row.unloadable_candidates = gs.reduce((n, g) => n + g.attempts.filter((a, i) => !isNullVote(a) && g.selection.loaded?.[i] === false).length, 0);
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
      if (vs === "C") {
        const cBySeed = new Map(suiteRuns.filter((r) => r.task_id === task && r.arm === "C" && r.usage.coverage === "complete").map((r) => [r.seed, r.usage.cost_usd]));
        const paired = known.filter((g) => cBySeed.has(g.seed));
        row.mean_cost_c = mean(paired.map((g) => cBySeed.get(g.seed) as number));
        row.paired_cost_diff = mean(paired.map((g) => (g.usage.cost_usd as number) - (cBySeed.get(g.seed) as number)));
      } else row.mean_cost_a = cell.n ? mean(suiteRuns.filter((r) => r.task_id === task && r.arm === "A").map((r) => r.usage.cost_usd)) : null;
      if (!cell.n) continue;
      const f = fisherExactTest(kPass, gs.length - kPass, cell.task_pass, cell.task_fail);
      const cmp: KComparison = { vs, k_pass: kPass, k_n: gs.length, other_pass: cell.task_pass, other_n: cell.task_pass + cell.task_fail, test: "fisher", p_value: f.p_value, p_holm: null, significant_holm_0_05: null };
      row.comparisons.push(cmp);
      pending.push({ row, cmp });
    }
    // Prereg: judged on realized mean spend per seed, so compare over paired seeds only; any unknown group makes it unknown.
    if (row.cost_unknown_groups === 0 && row.paired_cost_diff !== null) row.matched_cost_ok = row.paired_cost_diff <= 0;
    rows.push(row);
  }
  const withP = pending.filter((x) => x.cmp.p_value !== null);
  // Missing family members count as p=1 so m stays fixed and never shrinks on partial data.
  const padded = [...withP.map((x) => x.cmp.p_value as number), ...new Array(Math.max(0, familySize - withP.length)).fill(1)];
  const adj = holmBonferroni(padded);
  withP.forEach((x, i) => { x.cmp.p_holm = adj[i]; x.cmp.significant_holm_0_05 = adj[i] < 0.05; });
  return { tasks: rows };
}

const fmt = (n: number | null, d = 4) => (n === null ? "n/a" : n.toFixed(d));

export function renderArmKMarkdown(t: KTable): string {
  let md = "## Arm K (k independent single-agent attempts, oracle-free selection)\n\n";
  md += `Holm-Bonferroni over a fixed family of 6 (3 tasks x {K vs C, K vs A}), two-sided unpaired Fisher on K groups vs all arm A/C runs of the task, raw and adjusted p side by side; ceiling rows are outside the family.\n\n`;
  md += "| task | groups | K pass | K vs | other pass/n | Fisher p | Holm p | significant (Holm, 0.05) |\n|---|---|---|---|---|---|---|---|\n";
  for (const r of t.tasks) for (const c of r.comparisons)
    md += `| ${r.task} | ${r.k_groups} | ${r.k_pass}/${r.k_groups} | ${c.vs} | ${c.other_pass}/${c.other_n} | ${fmt(c.p_value, 6)} | ${fmt(c.p_holm, 6)} | ${c.significant_holm_0_05 ?? "n/a"} |\n`;
  md += "\n### Cost (arm K cost is the sum over all k attempts, killed attempts included)\n\n";
  md += "| task | mean K cost/seed (known) | groups with unknown cost | null votes | unloadable candidates | paired mean C cost | K-C paired diff | mean A cost (all seeds) | K <= C | K cost per correct |\n|---|---|---|---|---|---|---|---|---|---|\n";
  for (const r of t.tasks) {
    const cpc = typeof r.cost_per_correct === "number" ? `$${r.cost_per_correct.toFixed(4)}` : r.cost_per_correct;
    md += `| ${r.task} | ${fmt(r.mean_cost_known)} | ${r.cost_unknown_groups} | ${r.null_attempts} | ${r.unloadable_candidates} | ${fmt(r.mean_cost_c)} | ${fmt(r.paired_cost_diff)} | ${fmt(r.mean_cost_a)} | ${r.matched_cost_ok ?? "unknown"} | ${cpc} |\n`;
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
