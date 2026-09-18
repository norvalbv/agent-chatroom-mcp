#!/usr/bin/env node
/**
 * RQ1 harness item 3 wiring (swarm-120129-s12h, claim/usage-budget): runs one (task, seed) pair on
 * arm C then arm A, matching arm A's budget to arm C's realized spend. Shells out to
 * scripts/bench-rq1.ts (item 1) twice -- it does not reimplement the launch, only sequences it and
 * derives arm A's budget flags from arm C's own result.json.
 *
 * node --import tsx scripts/rq1-run-pair.ts TASK_DIR SEED --root-base DIR [--model sonnet] [--port N]
 *   [--seats N] [--timeout-ms N] [--hub-entry PATH]
 *
 * Writes DIR/<task_id>-C-seed<seed>/result.json and DIR/<task_id>-A-seed<seed>/result.json.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { matchArmABudget } from "./rq1-usage-budget.js";

const here = dirname(fileURLToPath(import.meta.url));

export interface RunPairOptions {
  taskDir: string;
  seed: number;
  rootBase: string;
  model?: string;
  port?: number;
  seats?: number;
  timeoutMs?: number;
  hubEntry?: string;
  /** injectable for tests: path to bench-rq1.ts */
  runnerPath?: string;
  /** injectable for tests: env passed to both bench-rq1.ts invocations */
  env?: NodeJS.ProcessEnv;
}

export interface RunPairResult {
  taskId: string;
  armCRoot: string;
  armARoot: string;
  budget: { maxBudgetUsd: number; wallClockCapMs: number };
}

function readTaskId(taskDir: string): string {
  return JSON.parse(readFileSync(join(taskDir, "task.json"), "utf8")).task_id as string;
}

function invokeArm(runnerPath: string, taskDir: string, arm: "A" | "C", seed: number, root: string, extraArgs: string[], env: NodeJS.ProcessEnv): void {
  const args = [taskDir, arm, String(seed), "--root", root, ...extraArgs];
  const run = spawnSync(process.execPath, ["--import", "tsx", runnerPath, ...args], { encoding: "utf8", env, timeout: 15 * 60_000 });
  if (run.status !== 0) throw new Error(`bench-rq1.ts arm ${arm} failed (exit ${run.status ?? run.signal}): ${run.stderr || run.stdout}`);
}

export function runPair(opts: RunPairOptions): RunPairResult {
  const runnerPath = resolve(opts.runnerPath ?? join(here, "bench-rq1.ts"));
  if (!existsSync(runnerPath)) throw new Error(`bench-rq1.ts not found at ${runnerPath}`);
  const env = opts.env ?? process.env;
  const common: string[] = [];
  if (opts.model) common.push("--model", opts.model);
  if (opts.port !== undefined) common.push("--port", String(opts.port));
  if (opts.seats !== undefined) common.push("--seats", String(opts.seats));
  if (opts.timeoutMs !== undefined) common.push("--timeout-ms", String(opts.timeoutMs));
  if (opts.hubEntry) common.push("--hub-entry", opts.hubEntry);

  const taskId = readTaskId(opts.taskDir);
  const armCRoot = resolve(opts.rootBase, `${taskId}-C-seed${opts.seed}`);
  invokeArm(runnerPath, opts.taskDir, "C", opts.seed, armCRoot, common, env);
  const cResult = JSON.parse(readFileSync(join(armCRoot, "result.json"), "utf8"));
  const budget = matchArmABudget({ costUsd: cResult.usage?.cost_usd, wallClockMs: cResult.wall_clock?.duration_ms });

  const armARoot = resolve(opts.rootBase, `${taskId}-A-seed${opts.seed}`);
  const armACommon = [...common, "--max-budget-usd", String(budget.maxBudgetUsd), "--deadline-ms", String(Math.round(budget.wallClockCapMs))];
  invokeArm(runnerPath, opts.taskDir, "A", opts.seed, armARoot, armACommon, env);

  return { taskId, armCRoot, armARoot, budget };
}

async function main() {
  const argv = process.argv.slice(2);
  const taskArg = argv.shift();
  const seedArg = argv.shift();
  if (!taskArg || seedArg === undefined) throw new Error("Usage: rq1-run-pair.ts TASK_DIR SEED --root-base DIR [--model sonnet] [--port N] [--seats N] [--timeout-ms N] [--hub-entry PATH]");
  const seed = Number(seedArg);
  if (!Number.isInteger(seed)) throw new Error(`Invalid seed: ${seedArg}`);
  const flag = (name: string, def?: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : def;
  };
  const rootBase = flag("root-base");
  if (!rootBase) throw new Error("--root-base is required");
  const result = runPair({
    taskDir: resolve(taskArg),
    seed,
    rootBase: resolve(rootBase),
    model: flag("model"),
    port: flag("port") ? Number(flag("port")) : undefined,
    seats: flag("seats") ? Number(flag("seats")) : undefined,
    timeoutMs: flag("timeout-ms") ? Number(flag("timeout-ms")) : undefined,
    hubEntry: flag("hub-entry"),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
