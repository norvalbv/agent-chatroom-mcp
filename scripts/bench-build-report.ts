/** Deterministic artifact-to-table reducer for the planted-defect build suite. */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Arm = "A" | "B" | "C";
type Check = { name: string; exit_code: number };
type RawBuildResult = {
  task_id?: unknown;
  arm?: unknown;
  seed?: unknown;
  execution_outcome?: unknown;
  oracle_outcome?: unknown;
  scores?: Record<string, unknown>;
  checks?: { defects?: unknown; regressions?: unknown };
  usage?: { cost_usd?: unknown; coverage?: unknown; thinking_tokens?: unknown; output_tokens?: unknown };
  seat_records?: { thinking_tokens?: unknown; usage?: { output_tokens?: unknown } | null }[];
  wall_clock_ms?: unknown;
  effort?: { level?: unknown; settings_sha256?: unknown; own_git_root?: unknown };
  provenance?: { grid_fingerprint?: unknown; native_run_fingerprint?: unknown; manifest_sha256?: unknown; runner_sha256?: unknown; task_sha256_before_score?: unknown; task_sha256_after_score?: unknown };
};

export interface BuildReportRow {
  task_id: string;
  arm: Arm;
  seed: number;
  status: "valid" | "invalid" | "missing";
  reason: string | null;
  execution_outcome: string | null;
  oracle_outcome: string | null;
  protocol_failure: boolean;
  protocol_success: boolean | null;
  protocol_adjusted_catch_fraction: number | null;
  cost_status: "complete" | "unknown" | "missing";
  defects_caught: number | null;
  defects_total: number | null;
  residual_plants: number | null;
  introduced_regressions: number | null;
  defects_shipped: number | null;
  cost_usd: number | null;
  thinking_tokens: number | null;
  output_tokens: number | null;
  wall_clock_ms: number | null;
  actual_over_cap: boolean | null;
  grid_fingerprint: string | null;
  native_run_fingerprint: string | null;
  defect_checks: Check[];
}

export interface BuildReport {
  schemaVersion: 1;
  nominal_arm_cap_usd: number;
  planned: { tasks: string[]; arms: Arm[]; seeds: number[] };
  rows: BuildReportRow[];
  per_defect: { task_id: string; defect_id: string; caught: number; n: number }[];
  summary: { valid: number; invalid: number; missing: number; protocol_failures: number; unknown_cost: number; actual_over_cap: number; known_cost_usd: number };
}

function natural(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true });
}

function integer(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function checks(value: unknown, prefix: string): { checks: Check[]; reason?: string } {
  if (!Array.isArray(value) || value.length === 0) return { checks: [], reason: `missing ${prefix} checks` };
  const parsed: Check[] = [];
  const names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") return { checks: [], reason: `malformed ${prefix} check` };
    const { name, exit_code } = item as Check;
    if (typeof name !== "string" || !name.startsWith(`${prefix}/`) || (exit_code !== 0 && exit_code !== 1)) return { checks: [], reason: `malformed ${prefix} check` };
    if (names.has(name)) return { checks: [], reason: `duplicate check ${name}` };
    names.add(name);
    parsed.push({ name, exit_code });
  }
  return { checks: parsed.sort((a, b) => natural(a.name, b.name)) };
}

function aggregateSeatField(raw: RawBuildResult, field: "thinking_tokens" | "output_tokens"): number | null {
  const direct = raw.usage?.[field];
  if (integer(direct)) return direct;
  if (!Array.isArray(raw.seat_records) || raw.seat_records.length === 0) return null;
  const values = raw.seat_records.map((seat) => field === "thinking_tokens" ? seat.thinking_tokens : seat.usage?.output_tokens);
  return values.every(integer) ? values.reduce((sum, value) => sum + Number(value), 0) : null;
}

function invalidRow(task: string, arm: Arm, seed: number, reason: string, raw?: RawBuildResult): BuildReportRow {
  return {
    task_id: task, arm, seed, status: "invalid", reason,
    execution_outcome: typeof raw?.execution_outcome === "string" ? raw.execution_outcome : null,
    oracle_outcome: typeof raw?.oracle_outcome === "string" ? raw.oracle_outcome : null,
    protocol_failure: false, protocol_success: null, protocol_adjusted_catch_fraction: null,
    cost_status: raw?.usage?.coverage === "complete" && typeof raw.usage.cost_usd === "number" ? "complete" : "unknown",
    defects_caught: null, defects_total: null, residual_plants: null, introduced_regressions: null,
    defects_shipped: null, cost_usd: typeof raw?.usage?.cost_usd === "number" ? raw.usage.cost_usd : null,
    thinking_tokens: typeof raw?.usage?.thinking_tokens === "number" ? raw.usage.thinking_tokens : null,
    output_tokens: typeof raw?.usage?.output_tokens === "number" ? raw.usage.output_tokens : null,
    wall_clock_ms: typeof raw?.wall_clock_ms === "number" ? raw.wall_clock_ms : null,
    actual_over_cap: null,
    grid_fingerprint: typeof raw?.provenance?.grid_fingerprint === "string" ? raw.provenance.grid_fingerprint : null,
    native_run_fingerprint: typeof raw?.provenance?.native_run_fingerprint === "string" ? raw.provenance.native_run_fingerprint : null,
    defect_checks: [],
  };
}

function validateRaw(raw: RawBuildResult, task: string, arm: Arm, seed: number, cap: number): BuildReportRow {
  if (raw.task_id !== task || raw.arm !== arm || raw.seed !== seed) return invalidRow(task, arm, seed, "cell identity mismatch", raw);
  if (typeof raw.execution_outcome !== "string" || !["completed", "timeout", "invalid_room", "tamper", "infrastructure_error"].includes(raw.execution_outcome)) return invalidRow(task, arm, seed, "unknown execution outcome", raw);
  if (raw.execution_outcome === "tamper" || raw.execution_outcome === "infrastructure_error") return invalidRow(task, arm, seed, `non-scoreable outcome ${raw.execution_outcome}`, raw);
  const fingerprint = raw.provenance?.grid_fingerprint;
  if (!sha256(fingerprint)) return invalidRow(task, arm, seed, "missing grid fingerprint", raw);
  if (!sha256(raw.provenance?.native_run_fingerprint) || !sha256(raw.provenance?.manifest_sha256) || !sha256(raw.provenance?.runner_sha256)) return invalidRow(task, arm, seed, "incomplete launch provenance", raw);
  if (!sha256(raw.provenance.task_sha256_before_score) || raw.provenance.task_sha256_before_score !== raw.provenance.task_sha256_after_score) return invalidRow(task, arm, seed, "task hash changed", raw);
  if (raw.effort?.level !== "medium" || !sha256(raw.effort.settings_sha256) || raw.effort.own_git_root !== true) return invalidRow(task, arm, seed, "effort provenance incomplete", raw);
  const defectSet = checks(raw.checks?.defects, "defect");
  if (defectSet.reason) return invalidRow(task, arm, seed, defectSet.reason, raw);
  const regressionSet = checks(raw.checks?.regressions, "regression");
  if (regressionSet.reason) return invalidRow(task, arm, seed, regressionSet.reason, raw);
  const scores = raw.scores ?? {};
  for (const field of ["defects_caught", "defects_total", "defects_shipped", "regression_failures", "regressions_total"]) {
    if (!integer(scores[field])) return invalidRow(task, arm, seed, `invalid score ${field}`, raw);
  }
  const caught = defectSet.checks.filter((check) => check.exit_code === 0).length;
  const regressions = regressionSet.checks.filter((check) => check.exit_code === 1).length;
  if (scores.defects_total !== defectSet.checks.length || scores.regressions_total !== regressionSet.checks.length || scores.defects_caught !== caught || scores.regression_failures !== regressions) {
    return invalidRow(task, arm, seed, "score/check disagreement", raw);
  }
  const residual = defectSet.checks.length - caught;
  if (scores.defects_shipped !== residual + regressions) return invalidRow(task, arm, seed, "shipped score is not residual plus regressions", raw);
  if (!integer(raw.wall_clock_ms)) return invalidRow(task, arm, seed, "wall time incomplete", raw);
  const rawCost = raw.usage?.cost_usd;
  const costComplete = raw.usage?.coverage === "complete" && typeof rawCost === "number" && Number.isFinite(rawCost) && rawCost >= 0;
  const cost = costComplete ? rawCost : null;
  const protocolFailure = raw.execution_outcome === "timeout" || raw.execution_outcome === "invalid_room";
  return {
    task_id: task, arm, seed, status: "valid", reason: costComplete ? null : "unknown terminal cost",
    execution_outcome: raw.execution_outcome,
    oracle_outcome: typeof raw.oracle_outcome === "string" ? raw.oracle_outcome : null,
    protocol_failure: protocolFailure, protocol_success: !protocolFailure,
    protocol_adjusted_catch_fraction: protocolFailure ? 0 : caught / defectSet.checks.length,
    cost_status: costComplete ? "complete" : "unknown",
    defects_caught: caught, defects_total: defectSet.checks.length, residual_plants: residual,
    introduced_regressions: regressions, defects_shipped: residual + regressions,
    cost_usd: cost, thinking_tokens: aggregateSeatField(raw, "thinking_tokens"), output_tokens: aggregateSeatField(raw, "output_tokens"),
    wall_clock_ms: raw.wall_clock_ms, actual_over_cap: cost === null ? null : cost > cap,
    grid_fingerprint: fingerprint,
    native_run_fingerprint: typeof raw.provenance?.native_run_fingerprint === "string" ? raw.provenance.native_run_fingerprint : null,
    defect_checks: defectSet.checks,
  };
}

export function buildBuildReport(resultsDir: string, tasks: string[], arms: Arm[], seeds: number[], nominalCapUsd: number): BuildReport {
  if (!(nominalCapUsd > 0)) throw new Error("nominal cap must be positive");
  const byCell = new Map<string, RawBuildResult>();
  if (existsSync(resultsDir)) {
    for (const entry of readdirSync(resultsDir).sort(natural)) {
      const path = join(resultsDir, entry, "build-result.json");
      if (!existsSync(path) || !statSync(path).isFile()) continue;
      let raw: RawBuildResult;
      try { raw = JSON.parse(readFileSync(path, "utf8")) as RawBuildResult; }
      catch { throw new Error(`Malformed build-result.json: ${path}`); }
      const key = `${raw.task_id}\0${raw.arm}\0${raw.seed}`;
      if (byCell.has(key)) throw new Error(`Duplicate cell ${String(raw.task_id)} ${String(raw.arm)} ${String(raw.seed)}`);
      byCell.set(key, raw);
    }
  }
  const runnerVersions = new Set<string>();
  for (const raw of byCell.values()) if (typeof raw.provenance?.runner_sha256 === "string") runnerVersions.add(raw.provenance.runner_sha256);
  if (runnerVersions.size > 1) throw new Error("Mixed runner versions in one build report");
  for (const task of tasks) {
    const versions = new Set<string>();
    for (const arm of arms) for (const seed of seeds) {
      const raw = byCell.get(`${task}\0${arm}\0${seed}`);
      const manifest = raw?.provenance?.manifest_sha256;
      const taskHash = raw?.provenance?.task_sha256_before_score;
      if (typeof manifest === "string" && typeof taskHash === "string") versions.add(`${manifest}\0${taskHash}`);
    }
    if (versions.size > 1) throw new Error(`Mixed task/manifest versions for ${task}`);
  }
  const rows: BuildReportRow[] = [];
  for (const task of tasks) for (const arm of arms) for (const seed of seeds) {
    const raw = byCell.get(`${task}\0${arm}\0${seed}`);
    rows.push(raw ? validateRaw(raw, task, arm, seed, nominalCapUsd) : {
      task_id: task, arm, seed, status: "missing", reason: "planned cell absent",
      execution_outcome: null, oracle_outcome: null, protocol_failure: false, protocol_success: null, protocol_adjusted_catch_fraction: null, cost_status: "missing",
      defects_caught: null, defects_total: null, residual_plants: null, introduced_regressions: null,
      defects_shipped: null, cost_usd: null, thinking_tokens: null, output_tokens: null,
      wall_clock_ms: null, actual_over_cap: null, grid_fingerprint: null, native_run_fingerprint: null, defect_checks: [],
    });
  }
  const defectCounts = new Map<string, { task_id: string; defect_id: string; caught: number; n: number }>();
  for (const row of rows.filter((item) => item.status === "valid" && item.arm === "A")) {
    for (const check of row.defect_checks) {
      const defectId = check.name.slice("defect/".length);
      const key = `${row.task_id}\0${defectId}`;
      const count = defectCounts.get(key) ?? { task_id: row.task_id, defect_id: defectId, caught: 0, n: 0 };
      count.n += 1;
      if (check.exit_code === 0) count.caught += 1;
      defectCounts.set(key, count);
    }
  }
  const perDefect = [...defectCounts.values()].sort((a, b) => natural(`${a.task_id}/${a.defect_id}`, `${b.task_id}/${b.defect_id}`));
  return {
    schemaVersion: 1,
    nominal_arm_cap_usd: nominalCapUsd,
    planned: { tasks, arms, seeds },
    rows,
    per_defect: perDefect,
    summary: {
      valid: rows.filter((row) => row.status === "valid").length,
      invalid: rows.filter((row) => row.status === "invalid").length,
      missing: rows.filter((row) => row.status === "missing").length,
      protocol_failures: rows.filter((row) => row.protocol_failure).length,
      unknown_cost: rows.filter((row) => row.status === "valid" && row.cost_status === "unknown").length,
      actual_over_cap: rows.filter((row) => row.actual_over_cap === true).length,
      known_cost_usd: rows.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0),
    },
  };
}

function value(value: number | null, digits = 0): string {
  return value === null ? "unknown" : digits ? value.toFixed(digits) : String(value);
}

export function renderBuildReportMarkdown(report: BuildReport): string {
  const lines = [
    "| task | arm | seed | status | outcome | caught | shipped | new regressions | cost USD | actual > nominal cap | thinking | wall ms |",
    "|---|---:|---:|---|---|---:|---:|---:|---:|---|---:|---:|",
  ];
  for (const row of report.rows) {
    const caught = row.defects_caught === null ? "-" : `${row.defects_caught}/${row.defects_total}`;
    lines.push(`| ${row.task_id} | ${row.arm} | ${row.seed} | ${row.status}${row.protocol_failure ? "/protocol_failure" : ""} | ${row.execution_outcome ?? "-"} | ${caught} | ${value(row.defects_shipped)} | ${value(row.introduced_regressions)} | ${value(row.cost_usd, 4)} | ${row.actual_over_cap === null ? "-" : row.actual_over_cap ? "yes" : "no"} | ${value(row.thinking_tokens)} | ${value(row.wall_clock_ms)} |`);
  }
  lines.push("", `Valid catch rows: ${report.summary.valid}; protocol failures: ${report.summary.protocol_failures}; invalid: ${report.summary.invalid}; missing: ${report.summary.missing}; unknown cost: ${report.summary.unknown_cost}; known cost: $${report.summary.known_cost_usd.toFixed(4)}.`, "", "### Per-defect arm-A catch table", "", "| task | defect | caught | n |", "|---|---|---:|---:|");
  for (const defect of report.per_defect) lines.push(`| ${defect.task_id} | ${defect.defect_id} | ${defect.caught} | ${defect.n} |`);
  return `${lines.join("\n")}\n`;
}

function parseList(value: string | undefined, name: string): string[] {
  if (!value) throw new Error(`--${name} is required`);
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (!values.length || new Set(values).size !== values.length) throw new Error(`--${name} must be a unique comma-list`);
  return values;
}

function parseSeedList(value: string | undefined): number[] {
  const parts = parseList(value, "seeds");
  const seeds: number[] = [];
  for (const part of parts) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) for (let seed = Number(range[1]); seed <= Number(range[2]); seed++) seeds.push(seed);
    else {
      const seed = Number(part);
      if (!Number.isInteger(seed)) throw new Error(`Invalid seed ${part}`);
      seeds.push(seed);
    }
  }
  return seeds;
}

function cliFlag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function main() {
  const argv = process.argv.slice(2);
  const results = resolve(cliFlag(argv, "results") ?? "bench/results/build-suite");
  const tasks = parseList(cliFlag(argv, "tasks"), "tasks");
  const arms = parseList(cliFlag(argv, "arms") ?? "A,B,C", "arms") as Arm[];
  if (arms.some((arm) => !["A", "B", "C"].includes(arm))) throw new Error("Invalid arm");
  const seeds = parseSeedList(cliFlag(argv, "seeds"));
  const cap = Number(cliFlag(argv, "arm-cap-usd") ?? "2");
  const report = buildBuildReport(results, tasks, arms, seeds, cap);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderBuildReportMarkdown(report);
  const outJson = cliFlag(argv, "out-json");
  const outMarkdown = cliFlag(argv, "out-md");
  if (outJson) writeFileSync(resolve(outJson), json);
  if (outMarkdown) writeFileSync(resolve(outMarkdown), markdown);
  if (!outJson && !outMarkdown) process.stdout.write(markdown);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { process.stderr.write(`${error}\n`); process.exitCode = 1; }
}
