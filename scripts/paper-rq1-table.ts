/**
 * Reads a directory of RQ1 run directories, each holding one `result.json` written by
 * scripts/bench-rq1.ts (schema on the room's board, key `result-schema`; one run per (task, arm, seed)):
 * {schemaVersion, task_id, arm, seed, model, outcome, passed, reason, usage: UsageRollup (src/result.ts;
 * cost_usd + claude's input/cache_read/cache_creation/output token fields), turns:{summed,...},
 * wall_clock:{started_at,completed_at,duration_ms}, ...}. Emits the RQ1 table + figure data as CSV and
 * markdown, so no number in the paper is hand-typed. Task success denominator and the arm-pair
 * significance test follow paper/protocol.md §4/§5 exactly (see rq1-stats.ts for the test
 * implementations).
 *
 * Usage: node --import tsx scripts/paper-rq1-table.ts RESULTS_DIR [--out PREFIX]
 *   RESULTS_DIR holds one subdirectory per run, each containing result.json (scripts/bench-grid.ts's own
 *   layout: RESULTS_DIR/<task>-<arm>-seed<seed>/result.json). Writes PREFIX.csv and PREFIX.md (default
 *   PREFIX: RESULTS_DIR/rq1-table). Always also prints the markdown to stdout.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { proportionTest } from "./rq1-stats.js";

export interface RunResult {
  schemaVersion: 1;
  task_id: string;
  arm: string;
  seed: number;
  model: string;
  outcome: string;
  usage: {
    cost_usd: number;
    coverage: "complete" | "partial" | "none";
    seats: number;
    seats_with_usage: number;
    input_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    output_tokens?: number;
  };
  turns: { summed: number; coverage: "complete" | "partial" | "none" };
  wall_clock: { started_at: string; completed_at: string; duration_ms: number };
}

// Outcomes excluded from the success-rate denominator (paper/protocol.md §4).
const NOT_COMPARABLE_FOR_SUCCESS = new Set(["parse_failure", "timeout", "infrastructure_error"]);
// Outcomes excluded from the existing bench-compare "comparable" flag (§2.4/§4, matches bench-bench.ts).
const NOT_COMPARABLE_FLAG = new Set(["timeout", "infrastructure_error", "tamper"]);

export interface LoadResult {
  runs: RunResult[];
  warnings: string[];
}

/**
 * Tolerant reader: accepts either RESULTS_DIR/<run>/result.json (bench-rq1.ts's own --root layout, used
 * by bench-grid.ts) or a flat RESULTS_DIR/*.json (for hand-built fixtures); skips and warns on anything
 * that isn't a schemaVersion:1 run result, never throws.
 */
export function loadRunResults(dir: string): LoadResult {
  const warnings: string[] = [];
  const runs: RunResult[] = [];
  if (!existsSync(dir)) return { runs, warnings: [`results dir does not exist: ${dir}`] };
  const tryLoad = (path: string, label: string) => {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (parsed?.schemaVersion !== 1 || typeof parsed.task_id !== "string" || typeof parsed.arm !== "string" ||
          typeof parsed.seed !== "number" || typeof parsed.outcome !== "string" || !parsed.usage ||
          typeof parsed.usage.cost_usd !== "number" || !parsed.wall_clock?.started_at || !parsed.wall_clock?.completed_at) {
        warnings.push(`skipped (not a schemaVersion:1 run result): ${label}`);
        return;
      }
      runs.push(parsed as RunResult);
    } catch (e) {
      warnings.push(`skipped (invalid JSON): ${label}: ${String(e)}`);
    }
  };
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      const resultPath = join(path, "result.json");
      if (existsSync(resultPath)) tryLoad(resultPath, `${name}/result.json`);
      else warnings.push(`skipped (no result.json): ${name}/`);
    } else if (name.endsWith(".json")) {
      tryLoad(path, name);
    }
  }
  return { runs, warnings };
}

export interface CellStats {
  task: string;
  arm: string;
  n: number;
  outcome_counts: Record<string, number>;
  comparable_n: number;
  success_denominator: number;
  task_pass: number;
  task_fail: number;
  success_rate: number | null;
  cost_per_correct: number | "undefined";
  mean_tokens: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; output_tokens: number };
  mean_turns: number | null;
  any_turns_partial: boolean;
  mean_wall_ms: number | null;
  partial_coverage: boolean;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function computeCell(task: string, arm: string, runs: RunResult[]): CellStats {
  const outcome_counts: Record<string, number> = {};
  for (const r of runs) outcome_counts[r.outcome] = (outcome_counts[r.outcome] ?? 0) + 1;
  const comparable_n = runs.filter((r) => !NOT_COMPARABLE_FLAG.has(r.outcome)).length;
  const task_pass = outcome_counts.task_pass ?? 0;
  const task_fail = outcome_counts.task_fail ?? 0;
  const success_denominator = runs.filter((r) => !NOT_COMPARABLE_FOR_SUCCESS.has(r.outcome)).length;
  const success_rate = success_denominator > 0 ? task_pass / success_denominator : null;
  const totalCost = runs.reduce((a, r) => a + r.usage.cost_usd, 0);
  const cost_per_correct = task_pass > 0 ? totalCost / task_pass : ("undefined" as const);
  const mean_tokens = {
    input_tokens: mean(runs.map((r) => r.usage.input_tokens ?? 0)) ?? 0,
    cache_read_input_tokens: mean(runs.map((r) => r.usage.cache_read_input_tokens ?? 0)) ?? 0,
    cache_creation_input_tokens: mean(runs.map((r) => r.usage.cache_creation_input_tokens ?? 0)) ?? 0,
    output_tokens: mean(runs.map((r) => r.usage.output_tokens ?? 0)) ?? 0,
  };
  const turnValues = runs.map((r) => r.turns?.summed).filter((v): v is number => typeof v === "number");
  const mean_turns = mean(turnValues);
  const any_turns_partial = runs.some((r) => r.turns?.coverage !== "complete");
  const mean_wall_ms = mean(runs.map((r) => r.wall_clock.duration_ms));
  const partial_coverage = runs.some((r) => r.usage.coverage !== "complete");
  return { task, arm, n: runs.length, outcome_counts, comparable_n, success_denominator, task_pass, task_fail, success_rate, cost_per_correct, mean_tokens, mean_turns, any_turns_partial, mean_wall_ms, partial_coverage };
}

export interface ArmPairTest {
  task: string;
  arm_a: string;
  arm_b: string;
  test: string;
  p_value: number | null;
  significant_at_0_05: boolean | null;
}

export function buildTable(runs: RunResult[]): { cells: CellStats[]; tests: ArmPairTest[] } {
  const byTask = new Map<string, Map<string, RunResult[]>>();
  for (const r of runs) {
    if (!byTask.has(r.task_id)) byTask.set(r.task_id, new Map());
    const byArm = byTask.get(r.task_id)!;
    if (!byArm.has(r.arm)) byArm.set(r.arm, []);
    byArm.get(r.arm)!.push(r);
  }
  const cells: CellStats[] = [];
  const tests: ArmPairTest[] = [];
  for (const [task, byArm] of [...byTask.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const taskCells = new Map<string, CellStats>();
    for (const [arm, armRuns] of [...byArm.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const cell = computeCell(task, arm, armRuns);
      cells.push(cell);
      taskCells.set(arm, cell);
    }
    // RQ1's primary comparison is A vs C; test it whenever both are present for this task.
    if (taskCells.has("A") && taskCells.has("C")) {
      const a = taskCells.get("A")!, c = taskCells.get("C")!;
      const result = proportionTest(a.task_pass, a.task_fail, c.task_pass, c.task_fail);
      tests.push({ task, arm_a: "A", arm_b: "C", test: result.test, p_value: result.p_value, significant_at_0_05: result.p_value === null ? null : result.p_value < 0.05 });
    }
  }
  return { cells, tests };
}

function fmtNum(n: number | null, digits = 3): string {
  return n === null ? "n/a" : n.toFixed(digits);
}
function fmtCost(c: number | "undefined"): string {
  return c === "undefined" ? "undefined (no task_pass)" : `$${c.toFixed(4)}`;
}

export function renderMarkdown(cells: CellStats[], tests: ArmPairTest[], warnings: string[]): string {
  let md = "# RQ1 table (generated, do not hand-edit)\n\n";
  if (warnings.length) md += `**Warnings:**\n${warnings.map((w) => `- ${w}`).join("\n")}\n\n`;
  md += "## Per (task, arm)\n\n";
  md += "| task | arm | n | task_pass | task_fail | parse_failure | timeout | infra_error | comparable_n | success_rate | cost_per_correct | mean_input_tok | mean_cache_read_tok | mean_cache_creation_tok | mean_output_tok | mean_turns | mean_wall_ms |\n";
  md += "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n";
  for (const c of cells) {
    const partial = c.partial_coverage ? " (partial)" : "";
    md += `| ${c.task} | ${c.arm} | ${c.n} | ${c.outcome_counts.task_pass ?? 0} | ${c.outcome_counts.task_fail ?? 0} | ${c.outcome_counts.parse_failure ?? 0} | ${c.outcome_counts.timeout ?? 0} | ${c.outcome_counts.infrastructure_error ?? 0} | ${c.comparable_n} | ${fmtNum(c.success_rate)}${partial} | ${fmtCost(c.cost_per_correct)} | ${fmtNum(c.mean_tokens.input_tokens, 1)} | ${fmtNum(c.mean_tokens.cache_read_input_tokens, 1)} | ${fmtNum(c.mean_tokens.cache_creation_input_tokens, 1)} | ${fmtNum(c.mean_tokens.output_tokens, 1)} | ${fmtNum(c.mean_turns, 2)}${c.any_turns_partial ? " (partial)" : ""} | ${fmtNum(c.mean_wall_ms, 0)} |\n`;
  }
  md += "\n## Arm A vs Arm C significance (paper/protocol.md §5: two-proportion z-test, or Fisher's exact when any cell <5)\n\n";
  md += "| task | test | p_value | significant (α=0.05) |\n|---|---|---|---|\n";
  for (const t of tests) md += `| ${t.task} | ${t.test} | ${t.p_value === null ? "n/a" : t.p_value.toFixed(6)} | ${t.significant_at_0_05 === null ? "n/a" : t.significant_at_0_05} |\n`;
  return md;
}

export function renderCsv(cells: CellStats[]): string {
  const header = ["task", "arm", "n", "task_pass", "task_fail", "parse_failure", "timeout", "infrastructure_error", "comparable_n", "success_rate", "cost_per_correct_usd", "mean_input_tokens", "mean_cache_read_tokens", "mean_cache_creation_tokens", "mean_output_tokens", "mean_turns", "turns_partial_coverage", "mean_wall_ms", "partial_coverage"];
  const rows = cells.map((c) => [
    c.task, c.arm, c.n, c.outcome_counts.task_pass ?? 0, c.outcome_counts.task_fail ?? 0, c.outcome_counts.parse_failure ?? 0, c.outcome_counts.timeout ?? 0, c.outcome_counts.infrastructure_error ?? 0,
    c.comparable_n, c.success_rate ?? "", c.cost_per_correct === "undefined" ? "undefined" : c.cost_per_correct,
    c.mean_tokens.input_tokens, c.mean_tokens.cache_read_input_tokens, c.mean_tokens.cache_creation_input_tokens, c.mean_tokens.output_tokens,
    c.mean_turns ?? "", c.any_turns_partial, c.mean_wall_ms ?? "", c.partial_coverage,
  ]);
  return [header, ...rows].map((row) => row.join(",")).join("\n") + "\n";
}

async function main() {
  const argv = process.argv.slice(2);
  const dirArg = argv.shift();
  if (!dirArg) throw Error("Usage: paper-rq1-table.ts RESULTS_DIR [--out PREFIX]");
  let out: string | undefined;
  while (argv.length) {
    const opt = argv.shift();
    if (opt === "--out") out = argv.shift();
    else throw Error(`Unknown option ${opt}`);
  }
  const dir = resolve(dirArg);
  const prefix = resolve(out ?? join(dir, "rq1-table"));
  const { runs, warnings } = loadRunResults(dir);
  const { cells, tests } = buildTable(runs);
  const md = renderMarkdown(cells, tests, warnings);
  const csv = renderCsv(cells);
  mkdirSync(dirname(prefix), { recursive: true });
  writeFileSync(`${prefix}.md`, md);
  writeFileSync(`${prefix}.csv`, csv);
  console.log(md);
  console.error(`Wrote ${prefix}.md and ${prefix}.csv`);
}

if (process.argv[1] && resolve(process.argv[1]).endsWith("paper-rq1-table.ts")) {
  main().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
