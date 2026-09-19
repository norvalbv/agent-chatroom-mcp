/**
 * Mechanical reducer for planted-defect build runs.
 *
 * The stage-aware bench-build-runner.ts owns
 * copying only public fixtures, seat launch/provenance, and anti-tamper hashing.
 * A build task's private scorer must return named `defect/<id>` and
 * `regression/<id>` results (exit 0 fixed/preserved, exit 1 unfixed/broken).
 * The wrapper records the two pre-registered scores without any model judge.
 *
 * node --import tsx scripts/bench-build.ts TASK_DIR ARM(A|B|C) SEED --root DIR
 *   [--runner PATH] [native runner flags]
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

type Check = { name: string; exit_code: number };
type RawResult = {
  task_id: string;
  arm: "A" | "B" | "C";
  seed: number;
  outcome?: string;
  error?: string;
  outcome_evidence?: Record<string, unknown>;
  run_config?: unknown;
  run_fingerprint?: string;
  review_integrity?: { unchanged?: boolean; workspace_sha256_before?: string; workspace_sha256_after?: string };
  room_validation?: { state?: string; proposal_id?: string; verified?: boolean; verifier_session_distinct?: boolean; distinct_sessions?: number };
  anti_tamper?: { unchanged?: boolean };
  effort?: { level?: string; settings_path?: string; settings_sha256?: string; own_git_root?: boolean };
  usage?: { cost_usd?: number | null; coverage?: string };
  turns?: { summed?: number };
  wall_clock?: { duration_ms?: number };
  seats?: unknown[];
};
type ExpectedMatrix = { defect_ids: string[]; regression_ids: string[] };

const here = dirname(fileURLToPath(import.meta.url));
function fail(message: string): never { throw new Error(`bench-build: ${message}`); }

function hashTree(path: string): string {
  const hash = createHash("sha256");
  const visit = (entry: string) => {
    const stat = lstatSync(entry);
    if (stat.isSymbolicLink()) fail(`symlink in scored task: ${relative(path, entry)}`);
    if (stat.isDirectory()) for (const child of readdirSync(entry).sort()) visit(join(entry, child));
    else if (stat.isFile()) { hash.update(relative(path, entry)); hash.update("\0"); hash.update(readFileSync(entry)); hash.update("\0"); }
  };
  visit(path);
  return hash.digest("hex");
}

function takeFlag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) fail(`--${name} needs a value`);
  argv.splice(index, 2);
  return value;
}

function classify(checks: unknown): { defects: Check[]; regressions: Check[] } {
  if (!Array.isArray(checks) || checks.length === 0) fail("private scorer emitted no named checks");
  const defects: Check[] = [];
  const regressions: Check[] = [];
  const names = new Set<string>();
  for (const item of checks) {
    if (!item || typeof item !== "object") fail("private scorer emitted a malformed check");
    const { name, exit_code } = item as Check;
    if (typeof name !== "string" || !name) fail("private scorer emitted an unnamed check");
    if (!Number.isInteger(exit_code) || (exit_code !== 0 && exit_code !== 1)) fail(`check ${name} has non-binary exit code`);
    if (names.has(name)) fail(`duplicate private check ${name}`);
    names.add(name);
    if (name.startsWith("defect/") && name.length > "defect/".length) defects.push({ name, exit_code });
    else if (name.startsWith("regression/") && name.length > "regression/".length) regressions.push({ name, exit_code });
    else fail(`check ${name} is neither named defect nor regression`);
  }
  if (!defects.length) fail("private scorer emitted no defect/<id> checks");
  if (!regressions.length) fail("private scorer emitted no regression/<id> checks");
  return { defects, regressions };
}

function expectedMatrix(taskDir: string): ExpectedMatrix {
  let parsed: { build_suite?: ExpectedMatrix };
  try { parsed = JSON.parse(readFileSync(join(taskDir, "task.json"), "utf8")) as { build_suite?: ExpectedMatrix }; }
  catch { fail("task.json is unreadable"); }
  let matrix = parsed.build_suite;
  // Generated build tasks may keep the denominator in a separate host-owned
  // manifest so public task.json does not reveal it to a candidate. Both forms
  // have identical validation below; the scorer can never choose its own set.
  if (!matrix && existsSync(join(taskDir, "DEFECTS.json"))) {
    try {
      const host = JSON.parse(readFileSync(join(taskDir, "DEFECTS.json"), "utf8")) as { defects?: { id?: string }[]; regressions?: { id?: string }[] };
      matrix = { defect_ids: host.defects?.map((item) => item.id ?? "") ?? [], regression_ids: host.regressions?.map((item) => item.id ?? "") ?? [] };
    } catch { fail("DEFECTS.json is unreadable"); }
  }
  if (!matrix || !Array.isArray(matrix.defect_ids) || !Array.isArray(matrix.regression_ids)) fail("task needs build_suite ids or host-owned DEFECTS.json");
  for (const [kind, ids] of Object.entries(matrix)) {
    if (!ids.length || ids.some((id) => typeof id !== "string" || !id || id.includes("/")) || new Set(ids).size !== ids.length) {
      fail(`task.json has invalid ${kind}`);
    }
  }
  return matrix;
}

function assertExactMatrix(matrix: ExpectedMatrix, checks: { defects: Check[]; regressions: Check[] }) {
  for (const [kind, expected, actual] of [
    ["defect", matrix.defect_ids, checks.defects.map((check) => check.name.slice("defect/".length))],
    ["regression", matrix.regression_ids, checks.regressions.map((check) => check.name.slice("regression/".length))],
  ] as const) {
    const missing = expected.filter((id) => !actual.includes(id));
    const unexpected = actual.filter((id) => !expected.includes(id));
    if (missing.length || unexpected.length) fail(`private matrix mismatch for ${kind}: missing ${missing.map((id) => `${kind}/${id}`).join(",") || "none"}; unexpected ${unexpected.map((id) => `${kind}/${id}`).join(",") || "none"}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const [taskDir, arm, seedText] = argv.splice(0, 3);
  if (!taskDir || !["A", "B", "C"].includes(arm ?? "") || !seedText) {
    fail("usage TASK_DIR ARM(A|B|C) SEED --root DIR [--runner PATH] [bench-rq1 flags]");
  }
  const seed = Number(seedText);
  if (!Number.isInteger(seed)) fail(`invalid seed ${seedText}`);
  const rootArg = takeFlag(argv, "root");
  if (!rootArg) fail("--root is required");
  const runner = resolve(takeFlag(argv, "runner") ?? resolve(here, "bench-build-runner.ts"));
  const gridFingerprint = takeFlag(argv, 'grid-fingerprint') ?? null;
  if (gridFingerprint !== null && !/^[a-f0-9]{64}$/.test(gridFingerprint)) fail('invalid grid run fingerprint');
  const gridManifest = takeFlag(argv, 'manifest-sha256') ?? null;
  if (gridManifest !== null && !/^[a-f0-9]{64}$/.test(gridManifest)) fail('invalid grid manifest hash');
  if (!existsSync(runner)) fail(`runner not found: ${runner}`);
  const root = resolve(rootArg);
  // The build-suite preregistration fixes the room at four seats.  The older
  // RQ1 runner defaults to three, so make the new suite's default explicit;
  // a recorded `--seats` permits the pre-registered 4--5-seat alternative.
  if (arm === "C" && !argv.includes("--seats")) argv.push("--seats", "4");
  if (!argv.includes("--effort")) argv.push("--effort", "medium");

  const resolvedTask = resolve(taskDir);
  const matrix = expectedMatrix(resolvedTask);
  const taskMeta = JSON.parse(readFileSync(join(resolvedTask,'task.json'),'utf8'));
  const manifestPath = join(resolvedTask,taskMeta.build_suite ? 'task.json' : 'DEFECTS.json');
  const manifestHash = createHash('sha256').update(readFileSync(manifestPath)).digest('hex');
  const wrapperHash = hashTree(fileURLToPath(import.meta.url));
  const launchTaskHash = hashTree(resolvedTask);
  const adapterPath = resolve(here, 'bench-oracle.ts');
  const hashAdapter = () => createHash('sha256').update(readFileSync(adapterPath)).digest('hex');
  const adapterHashBefore = hashAdapter();
  const launchTaskId = JSON.parse(readFileSync(join(resolvedTask, 'task.json'), 'utf8')).task_id;
  const launched = spawnSync(process.execPath, ["--import", "tsx", runner, taskDir, arm!, String(seed), "--root", root, ...argv], { encoding: "utf8" });
  if (launched.status !== 0 || launched.error || launched.signal) {
    process.stderr.write(launched.stderr ?? "");
    fail(`underlying runner failed (${launched.error?.message ?? launched.signal ?? `exit ${launched.status}`})`);
  }
  const resultPath = resolve(root, "result.json");
  if (!existsSync(resultPath)) fail("underlying runner did not write result.json");
  let raw: RawResult;
  try { raw = JSON.parse(readFileSync(resultPath, "utf8")) as RawResult; }
  catch { fail("underlying result.json is not JSON"); }
  if (raw.arm !== arm || raw.seed !== seed) fail("underlying result does not match requested arm/seed");
  if (raw.anti_tamper?.unchanged !== true) fail("anti-tamper provenance is absent or reports a changed fixture");
  if (!['completed','timeout','invalid_room','budget_exhausted'].includes(raw.outcome ?? '')) fail(`underlying run ${raw.outcome ?? 'missing outcome'}: ${raw.error ?? 'not eligible for scoring'}`);
  if (raw.task_id !== launchTaskId || hashTree(resolvedTask) !== launchTaskHash) fail('tamper: task changed during execution');
  if (raw.usage?.cost_usd !== null && (typeof raw.usage?.cost_usd !== 'number' || !Number.isFinite(raw.usage.cost_usd) || raw.usage.cost_usd < 0)) fail('actual model cost is absent or invalid');
  if (arm === 'B' && raw.outcome === 'completed') {
    const r = raw.review_integrity;
    if (r?.unchanged !== true || !/^[a-f0-9]{64}$/.test(r.workspace_sha256_before ?? '') || r.workspace_sha256_before !== r.workspace_sha256_after) fail('reviewer snapshot boundary is unverified or changed');
  }
  if (arm === 'C' && raw.outcome === 'completed') {
    const r = raw.room_validation;
    if (r?.state !== 'concluded' || !r.proposal_id || r.verified !== true || r.verifier_session_distinct !== true || !(r.distinct_sessions! >= 4)) fail('room lacks independently verified conclusion');
  }
  const effort = raw.effort;
  if (!effort || !["low", "medium", "high"].includes(effort.level ?? "") || effort.settings_path !== ".claude/settings.json" ||
      !/^[a-f0-9]{64}$/.test(effort.settings_sha256 ?? "") || effort.own_git_root !== true) {
    fail("underlying result lacks a pinned effort settings record");
  }

  // bench-rq1 deliberately stores only its aggregate pass/fail. Re-score the
  // workspace from the private task oracle here; never let a runner-provided
  // summary impersonate per-defect evidence.
  const taskHashBeforeScore = hashTree(resolvedTask);
  if (hashAdapter() !== adapterHashBefore) fail('tamper: oracle adapter changed during execution');
  const scorer = await import(new URL("./bench-oracle.ts", import.meta.url).href);
  const scored = await scorer.scoreTask(resolvedTask, resolve(root, "workspace"));
  const taskHashAfterScore = hashTree(resolvedTask);
  const adapterHashAfter = hashAdapter();
  if (adapterHashAfter !== adapterHashBefore) fail('tamper: oracle adapter changed during scoring');
  if (taskHashAfterScore !== taskHashBeforeScore) fail("tamper: private scorer changed fixture while scoring");
  if (scored.oracle.exit_code === 3) {
    writeFileSync(resolve(root,'build-result.json'), JSON.stringify({ ...raw, native_outcome: raw.outcome,
      execution_outcome: 'tamper', outcome: 'tamper', oracle_outcome: 'tamper', protocol_success: false,
      scores: null, usage: raw.usage, seat_records: raw.seats,
      outcome_evidence: { ...raw.outcome_evidence, failure_stage: 'oracle', scorer_exit_code: 3 } },null,2)+'\n');
    fail('tamper: hidden oracle rejected the candidate worker');
  }
  const { defects, regressions } = classify(scored.oracle_results);
  assertExactMatrix(matrix, { defects, regressions });
  const caught = defects.filter((check) => check.exit_code === 0).length;
  const regressionFailures = regressions.filter((check) => check.exit_code === 1).length;
  const seatRecords = Array.isArray(raw.seats) ? raw.seats : [];
  const sumTelemetry = (read: (seat: any) => unknown): number | null => {
    const values = seatRecords.map(read);
    return values.length && values.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)
      ? (values as number[]).reduce((a,b) => a+b,0) : null;
  };
  // A remaining plant is a shipped defect; a broken baseline-preserving case is
  // another shipped regression. They are deliberately additive, not a boolean.
  const output = {
    schemaVersion: 1,
    outcome: raw.outcome,
    scored_outcome: scored.reason,
    oracle_outcome: scored.reason,
    public_suite_passed: null, // No separate public-suite execution is performed by this reducer.
    execution_outcome: raw.outcome,
    protocol_failure: raw.outcome !== 'completed',
    protocol_success: raw.outcome === 'completed',
    protocol_adjusted_catch_fraction: raw.outcome === 'completed' ? caught / defects.length : 0,
    outcome_evidence: { ...raw.outcome_evidence, scorer_exit_code: scored.oracle.exit_code },
    run_config: raw.run_config ?? null,
    run_fingerprint: raw.run_fingerprint ?? null,
    task_id: raw.task_id,
    arm: raw.arm,
    seed: raw.seed,
    scores: {
      defects_caught: caught,
      defects_total: defects.length,
      defects_shipped: defects.length - caught + regressionFailures,
      regression_failures: regressionFailures,
      regressions_total: regressions.length,
    },
    checks: { defects, regressions },
    usage: { cost_usd: raw.usage?.cost_usd ?? null,
      coverage: raw.usage?.coverage ?? (raw.usage?.cost_usd === null ? 'none' : 'complete'),
      thinking_tokens: sumTelemetry(s => s?.thinking_tokens),
      output_tokens: sumTelemetry(s => s?.usage?.output_tokens) },
    turns: raw.turns?.summed ?? null,
    wall_clock_ms: raw.wall_clock?.duration_ms ?? null,
    seats: Array.isArray(raw.seats) ? raw.seats.length : null,
    seat_records: raw.seats ?? null,
    effort,
    provenance: { grid_fingerprint: gridFingerprint, native_run_fingerprint: raw.run_fingerprint ?? null,
      manifest_sha256: gridManifest ?? manifestHash, task_manifest_sha256: manifestHash,
      runner_sha256: wrapperHash, expected_task_sha256: launchTaskHash,
      oracle_adapter_sha256_before: adapterHashBefore, oracle_adapter_sha256_after: adapterHashAfter, raw_result: "result.json", anti_tamper_unchanged: true, task_sha256_before_score: taskHashBeforeScore, task_sha256_after_score: taskHashAfterScore, runner },
  };
  writeFileSync(resolve(root, "build-result.json"), JSON.stringify(output, null, 2) + "\n");
  process.stdout.write(`${resolve(root, "build-result.json")}\n`);
}

main().catch((error) => { process.stderr.write(`${error}\n`); process.exitCode = 1; });
