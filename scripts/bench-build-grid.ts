/**
 * Sequential, resumable grid for the planted-defect build benchmark.
 *
 * Unlike scripts/bench-grid.ts, this runner has one fixed nominal arm cap for A,
 * B and C. The single-cell executor is responsible for allocating that cap across
 * its seats/stages. This process rotates arms and tasks within each seed, launches
 * one child at a time, and skips a result only when its requested fingerprint still
 * matches the task, runner and frozen execution arguments.
 */
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type BuildArm = "A" | "B" | "C";

export interface BuildGridArgs {
  taskDirs: string[];
  arms: BuildArm[];
  seeds: number[];
  resultsDir: string;
  runner: string;
  model: string;
  effort: "low" | "medium" | "high";
  maxBudgetUsd: number;
  seats: number;
  deadlineMs: number;
  basePort: number;
  hubEntry: string | null;
  maxTotalCostUsd: number | null;
}

export interface BuildPlanCell {
  taskDir: string;
  taskLabel: string;
  arm: BuildArm;
  seed: number;
  runDir: string;
}

export interface BuildGridSummary {
  ran: number;
  skipped: number;
  invalid: number;
  unknownCost: number;
  infraFailed: number;
  halted: boolean;
  knownCostUsd: number;
}

type BuildResult = {
  task_id?: unknown;
  arm?: unknown;
  seed?: unknown;
  execution_outcome?: unknown;
  scores?: Record<string, unknown>;
  usage?: { cost_usd?: unknown; coverage?: unknown };
  effort?: { level?: unknown; settings_sha256?: unknown; own_git_root?: unknown };
  provenance?: { grid_fingerprint?: unknown; native_run_fingerprint?: unknown; manifest_sha256?: unknown; task_sha256_before_score?: unknown; task_sha256_after_score?: unknown };
};

const here = dirname(fileURLToPath(import.meta.url));
let currentChild: ChildProcess | null = null;

function stopCurrent(signal: NodeJS.Signals) {
  if (currentChild?.pid && currentChild.exitCode === null && currentChild.signalCode === null) {
    try { currentChild.kill(signal); } catch {}
  }
}
function cascadeStop(code: number) {
  stopCurrent("SIGTERM");
  setTimeout(() => stopCurrent("SIGKILL"), 1500).unref();
  setTimeout(() => process.exit(code), 1600).unref();
}
process.on("SIGINT", () => cascadeStop(130));
process.on("SIGTERM", () => cascadeStop(143));
process.on("exit", () => stopCurrent("SIGKILL"));

function flag(argv: string[], name: string, fallback?: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
}

function positiveNumber(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!(parsed > 0) || !Number.isFinite(parsed)) throw new Error(`--${name} must be a positive number`);
  return parsed;
}

function parseSeeds(value: string): number[] {
  const seeds: number[] = [];
  for (const raw of value.split(",")) {
    const part = raw.trim();
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const low = Number(range[1]);
      const high = Number(range[2]);
      if (high < low) throw new Error(`Invalid seed range: ${part}`);
      for (let seed = low; seed <= high; seed++) seeds.push(seed);
    } else {
      const seed = Number(part);
      if (!Number.isInteger(seed)) throw new Error(`Invalid seed: ${part}`);
      seeds.push(seed);
    }
  }
  if (!seeds.length || new Set(seeds).size !== seeds.length) throw new Error("Seeds must be non-empty and unique");
  return seeds;
}

export function parseBuildGridArgs(argv: string[]): BuildGridArgs {
  const taskNames = flag(argv, "tasks");
  const seedText = flag(argv, "seeds");
  if (!taskNames || !seedText) throw new Error("--tasks and --seeds are required");
  const tasksDir = resolve(flag(argv, "tasks-dir", "tasks")!);
  const taskDirs = taskNames.split(",").map((name) => resolve(tasksDir, name.trim()));
  for (const taskDir of taskDirs) if (!existsSync(taskDir)) throw new Error(`Task directory not found: ${taskDir}`);
  const arms = flag(argv, "arms", "A,B,C")!.split(",").map((arm) => arm.trim()) as BuildArm[];
  if (!arms.length || new Set(arms).size !== arms.length || arms.some((arm) => !["A", "B", "C"].includes(arm))) {
    throw new Error("--arms must be a unique comma-list drawn from A,B,C");
  }
  const effort = flag(argv, "effort", "medium") as BuildGridArgs["effort"];
  if (!["low", "medium", "high"].includes(effort)) throw new Error("--effort must be low, medium or high");
  const seats = positiveNumber(flag(argv, "seats", "4"), "seats");
  if (!Number.isInteger(seats) || seats < 4) throw new Error("--seats must be an integer >= 4");
  const basePort = positiveNumber(flag(argv, "base-port", "23000"), "base-port");
  if (!Number.isInteger(basePort) || basePort <= 8000 || basePort > 65000) throw new Error("--base-port must be an integer >8000 and <=65000");
  const maxTotal = flag(argv, "max-total-cost-usd");
  const runner = resolve(flag(argv, "runner", join(here, "bench-build.ts"))!);
  if (!existsSync(runner)) throw new Error(`Runner not found: ${runner}`);
  return {
    taskDirs,
    arms,
    seeds: parseSeeds(seedText),
    resultsDir: resolve(flag(argv, "results", "bench/results/build-suite")!),
    runner,
    model: flag(argv, "model", "sonnet")!,
    effort,
    maxBudgetUsd: positiveNumber(flag(argv, "max-budget-usd", "2"), "max-budget-usd"),
    seats,
    deadlineMs: positiveNumber(flag(argv, "deadline-ms", "900000"), "deadline-ms"),
    basePort,
    hubEntry: flag(argv, "hub-entry") ? resolve(flag(argv, "hub-entry")!) : null,
    maxTotalCostUsd: maxTotal === undefined ? null : positiveNumber(maxTotal, "max-total-cost-usd"),
  };
}

export function buildBuildPlan(args: BuildGridArgs): BuildPlanCell[] {
  const plan: BuildPlanCell[] = [];
  const firstSeed = args.seeds[0];
  for (const seed of args.seeds) {
    const offset = seed - firstSeed;
    const tasks = offset % 2 === 0 ? args.taskDirs : [...args.taskDirs].reverse();
    const armOffset = ((offset % args.arms.length) + args.arms.length) % args.arms.length;
    const arms = [...args.arms.slice(armOffset), ...args.arms.slice(0, armOffset)];
    for (const taskDir of tasks) {
      const taskLabel = basename(taskDir);
      for (const arm of arms) {
        plan.push({ taskDir, taskLabel, arm, seed, runDir: join(args.resultsDir, `${taskLabel}-${arm}-seed${seed}`) });
      }
    }
  }
  return plan;
}

function hashPath(path: string): string {
  const hash = createHash("sha256");
  const visit = (entry: string) => {
    const stat = lstatSync(entry);
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink in fingerprint input: ${entry}`);
    if (stat.isDirectory()) for (const child of readdirSync(entry).sort()) visit(join(entry, child));
    else if (stat.isFile()) {
      hash.update(relative(path, entry));
      hash.update("\0");
      hash.update(readFileSync(entry));
      hash.update("\0");
    }
  };
  visit(path);
  return hash.digest("hex");
}

export function requestedFingerprint(args: BuildGridArgs, cell: BuildPlanCell, taskSha256 = hashPath(cell.taskDir)): string {
  const manifestSha256 = requestedManifestFingerprint(args, cell, taskSha256);
  const contract = {
    schema: 2,
    manifest_sha256: manifestSha256,
    arm: cell.arm,
    seed: cell.seed,
  };
  return createHash("sha256").update(JSON.stringify(contract)).digest("hex");
}

export function requestedManifestFingerprint(args: BuildGridArgs, cell: BuildPlanCell, taskSha256 = hashPath(cell.taskDir)): string {
  const supportDir = dirname(args.runner);
  const supportNames = ["bench-build-runner.ts", "bench-build-runtime.ts", "bench-oracle.ts"];
  const support = Object.fromEntries(supportNames.filter((name) => existsSync(join(supportDir, name))).map((name) => [name, hashPath(join(supportDir, name))]));
  const generators = Object.fromEntries(readdirSync(supportDir).filter((name) => /^bench-build(?:-[a-z]+)?-gen\.ts$/.test(name)).sort().map((name) => [name, hashPath(join(supportDir, name))]));
  const repoSrc = resolve(here, "..", "src");
  const contract = {
    schema: 1,
    task_id: cell.taskLabel,
    task_sha256: taskSha256,
    grid_sha256: hashPath(fileURLToPath(import.meta.url)),
    runner_sha256: hashPath(args.runner),
    support_sha256: support,
    generator_sha256: generators,
    helpers_sha256: existsSync(repoSrc) ? hashPath(repoSrc) : null,
    hub_build_sha256: args.hubEntry && existsSync(args.hubEntry) ? hashPath(dirname(args.hubEntry)) : null,
    model: args.model,
    effort: args.effort,
    max_budget_usd: args.maxBudgetUsd,
    seats: args.seats,
    deadline_ms: args.deadlineMs,
    allocations: { A: [1], B: [0.5, 0.25, 0.25], C: Array(args.seats).fill(1 / args.seats) },
  };
  return createHash("sha256").update(JSON.stringify(contract)).digest("hex");
}

function integerField(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 0;
}

function validateResult(result: BuildResult, cell: BuildPlanCell, fingerprint: string, effort: string, expectedTaskSha256: string, expectedManifestSha256: string): { valid: boolean; cost: number | null; reason?: string } {
  if (result.task_id !== cell.taskLabel || result.arm !== cell.arm || result.seed !== cell.seed) return { valid: false, cost: null, reason: "cell identity mismatch" };
  if (typeof result.execution_outcome !== "string" || !["completed", "timeout", "invalid_room", "tamper", "infrastructure_error"].includes(result.execution_outcome)) return { valid: false, cost: null, reason: "unknown execution outcome" };
  if (result.execution_outcome === "tamper" || result.execution_outcome === "infrastructure_error") return { valid: false, cost: null, reason: `non-scoreable outcome ${result.execution_outcome}` };
  if (result.provenance?.grid_fingerprint !== fingerprint) return { valid: false, cost: null, reason: "requested fingerprint mismatch" };
  if (result.provenance.manifest_sha256 !== expectedManifestSha256) return { valid: false, cost: null, reason: "requested manifest mismatch" };
  if (typeof result.provenance.native_run_fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(result.provenance.native_run_fingerprint)) return { valid: false, cost: null, reason: "native fingerprint missing" };
  if (result.provenance.task_sha256_before_score !== expectedTaskSha256 || result.provenance.task_sha256_before_score !== result.provenance.task_sha256_after_score) return { valid: false, cost: null, reason: "task provenance mismatch" };
  if (result.effort?.level !== effort || typeof result.effort.settings_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(result.effort.settings_sha256) || result.effort.own_git_root !== true) return { valid: false, cost: null, reason: "effort provenance incomplete" };
  const scores = result.scores ?? {};
  for (const field of ["defects_caught", "defects_total", "defects_shipped", "regression_failures", "regressions_total"]) {
    if (!integerField(scores[field])) return { valid: false, cost: null, reason: `invalid score ${field}` };
  }
  const cost = result.usage?.cost_usd;
  if (result.usage?.coverage !== "complete" || typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return { valid: true, cost: null, reason: "unknown terminal cost" };
  return { valid: true, cost };
}

async function freePort(start: number): Promise<number> {
  for (let port = start; port <= 65534; port++) {
    const available = await new Promise<boolean>((done) => {
      const server = createServer();
      server.once("error", () => done(false));
      server.listen(port, "127.0.0.1", () => server.close(() => done(true)));
    });
    if (available) return port;
  }
  throw new Error(`No free port at or above ${start}`);
}

function runCell(argv: string[]): Promise<number> {
  return new Promise((done) => {
    const child = spawn(process.execPath, ["--import", "tsx", ...argv], { stdio: "inherit" });
    currentChild = child;
    child.once("close", (code) => {
      if (currentChild === child) currentChild = null;
      done(code ?? 1);
    });
    child.once("error", () => done(1));
  });
}

function observedCost(runDir: string): number | null {
  for (const name of ["build-result.json", "result.json"]) {
    const path = join(runDir, name);
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { usage?: { cost_usd?: unknown } };
      const cost = parsed.usage?.cost_usd;
      if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) return cost;
    } catch {}
  }
  return null;
}

export async function runBuildGrid(args: BuildGridArgs, options: { log?: (message: string) => void } = {}): Promise<BuildGridSummary> {
  const log = options.log ?? console.log;
  mkdirSync(args.resultsDir, { recursive: true });
  const summary: BuildGridSummary = { ran: 0, skipped: 0, invalid: 0, unknownCost: 0, infraFailed: 0, halted: false, knownCostUsd: 0 };
  // Freeze every task before the first child starts. A per-cell re-hash would let
  // an earlier seat (or any concurrent writer) silently define a new version for
  // later cells in the same invocation.
  const taskHashes = new Map(args.taskDirs.map((taskDir) => [taskDir, hashPath(taskDir)]));
  const taskManifests = new Map(args.taskDirs.map((taskDir) => {
    const cell = { taskDir, taskLabel: basename(taskDir), arm: "A" as BuildArm, seed: args.seeds[0], runDir: "" };
    return [taskDir, requestedManifestFingerprint(args, cell, taskHashes.get(taskDir)!)] as const;
  }));
  let portCursor = args.basePort;
  for (const cell of buildBuildPlan(args)) {
    if (args.maxTotalCostUsd !== null && summary.knownCostUsd >= args.maxTotalCostUsd) {
      summary.halted = true;
      break;
    }
    const taskSha256 = taskHashes.get(cell.taskDir)!;
    const manifestSha256 = taskManifests.get(cell.taskDir)!;
    const fingerprint = createHash("sha256").update(JSON.stringify({ schema: 2, manifest_sha256: manifestSha256, arm: cell.arm, seed: cell.seed })).digest("hex");
    const resultPath = join(cell.runDir, "build-result.json");
    if (existsSync(resultPath)) {
      const existing = JSON.parse(readFileSync(resultPath, "utf8")) as BuildResult;
      if (existing.provenance?.grid_fingerprint !== fingerprint) throw new Error(`Stale result fingerprint: ${resultPath}`);
      const checked = validateResult(existing, cell, fingerprint, args.effort, taskSha256, manifestSha256);
      if (!checked.valid) throw new Error(`Existing result is not resumable (${checked.reason}): ${resultPath}`);
      summary.skipped += 1;
      log(`skip:compatible ${cell.taskLabel} ${cell.arm} ${cell.seed}`);
      if (checked.cost === null) {
        summary.unknownCost += 1;
        summary.halted = true;
        break;
      }
      summary.knownCostUsd += checked.cost;
      continue;
    }
    if (existsSync(cell.runDir)) throw new Error(`Interrupted run directory requires quarantine before resume: ${cell.runDir}`);
    const port = await freePort(portCursor);
    portCursor = port + 1;
    const childArgs = [
      args.runner, cell.taskDir, cell.arm, String(cell.seed), "--root", cell.runDir,
      "--model", args.model, "--effort", args.effort, "--max-budget-usd", String(args.maxBudgetUsd),
      "--seats", String(args.seats), "--deadline-ms", String(args.deadlineMs), "--port", String(port),
      "--grid-fingerprint", fingerprint, "--manifest-sha256", manifestSha256, "--expected-task-sha256", taskSha256,
    ];
    if (args.hubEntry) childArgs.push("--hub-entry", args.hubEntry);
    log(`run ${cell.taskLabel} ${cell.arm} ${cell.seed}`);
    const code = await runCell(childArgs);
    summary.ran += 1;
    if (code !== 0 || !existsSync(resultPath)) {
      summary.infraFailed += 1;
      const cost = observedCost(cell.runDir);
      if (cost === null) summary.unknownCost += 1;
      else summary.knownCostUsd += cost;
      summary.halted = true;
      break;
    }
    const checked = validateResult(JSON.parse(readFileSync(resultPath, "utf8")) as BuildResult, cell, fingerprint, args.effort, taskSha256, manifestSha256);
    if (!checked.valid) {
      summary.invalid += 1;
      const cost = observedCost(cell.runDir);
      if (cost === null) summary.unknownCost += 1;
      else summary.knownCostUsd += cost;
      summary.halted = true;
      break;
    }
    if (checked.cost === null) {
      summary.unknownCost += 1;
      summary.halted = true;
      break;
    }
    summary.knownCostUsd += checked.cost;
  }
  return summary;
}

async function main() {
  const args = parseBuildGridArgs(process.argv.slice(2));
  const summary = await runBuildGrid(args);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (summary.infraFailed || summary.invalid || summary.unknownCost) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error}\n`); process.exitCode = 1; });
}
