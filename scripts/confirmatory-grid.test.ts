/**
 * Offline contract for the confirmatory five-arm grid. No real model is invoked: a stub
 * bench-rq1/bench-ak executable records argv and writes a minimal result.json.
 *
 * This is intentionally separate from bench-grid.test.ts: the confirmatory contract is
 * preregistration-sensitive and must not silently fall back to the legacy C-before-A,
 * C-funded-K ordering used by the exploratory grids.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { buildPlan, classifyRegime, confirmatoryOrder, parseArgs, runGrid } from "./bench-grid.js";

const ARMS = ["A", "AH", "B", "K", "C"] as const;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "confirmatory-grid-"));
  const tasksDir = join(dir, "tasks");
  const taskDir = join(tasksDir, "stamp-interpreter");
  const resultsDir = join(dir, "results");
  const callsPath = join(dir, "calls.jsonl");
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(callsPath, "");
  const runner = join(dir, "stub-runner.mjs");
  writeFileSync(
    runner,
    `import {appendFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {basename,join} from 'node:path';
const argv=process.argv.slice(2);
const flag=(name)=>{const i=argv.indexOf('--'+name);return i<0?undefined:argv[i+1]};
const root=flag('root');
const isK=argv.includes('--arm-c-result')||argv.includes('--resume');
const arm=isK?'K':argv[1];
const seed=Number(isK?argv[2]:argv[2]);
appendFileSync(${JSON.stringify(callsPath)},JSON.stringify({argv,arm,seed})+'\\n');
if(process.env.STUB_FAIL_ARM===arm)process.exit(2);
mkdirSync(root,{recursive:true});
const thinking=arm==='A'?7000:arm==='AH'?11000:5000;
const output=arm==='A'?7200:arm==='AH'?11200:5200;
const modelUsage=process.env.STUB_MISSING_THINKING==='1'&&arm==='A'?{served:{outputTokens:output}}:{served:{thinkingTokens:thinking,outputTokens:output}};
const outcome=process.env.STUB_OUTCOME??'task_pass';
const result={schemaVersion:2,task_id:basename(argv[0]),arm,seed,outcome,passed:outcome==='task_pass',
 usage:{cost_usd:0.01,coverage:'complete',output_tokens:output},wall_clock:{duration_ms:10},
 seats:[{model_usage:modelUsage,usage:{output_tokens:output}}],attempts:[],selection:{votes:{ok:1}}};
writeFileSync(join(root,'result.json'),JSON.stringify(result));
`,
  );
  return { dir, tasksDir, taskDir, resultsDir, callsPath, runner };
}

function calls(path: string): { argv: string[]; arm: string; seed: number }[] {
  const text = readFileSync(path, "utf8").trim();
  return text ? text.split("\n").map((line) => JSON.parse(line)) : [];
}

test("confirmatory plan accepts A/AH/B/K/C and balances ordinal position in each five-seed block", () => {
  const f = fixture();
  try {
    const args = parseArgs([
      "--tasks", "stamp-interpreter",
      "--seeds", "501-505",
      "--arms", ARMS.join(","),
      "--k", "stamp-interpreter=10",
      "--confirmatory",
      "--tasks-dir", f.tasksDir,
      "--results-dir", f.resultsDir,
    ]);
    assert.deepEqual(args.arms, ARMS);
    const plan = buildPlan(args);
    assert.equal(plan.length, 25);

    const perSeed = new Map<number, string[]>();
    for (const item of plan) {
      const list = perSeed.get(item.seed) ?? [];
      list.push(item.arm);
      perSeed.set(item.seed, list);
    }
    for (const seed of args.seeds) {
      assert.deepEqual([...new Set(perSeed.get(seed))].sort(), [...ARMS].sort(), `seed ${seed} must run every arm exactly once`);
    }
    for (let position = 0; position < ARMS.length; position++) {
      assert.deepEqual(
        args.seeds.map((seed) => perSeed.get(seed)![position]).sort(),
        [...ARMS].sort(),
        `position ${position + 1} must contain each arm once; no arm (especially C) may be fixed first`,
      );
    }
    assert.deepEqual(perSeed.get(506), undefined, "the requested block ends at 505");
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("confirmatory execution uses flat A/AH caps, natural B/C completion, fixed K, and resumes per cell", async () => {
  const f = fixture();
  try {
    const args = parseArgs([
      "--tasks", "stamp-interpreter",
      "--seeds", "501",
      "--arms", ARMS.join(","),
      "--k", "stamp-interpreter=10",
      "--confirmatory",
      "--tasks-dir", f.tasksDir,
      "--results-dir", f.resultsDir,
      "--runner", f.runner,
      "--ak-runner", f.runner,
      "--max-cost-usd", "1",
    ]);
    const first = await runGrid(args, { log: () => {}, portStart: 24500 });
    assert.equal(first.ran, 5);
    assert.equal(first.infra_failed, 0);
    const ran = calls(f.callsPath);
    assert.equal(ran.length, 5);

    for (const arm of ["A", "AH"] as const) {
      const call = ran.find((c) => c.arm === arm);
      assert.ok(call, `${arm} must run`);
      assert.equal(call.argv[call.argv.indexOf("--max-budget-usd") + 1], "0.3");
      assert.equal(call.argv[call.argv.indexOf("--deadline-ms") + 1], "150000");
      assert.equal(call.argv[call.argv.indexOf("--effort") + 1], arm === "AH" ? "high" : "medium");
    }
    for (const arm of ["B", "C"] as const) {
      const call = ran.find((c) => c.arm === arm);
      assert.ok(call, `${arm} must run`);
      assert.equal(call.argv.includes("--max-budget-usd"), false, `${arm} runs to natural completion`);
      assert.equal(call.argv[call.argv.indexOf("--effort") + 1], "medium");
    }
    const k = ran.find((c) => c.arm === "K");
    assert.ok(k);
    assert.equal(k.argv[1], "10");
    assert.equal(k.argv.includes("--resume"), true);
    assert.equal(k.argv[k.argv.indexOf("--effort") + 1], "medium", "every K attempt must inherit the pinned normal effort");

    const second = await runGrid(args, { log: () => {}, portStart: 24600 });
    assert.equal(second.ran, 0);
    assert.equal(second.skipped_done, 5);
    assert.equal(calls(f.callsPath).length, 5, "finished cells are not rerun");

    const sentinel = JSON.parse(readFileSync(join(f.resultsDir, "sentinel.json"), "utf8"));
    const taskSentinel = sentinel[basename(f.taskDir)];
    assert.ok(taskSentinel, "arm-A tokens must be recorded as a per-task regime sentinel");
    assert.equal(taskSentinel.n, 1, "AH is a treatment arm, not a regime sentinel; only arm A contributes one observation per seed");
    assert.equal(taskSentinel.min_thinking, 7000);
    assert.equal(taskSentinel.max_thinking, 7000);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("confirmatory resume keeps a finished timeout as data instead of outcome-adaptively rerunning it", async () => {
  const f = fixture();
  try {
    process.env.STUB_OUTCOME = "timeout";
    const args = parseArgs([
      "--tasks", "stamp-interpreter", "--seeds", "501", "--arms", "C", "--confirmatory",
      "--tasks-dir", f.tasksDir, "--results-dir", f.resultsDir, "--runner", f.runner,
    ]);
    const first = await runGrid(args, { log: () => {}, portStart: 24700 });
    assert.equal(first.ran, 1);
    delete process.env.STUB_OUTCOME;
    const resumed = await runGrid(args, { log: () => {}, portStart: 24800 });
    assert.equal(resumed.ran, 0, "a confirmatory timeout remains the registered outcome for that cell");
    assert.equal(resumed.skipped_done, 1);
    assert.equal(calls(f.callsPath).length, 1);
  } finally {
    delete process.env.STUB_OUTCOME;
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("confirmatory child failure makes spend unknown and halts a capped grid before another arm", async () => {
  const f = fixture();
  try {
    process.env.STUB_FAIL_ARM = "A";
    const args = parseArgs([
      "--tasks", "stamp-interpreter", "--seeds", "501", "--arms", "A,AH", "--confirmatory",
      "--tasks-dir", f.tasksDir, "--results-dir", f.resultsDir, "--runner", f.runner, "--max-cost-usd", "1",
    ]);
    const summary = await runGrid(args, { log: () => {} });
    assert.equal(summary.ran, 0);
    assert.equal(summary.infra_failed, 1);
    assert.equal(summary.unknown_cost_groups, 1, "the failed child may have spent money; unknown is not zero");
    assert.equal(calls(f.callsPath).length, 1, "AH must not start after spend becomes unknown");
  } finally {
    delete process.env.STUB_FAIL_ARM;
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("missing arm-A thinking provenance is recorded as unknown, never calibrated by output alone", async () => {
  const f = fixture();
  try {
    process.env.STUB_MISSING_THINKING = "1";
    const args = parseArgs([
      "--tasks", "stamp-interpreter", "--seeds", "501", "--arms", "A", "--confirmatory",
      "--tasks-dir", f.tasksDir, "--results-dir", f.resultsDir, "--runner", f.runner,
    ]);
    const summary = await runGrid(args, { log: () => {} });
    assert.equal(summary.ran, 1);
    const sentinel = JSON.parse(readFileSync(join(f.resultsDir, "sentinel.json"), "utf8"))["stamp-interpreter"];
    assert.equal(sentinel.regime, "unknown");
    assert.equal(sentinel.min_thinking, null);
    assert.equal(sentinel.max_thinking, null);
  } finally {
    delete process.env.STUB_MISSING_THINKING;
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("arms AH and B are refused without --confirmatory, so a legacy command cannot run them by accident", () => {
  const f = fixture();
  try {
    assert.throws(() => parseArgs(["--tasks", "stamp-interpreter", "--seeds", "1", "--arms", "AH", "--tasks-dir", f.tasksDir]), /Invalid arm: AH/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("rotation is (seed-501) mod 5 over [A, AH, B, K, C] and K precedes C for seeds 501-503 (no arm-C dependency)", () => {
  assert.deepEqual(confirmatoryOrder(501), ["A", "AH", "B", "K", "C"]);
  assert.deepEqual(confirmatoryOrder(502), ["AH", "B", "K", "C", "A"]);
  assert.deepEqual(confirmatoryOrder(505), ["C", "A", "AH", "B", "K"]);
  assert.deepEqual(confirmatoryOrder(506), confirmatoryOrder(501));
  assert.deepEqual(confirmatoryOrder(901), confirmatoryOrder(901 - 5 * 3), "pilot seeds below and above the block rotate too");
});

test("classifyRegime: the frozen 4000 threshold is on thinking tokens; output alone (a code-writing task's 4K+) never makes a short-thinking seed long", () => {
  assert.equal(classifyRegime(1500, 900), "calibrated");
  assert.equal(classifyRegime(4180, 888), "calibrated", "pilot printf-format seed 901: 4180 output tokens, 888 thinking");
  assert.equal(classifyRegime(9000, 3999), "calibrated");
  assert.equal(classifyRegime(12000, 4000), "long-thinking");
  assert.equal(classifyRegime(1500, 0), "calibrated", "a genuine 0 is known");
  assert.equal(classifyRegime(1500, null), "unknown");
  assert.equal(classifyRegime(null, 900), "unknown");
  assert.equal(classifyRegime(1500, Number.NaN), "unknown");
  assert.equal(classifyRegime(1500, -1), "unknown");
});

test("a launched cell with no result.json on disk is unknown spend on resume: a capped grid halts instead of reading it as zero", async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.resultsDir, "stamp-interpreter-A-seed501", "workspace"), { recursive: true });
    const args = parseArgs([
      "--tasks", "stamp-interpreter", "--seeds", "501", "--arms", "AH", "--confirmatory",
      "--tasks-dir", f.tasksDir, "--results-dir", f.resultsDir, "--runner", f.runner, "--max-cost-usd", "1",
    ]);
    const summary = await runGrid(args, { log: () => {} });
    assert.equal(summary.unknown_cost_groups, 1);
    assert.equal(summary.ran, 0);
    assert.equal(summary.skipped_cost_cap, 1);
    assert.equal(calls(f.callsPath).length, 0);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

console.log("CONFIRMATORY GRID OK");
