/**
 * One-command grid runner for RQ1 (paper/protocol.md §1/§2.1, item 5 of swarm-120129-s12h-room): drives
 * scripts/bench-rq1.ts across a task list, a seed list and arm(s), stopping before the next run once the
 * running cost total would pass --max-cost-usd, and never rerunning a finished (task, arm, seed) — a run
 * is "finished" iff `<run-dir>/result.json` already exists, so a killed/interrupted grid resumes exactly
 * where it left off by re-invoking this same command.
 *
 * Budget matching (paper/amendments.md, item 3): arm A's ceiling is derived from arm C's *own* measured
 * spend on the exact same (task, seed) pair (paired, within-seed — protocol.md §8's sequencing
 * dependency), so this runner always executes arm C before arm A for a given (task, seed) whenever both
 * are requested, and refuses arm A for a (task, seed) that has no matching arm C result anywhere in
 * --results-dir (a prior grid invocation's arm C run counts).
 *
 * Usage:
 *   node --import tsx scripts/bench-grid.ts --tasks bench-fact-check,bench-bug-fix --seeds 1,2,3
 *     [--arms A,C] [--model sonnet] [--max-cost-usd 5] [--results-dir bench/results/rq1]
 *     [--runner scripts/bench-rq1.ts] [--tasks-dir tasks] [--seats N] [--timeout-ms N] [--deadline-ms N]
 *     [--hub-entry PATH] [--port-base 19850]
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { matchArmABudget } from "./rq1-usage-budget.js";

// Item 5 (orphans): spawnSync would block this process's event loop, so a SIGINT/SIGTERM sent to this
// script while a run is in flight could not be handled until that run finished on its own — the signal
// forwarding below needs `spawn` (async) to stay responsive. `currentChild` is the one in-flight
// scripts/bench-rq1.ts invocation; SIGTERM lets it run its own cascade (item 5's fix there) before this
// process exits, SIGKILL is the last resort for a child that ignores that.
let currentChild: ChildProcess | null = null;
function killCurrentChild(signal: NodeJS.Signals) {
  if (currentChild && currentChild.pid && currentChild.exitCode === null && currentChild.signalCode === null) {
    try {
      currentChild.kill(signal);
    } catch {}
  }
}
function cascadeStop(exitCode: number) {
  killCurrentChild("SIGTERM");
  setTimeout(() => killCurrentChild("SIGKILL"), 1500).unref();
  setTimeout(() => process.exit(exitCode), 1600).unref();
}
process.on("SIGINT", () => cascadeStop(130));
process.on("SIGTERM", () => cascadeStop(143));
process.on("exit", () => killCurrentChild("SIGKILL"));

export interface GridRunResult {
  outcome: string;
  cost_usd: number;
  wall_clock_ms: number;
}

/** Reads just the fields the grid runner needs to orchestrate the next run; tolerant of extra fields. */
export function readGridResult(resultPath: string): GridRunResult {
  const r = JSON.parse(readFileSync(resultPath, "utf8"));
  if (typeof r.outcome !== "string" || typeof r.usage?.cost_usd !== "number" || typeof r.wall_clock?.duration_ms !== "number") {
    throw new Error(`Malformed result.json (missing outcome/usage.cost_usd/wall_clock.duration_ms): ${resultPath}`);
  }
  return { outcome: r.outcome, cost_usd: r.usage.cost_usd, wall_clock_ms: r.wall_clock.duration_ms };
}

/** Sums usage.cost_usd across every result.json already under resultsDir, so a resumed grid respects prior spend. */
export function sumExistingCost(resultsDir: string): number {
  if (!existsSync(resultsDir)) return 0;
  let total = 0;
  for (const name of readdirSync(resultsDir)) {
    const resultPath = join(resultsDir, name, "result.json");
    if (existsSync(resultPath)) {
      try {
        total += readGridResult(resultPath).cost_usd;
      } catch {
        // Malformed/partial result.json from an interrupted run: not counted, will be retried (its dir
        // still "exists" though — see runDir's own existsSync guard below for why interrupted runs need
        // manual cleanup, matching bench-rq1.ts's own root-reuse refusal).
      }
    }
  }
  return total;
}

export interface ParsedGridArgs {
  taskDirs: string[];
  seeds: number[];
  arms: ("A" | "C")[];
  model: string;
  maxCostUsd: number | null;
  resultsDir: string;
  runner: string;
  seats: string | null;
  timeoutMs: string | null;
  deadlineMs: string | null;
  hubEntry: string | null;
  portBase: number;
}

export function parseArgs(argv: string[], tasksDirDefault = "tasks"): ParsedGridArgs {
  const flag = (name: string, def?: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : def;
  };
  const tasksArg = flag("tasks");
  if (!tasksArg) throw new Error("--tasks is required (comma-separated task names under --tasks-dir)");
  const seedsArg = flag("seeds");
  if (!seedsArg) throw new Error("--seeds is required (comma-separated, ranges like 1-5 allowed)");
  const tasksDir = flag("tasks-dir", tasksDirDefault)!;
  const taskDirs = tasksArg.split(",").map((t) => resolve(tasksDir, t.trim()));
  for (const d of taskDirs) if (!existsSync(d)) throw new Error(`Task directory not found: ${d}`);
  const seeds: number[] = [];
  for (const part of seedsArg.split(",")) {
    const m = part.trim().match(/^(\d+)-(\d+)$/);
    if (m) {
      const [, lo, hi] = m;
      for (let s = Number(lo); s <= Number(hi); s++) seeds.push(s);
    } else {
      const n = Number(part.trim());
      if (!Number.isInteger(n)) throw new Error(`Invalid seed: ${part}`);
      seeds.push(n);
    }
  }
  const armsArg = flag("arms", "A,C")!;
  const arms = armsArg.split(",").map((a) => a.trim()) as ("A" | "C")[];
  for (const a of arms) if (a !== "A" && a !== "C") throw new Error(`Invalid arm: ${a}`);
  const maxCostArg = flag("max-cost-usd");
  const maxCostUsd = maxCostArg !== undefined ? Number(maxCostArg) : null;
  if (maxCostUsd !== null && !(maxCostUsd > 0)) throw new Error("--max-cost-usd must be a positive number");
  return {
    taskDirs,
    seeds,
    arms,
    model: flag("model", "sonnet")!,
    maxCostUsd,
    resultsDir: resolve(flag("results-dir", "bench/results/rq1")!),
    runner: resolve(flag("runner", "scripts/bench-rq1.ts")!),
    seats: flag("seats") ?? null,
    timeoutMs: flag("timeout-ms") ?? null,
    deadlineMs: flag("deadline-ms") ?? null,
    hubEntry: flag("hub-entry") ?? null,
    portBase: Number(flag("port-base", "19850")),
  };
}

async function freePort(startAt: number): Promise<number> {
  for (let p = startAt; p < startAt + 2000; p++) {
    const ok = await new Promise<boolean>((resolveOk) => {
      const probe = createServer();
      probe.once("error", () => resolveOk(false));
      probe.listen(p, "127.0.0.1", () => probe.close(() => resolveOk(true)));
    });
    if (ok) return p;
  }
  throw new Error(`No free port found from ${startAt}`);
}

export interface RunPlanItem {
  taskDir: string;
  taskLabel: string;
  arm: "A" | "C";
  seed: number;
  runDir: string;
}

/** Deterministic run order: task, then seed, then C before A within a seed (arm A's budget needs arm C's result). */
export function buildPlan(args: ParsedGridArgs): RunPlanItem[] {
  const plan: RunPlanItem[] = [];
  for (const taskDir of args.taskDirs) {
    const taskLabel = taskDir.split("/").pop()!;
    for (const seed of args.seeds) {
      for (const arm of ["C", "A"] as const) {
        if (!args.arms.includes(arm)) continue;
        plan.push({ taskDir, taskLabel, arm, seed, runDir: join(args.resultsDir, `${taskLabel}-${arm}-seed${seed}`) });
      }
    }
  }
  return plan;
}

export interface GridSummary {
  ran: number;
  skipped_done: number;
  skipped_cost_cap: number;
  infra_failed: number;
  total_cost_usd: number;
}

export async function runGrid(args: ParsedGridArgs, opts: { log?: (s: string) => void; portStart?: number } = {}): Promise<GridSummary> {
  const log = opts.log ?? ((s: string) => console.log(s));
  mkdirSync(args.resultsDir, { recursive: true });
  const plan = buildPlan(args);
  let runningTotal = sumExistingCost(args.resultsDir);
  let portCounter = opts.portStart ?? args.portBase;
  const summary: GridSummary = { ran: 0, skipped_done: 0, skipped_cost_cap: 0, infra_failed: 0, total_cost_usd: runningTotal };
  let costCapHit = false;

  for (const item of plan) {
    const resultPath = join(item.runDir, "result.json");
    if (existsSync(resultPath)) {
      log(`[skip:done] ${item.taskLabel} ${item.arm} seed${item.seed}`);
      summary.skipped_done++;
      continue;
    }
    if (costCapHit) {
      log(`[skip:cost-cap] ${item.taskLabel} ${item.arm} seed${item.seed}`);
      summary.skipped_cost_cap++;
      continue;
    }
    if (args.maxCostUsd !== null && runningTotal >= args.maxCostUsd) {
      log(`[cost-cap] running total $${runningTotal.toFixed(4)} already >= --max-cost-usd $${args.maxCostUsd}; halting before ${item.taskLabel} ${item.arm} seed${item.seed}`);
      costCapHit = true;
      summary.skipped_cost_cap++;
      continue;
    }

    const runnerArgs = [item.taskDir, item.arm, String(item.seed), "--root", item.runDir, "--model", args.model];
    if (existsSync(item.runDir) && !existsSync(resultPath)) {
      // A prior interrupted run left a partial directory (bench-rq1.ts refuses to reuse --root); this
      // run cannot proceed automatically without risking silently mis-scoring a half-written workspace.
      log(`[infra-fail] ${item.taskLabel} ${item.arm} seed${item.seed}: run dir exists without a result.json (interrupted prior run) — remove ${item.runDir} to retry`);
      summary.infra_failed++;
      continue;
    }
    if (args.seats) runnerArgs.push("--seats", args.seats);
    if (args.timeoutMs) runnerArgs.push("--timeout-ms", args.timeoutMs);
    if (args.hubEntry) runnerArgs.push("--hub-entry", args.hubEntry);

    if (item.arm === "A") {
      // Paired, within-seed budget match (protocol §8): arm A's ceiling comes from *this exact seed's*
      // arm C result, never a cross-seed or cross-task aggregate.
      const armCDir = join(args.resultsDir, `${item.taskLabel}-C-seed${item.seed}`);
      const armCResultPath = join(armCDir, "result.json");
      if (!existsSync(armCResultPath)) {
        log(`[infra-fail] ${item.taskLabel} A seed${item.seed}: no paired arm C result at ${armCResultPath} to derive a budget from (run arm C for this seed first)`);
        summary.infra_failed++;
        continue;
      }
      const armC = readGridResult(armCResultPath);
      let budget: { maxBudgetUsd: number; wallClockCapMs: number };
      try {
        budget = matchArmABudget({ costUsd: armC.cost_usd, wallClockMs: armC.wall_clock_ms });
      } catch {
        log(`[infra-fail] ${item.taskLabel} A seed${item.seed}: paired arm C result has non-positive cost_usd/wall_clock duration, cannot derive a budget`);
        summary.infra_failed++;
        continue;
      }
      runnerArgs.push("--max-budget-usd", String(budget.maxBudgetUsd), "--deadline-ms", String(Math.round(budget.wallClockCapMs)));
    } else {
      const port = await freePort(portCounter);
      portCounter = port + 2;
      runnerArgs.push("--port", String(port));
      if (args.deadlineMs) runnerArgs.push("--deadline-ms", args.deadlineMs);
    }

    log(`[run] node --import tsx ${args.runner} ${runnerArgs.join(" ")}`);
    const { status, stderr } = await new Promise<{ status: number | null; stderr: string }>((resolveRun) => {
      const child = spawn(process.execPath, ["--import", "tsx", args.runner, ...runnerArgs], { stdio: ["ignore", "pipe", "pipe"] });
      currentChild = child;
      let stderrBuf = "";
      child.stderr?.on("data", (d) => (stderrBuf += d));
      child.on("close", (code) => {
        if (currentChild === child) currentChild = null;
        resolveRun({ status: code, stderr: stderrBuf });
      });
    });
    if (status !== 0 || !existsSync(resultPath)) {
      log(`[infra-fail] ${item.taskLabel} ${item.arm} seed${item.seed}: exit ${status}, stderr: ${stderr.slice(-2000)}`);
      summary.infra_failed++;
      continue;
    }
    const written = readGridResult(resultPath);
    runningTotal += written.cost_usd;
    summary.total_cost_usd = runningTotal;
    summary.ran++;
    log(`[done] ${item.taskLabel} ${item.arm} seed${item.seed}: outcome=${written.outcome} cost=$${written.cost_usd.toFixed(4)} running_total=$${runningTotal.toFixed(4)}`);
  }
  summary.total_cost_usd = runningTotal;
  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = await runGrid(args);
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.infra_failed > 0 && summary.ran === 0 && summary.skipped_done === 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]).endsWith("bench-grid.ts")) {
  main().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
