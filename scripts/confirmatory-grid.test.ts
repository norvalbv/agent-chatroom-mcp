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
import { buildPlan, parseArgs, runGrid } from "./bench-grid.js";

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
mkdirSync(root,{recursive:true});
const result={schemaVersion:2,task_id:basename(argv[0]),arm,seed,outcome:'task_pass',passed:true,
 usage:{cost_usd:0.01,coverage:'complete'},wall_clock:{duration_ms:10},
 thinking_tokens:arm==='A'?7000:arm==='AH'?11000:5000,output_tokens:arm==='A'?7200:arm==='AH'?11200:5200,
 seats:[],attempts:[],selection:{votes:{ok:1}}};
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
    }
    for (const arm of ["B", "C"] as const) {
      const call = ran.find((c) => c.arm === arm);
      assert.ok(call, `${arm} must run`);
      assert.equal(call.argv.includes("--max-budget-usd"), false, `${arm} runs to natural completion`);
    }
    const k = ran.find((c) => c.arm === "K");
    assert.ok(k);
    assert.equal(k.argv[1], "10");
    assert.equal(k.argv.includes("--resume"), true);

    const second = await runGrid(args, { log: () => {}, portStart: 24600 });
    assert.equal(second.ran, 0);
    assert.equal(second.skipped_done, 5);
    assert.equal(calls(f.callsPath).length, 5, "finished cells are not rerun");

    const sentinel = JSON.parse(readFileSync(join(f.resultsDir, "sentinel.json"), "utf8"));
    assert.ok(sentinel[basename(f.taskDir)], "arm-A tokens must be recorded as a per-task regime sentinel");
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

console.log("CONFIRMATORY GRID OK");
