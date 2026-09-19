/**
 * Mechanical reducer for planted-defect build runs.
 *
 * This is intentionally a thin wrapper around bench-rq1.ts: that runner owns
 * copying only public fixtures, seat launch/provenance, and anti-tamper hashing.
 * A build task's private scorer must return named `defect/<id>` and
 * `regression/<id>` results (exit 0 fixed/preserved, exit 1 unfixed/broken).
 * The wrapper records the two pre-registered scores without any model judge.
 *
 * node --import tsx scripts/bench-build.ts TASK_DIR ARM(A|B|C) SEED --root DIR
 *   [--runner PATH] [all bench-rq1 flags]
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
  anti_tamper?: { unchanged?: boolean };
  usage?: { cost_usd?: number };
  turns?: { summed?: number };
  wall_clock?: { duration_ms?: number };
  seats?: unknown[];
};

const here = dirname(fileURLToPath(import.meta.url));
const fail = (message: string): never => { throw new Error(`bench-build: ${message}`); };

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
  const runner = resolve(takeFlag(argv, "runner") ?? resolve(here, "bench-rq1.ts"));
  if (!existsSync(runner)) fail(`runner not found: ${runner}`);
  const root = resolve(rootArg);

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

  // bench-rq1 deliberately stores only its aggregate pass/fail. Re-score the
  // workspace from the private task oracle here; never let a runner-provided
  // summary impersonate per-defect evidence.
  const resolvedTask = resolve(taskDir);
  const taskHashBeforeScore = hashTree(resolvedTask);
  const scorer = await import(new URL("./bench-oracle.ts", import.meta.url).href);
  const scored = await scorer.scoreTask(resolvedTask, resolve(root, "workspace"));
  const taskHashAfterScore = hashTree(resolvedTask);
  if (taskHashAfterScore !== taskHashBeforeScore) fail("private scorer changed its task fixture while scoring");
  const { defects, regressions } = classify(scored.oracle_results);
  const caught = defects.filter((check) => check.exit_code === 0).length;
  const regressionFailures = regressions.filter((check) => check.exit_code === 1).length;
  // A remaining plant is a shipped defect; a broken baseline-preserving case is
  // another shipped regression. They are deliberately additive, not a boolean.
  const output = {
    schemaVersion: 1,
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
    usage: { cost_usd: raw.usage?.cost_usd ?? null },
    turns: raw.turns?.summed ?? null,
    wall_clock_ms: raw.wall_clock?.duration_ms ?? null,
    seats: Array.isArray(raw.seats) ? raw.seats.length : null,
    provenance: { raw_result: "result.json", anti_tamper_unchanged: true, task_sha256_before_score: taskHashBeforeScore, task_sha256_after_score: taskHashAfterScore, runner },
  };
  writeFileSync(resolve(root, "build-result.json"), JSON.stringify(output, null, 2) + "\n");
  process.stdout.write(`${resolve(root, "build-result.json")}\n`);
}

main().catch((error) => { process.stderr.write(`${error}\n`); process.exitCode = 1; });
