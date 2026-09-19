/** node --import tsx scripts/bench-grid.test.ts. Never calls the real claude CLI or bench-rq1.ts: a stub
 * runner (matching bench-rq1.ts's CLI contract) stands in, per scripts/claude-usage-regression.ts's own
 * pattern. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs, buildPlan, sumExistingCost, readGridResult, runGrid, type ParsedGridArgs } from "./bench-grid.js";

function makeStubRunner(dir: string, invocationsLog: string) {
  const stub = join(dir, "stub-bench-rq1.mjs");
  // STUB_COST / STUB_OUTCOME / STUB_WALL_MS (env) let each test control what the "harness" reports;
  // every invocation is appended to invocationsLog (one JSON line) so tests can assert call order/args.
  writeFileSync(
    stub,
    `import { writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const argv = process.argv.slice(2);
const [taskDir, arm, seed] = argv;
const flag = (name) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : undefined; };
const root = flag('root');
appendFileSync(${JSON.stringify(invocationsLog)}, JSON.stringify({ argv, root }) + '\\n');
if (existsSync(root)) { console.error('root exists'); process.exit(1); }
mkdirSync(root, { recursive: true });
const cost = Number(process.env.STUB_COST ?? '0.1');
const wallMs = Number(process.env.STUB_WALL_MS ?? '1000');
const outcome = process.env.STUB_OUTCOME ?? 'task_pass';
const result = {
  schemaVersion: 1, task_id: taskDir.split('/').pop(), arm, seed: Number(seed), model: flag('model'),
  outcome, passed: outcome === 'task_pass', reason: outcome,
  usage: { cost_usd: cost, coverage: 'complete', seats: 1, seats_with_usage: 1, steps: 0, prompt_tokens: 0, completion_tokens: 0 },
  turns: { summed: 3, coverage: 'complete' },
  wall_clock: { started_at: new Date(0).toISOString(), completed_at: new Date(wallMs).toISOString(), duration_ms: wallMs },
};
writeFileSync(join(root, 'result.json'), JSON.stringify(result));
console.log(root);
`,
  );
  return stub;
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "bench-grid-fixture-"));
  const tasksDir = join(dir, "tasks");
  mkdirSync(join(tasksDir, "bench-fact-check"), { recursive: true });
  mkdirSync(join(tasksDir, "bench-bug-fix"), { recursive: true });
  const resultsDir = join(dir, "results");
  const invocationsLog = join(dir, "invocations.jsonl");
  writeFileSync(invocationsLog, "");
  const runner = makeStubRunner(dir, invocationsLog);
  return { dir, tasksDir, resultsDir, runner, invocationsLog };
}

function invocations(invocationsLog: string) {
  return readFileSync(invocationsLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

test("parseArgs: expands seed ranges and comma lists, validates arms", () => {
  const f = fixture();
  try {
    const args = parseArgs(["--tasks", "bench-fact-check", "--seeds", "1,3-5,8", "--tasks-dir", f.tasksDir]);
    assert.deepEqual(args.seeds, [1, 3, 4, 5, 8]);
    assert.deepEqual(args.arms, ["A", "C"]);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("parseArgs: rejects an invalid arm", () => {
  const f = fixture();
  try {
    assert.throws(() => parseArgs(["--tasks", "bench-fact-check", "--seeds", "1", "--arms", "B", "--tasks-dir", f.tasksDir]), /Invalid arm/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("buildPlan: orders arm C before arm A within each (task, seed)", () => {
  const f = fixture();
  try {
    const args = parseArgs(["--tasks", "bench-fact-check", "--seeds", "1,2", "--tasks-dir", f.tasksDir, "--results-dir", f.resultsDir]);
    const plan = buildPlan(args);
    assert.deepEqual(
      plan.map((p) => `${p.arm}${p.seed}`),
      ["C1", "A1", "C2", "A2"],
    );
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("runGrid: runs arm C then arm A for a seed, deriving arm A's budget from arm C's own result", async () => {
  const f = fixture();
  try {
    const args = parseArgs(["--tasks", "bench-fact-check", "--seeds", "1", "--tasks-dir", f.tasksDir, "--results-dir", f.resultsDir, "--runner", f.runner]);
    const summary = await runGrid(args, { log: () => {}, portStart: 24000 });
    assert.equal(summary.ran, 2);
    assert.equal(summary.infra_failed, 0);
    const calls = invocations(f.invocationsLog);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].argv[1], "C");
    assert.equal(calls[1].argv[1], "A");
    const budgetIdx = calls[1].argv.indexOf("--max-budget-usd");
    const deadlineIdx = calls[1].argv.indexOf("--deadline-ms");
    assert.ok(budgetIdx >= 0 && deadlineIdx >= 0, "arm A invocation must carry the derived budget flags");
    assert.equal(calls[1].argv[budgetIdx + 1], "0.1"); // stub's default STUB_COST
    assert.equal(calls[1].argv[deadlineIdx + 1], "1000"); // stub's default STUB_WALL_MS
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("runGrid: never reruns a finished (task, arm, seed) — resumable across invocations", async () => {
  const f = fixture();
  try {
    const args = parseArgs(["--tasks", "bench-fact-check", "--seeds", "1", "--tasks-dir", f.tasksDir, "--results-dir", f.resultsDir, "--runner", f.runner]);
    const first = await runGrid(args, { log: () => {}, portStart: 24010 });
    assert.equal(first.ran, 2);
    const second = await runGrid(args, { log: () => {}, portStart: 24020 });
    assert.equal(second.ran, 0, "nothing left to run");
    assert.equal(second.skipped_done, 2);
    const calls = invocations(f.invocationsLog);
    assert.equal(calls.length, 2, "the stub runner was never invoked a second time for the same (task,arm,seed)");
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("runGrid: --max-cost-usd halts before the next run once the running total would pass it", async () => {
  const f = fixture();
  try {
    const args = parseArgs(["--tasks", "bench-fact-check", "--seeds", "1,2,3", "--arms", "C", "--tasks-dir", f.tasksDir, "--results-dir", f.resultsDir, "--runner", f.runner, "--max-cost-usd", "0.25"]);
    const summary = await runGrid(args, { log: () => {}, portStart: 24030 });
    // Each C run costs $0.1 (stub default): seed1 -> total 0.1 (<0.25, continue), seed2 -> total 0.2
    // (<0.25, continue), seed3 -> total already 0.2<0.25 so it runs -> 0.3; nothing left to check the cap
    // against after that within this task/seed list, so all 3 run; the cap only ever blocks a run whose
    // start-of-run running total has already reached it.
    assert.equal(summary.ran, 3);
    assert.ok(Math.abs(summary.total_cost_usd - 0.3) < 1e-9);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("runGrid: --max-cost-usd actually stops runs once the cap is reached", async () => {
  const f = fixture();
  try {
    const args = parseArgs(["--tasks", "bench-fact-check", "--seeds", "1,2,3,4,5", "--arms", "C", "--tasks-dir", f.tasksDir, "--results-dir", f.resultsDir, "--runner", f.runner, "--max-cost-usd", "0.2"]);
    process.env.STUB_COST = "0.1";
    const summary = await runGrid(args, { log: () => {}, portStart: 24040 });
    // seed1: total 0->0.1 (ran), seed2: total 0.1<0.2 ->0.2 (ran), seed3: total 0.2>=0.2 -> halted, seed4/5 skipped too.
    assert.equal(summary.ran, 2);
    assert.equal(summary.skipped_cost_cap, 3);
  } finally {
    delete process.env.STUB_COST;
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("runGrid: arm A without a paired arm C result is an infra-fail, not a silent guess", async () => {
  const f = fixture();
  try {
    const args = parseArgs(["--tasks", "bench-fact-check", "--seeds", "1", "--arms", "A", "--tasks-dir", f.tasksDir, "--results-dir", f.resultsDir, "--runner", f.runner]);
    const summary = await runGrid(args, { log: () => {}, portStart: 24050 });
    assert.equal(summary.ran, 0);
    assert.equal(summary.infra_failed, 1);
    assert.equal(invocations(f.invocationsLog).length, 0, "the runner is never even invoked without a paired arm C result");
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("runGrid: a prior 'timeout' result is retried, not treated as done forever (item 3)", async () => {
  const f = fixture();
  try {
    const args = parseArgs(["--tasks", "bench-fact-check", "--seeds", "1", "--arms", "C", "--tasks-dir", f.tasksDir, "--results-dir", f.resultsDir, "--runner", f.runner]);
    process.env.STUB_OUTCOME = "timeout";
    process.env.STUB_COST = "0";
    const first = await runGrid(args, { log: () => {}, portStart: 24060 });
    assert.equal(first.ran, 1);
    assert.equal(readGridResult(join(f.resultsDir, "bench-fact-check-C-seed1", "result.json")).outcome, "timeout");
    // A second invocation must retry the timed-out run (a killed seat never got a fair attempt), not
    // permanently skip:done it — this time the stub reports success.
    delete process.env.STUB_OUTCOME;
    delete process.env.STUB_COST;
    const second = await runGrid(args, { log: () => {}, portStart: 24070 });
    assert.equal(second.ran, 1, "the timed-out run must be retried");
    assert.equal(second.skipped_done, 0);
    assert.equal(readGridResult(join(f.resultsDir, "bench-fact-check-C-seed1", "result.json")).outcome, "task_pass");
    const calls = invocations(f.invocationsLog);
    assert.equal(calls.length, 2, "the stub runner was invoked once for the timeout attempt and once more for the retry");
  } finally {
    delete process.env.STUB_OUTCOME;
    delete process.env.STUB_COST;
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("sumExistingCost / readGridResult: sums cost_usd across every result.json under a dir", () => {
  const f = fixture();
  try {
    mkdirSync(f.resultsDir, { recursive: true });
    for (const [name, cost] of [["a", 0.2], ["b", 0.3]] as const) {
      const runDir = join(f.resultsDir, name);
      mkdirSync(runDir);
      writeFileSync(join(runDir, "result.json"), JSON.stringify({ outcome: "task_pass", usage: { cost_usd: cost }, wall_clock: { duration_ms: 1 } }));
    }
    assert.ok(Math.abs(sumExistingCost(f.resultsDir) - 0.5) < 1e-9);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

function makeStubAk(dir: string, invocationsLog: string) {
  const stub = join(dir, "stub-bench-ak.mjs");
  // STUB_K_COST ("null" = unknown cost) controls cost_usd_total; the stub honours --resume by keeping an existing root.
  writeFileSync(
    stub,
    `import { writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : undefined; };
const root = flag('root');
appendFileSync(${JSON.stringify(invocationsLog)}, JSON.stringify({ argv, root, ak: true }) + '\\n');
if (existsSync(root) && !argv.includes('--resume')) { console.error('root exists'); process.exit(1); }
mkdirSync(root, { recursive: true });
const raw = process.env.STUB_K_COST ?? '0.5';
const result = { schemaVersion: 1, task_id: argv[0].split('/').pop(), arm: 'K', k: Number(argv[1]), seed: Number(argv[2]), outcome: 'task_pass', passed: true, cost_usd_total: raw === 'null' ? null : Number(raw), wall_clock_ms: 1000, attempts: [] };
writeFileSync(join(root, 'result.json'), JSON.stringify(result));
`,
  );
  return stub;
}

function akFixture() {
  const f = fixture();
  const akRunner = makeStubAk(f.dir, f.invocationsLog);
  const cDir = join(f.dir, "c-results");
  mkdirSync(join(cDir, "bench-fact-check-C-seed1"), { recursive: true });
  writeFileSync(join(cDir, "bench-fact-check-C-seed1", "result.json"), JSON.stringify({ outcome: "task_pass", usage: { cost_usd: 0.6 }, wall_clock: { duration_ms: 5000 } }));
  const armK = ["--tasks", "bench-fact-check", "--seeds", "1", "--arms", "K", "--k", "bench-fact-check=4", "--tasks-dir", f.tasksDir, "--results-dir", f.resultsDir, "--ak-runner", akRunner, "--c-results-dir", cDir];
  return { ...f, akRunner, cDir, armK };
}

test("parseArgs: arm K needs a k for every task and a positive integer", () => {
  const f = akFixture();
  try {
    assert.throws(() => parseArgs(["--tasks", "bench-fact-check", "--seeds", "1", "--arms", "K", "--tasks-dir", f.tasksDir]), /--k/);
    assert.throws(() => parseArgs(["--tasks", "bench-fact-check", "--seeds", "1", "--arms", "K", "--k", "bench-fact-check=1", "--tasks-dir", f.tasksDir]), /k/);
    const a = parseArgs(f.armK);
    assert.equal(a.kByTask["bench-fact-check"], 4);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("runGrid: arm K is refused without the paired arm C result and never invokes the runner", async () => {
  const f = akFixture();
  try {
    rmSync(join(f.cDir, "bench-fact-check-C-seed1"), { recursive: true });
    const summary = await runGrid(parseArgs(f.armK), { log: () => {} });
    assert.equal(summary.ran, 0);
    assert.equal(summary.infra_failed, 1);
    assert.equal(invocations(f.invocationsLog).length, 0);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("runGrid: arm K runs bench-ak with k, the paired C result, --resume and --concurrency; done groups are skipped", async () => {
  const f = akFixture();
  try {
    const args = parseArgs([...f.armK, "--concurrency", "3"]);
    const first = await runGrid(args, { log: () => {} });
    assert.equal(first.ran, 1);
    const call = invocations(f.invocationsLog)[0];
    assert.deepEqual(call.argv.slice(1, 3), ["4", "1"]);
    assert.equal(call.argv[call.argv.indexOf("--arm-c-result") + 1], join(f.cDir, "bench-fact-check-C-seed1", "result.json"));
    assert.equal(call.argv[call.argv.indexOf("--concurrency") + 1], "3");
    assert.ok(call.argv.includes("--resume"));
    assert.equal(call.root, join(f.resultsDir, "bench-fact-check-K-seed1"));
    assert.ok(Math.abs(first.total_cost_usd - 0.5) < 1e-9, "arm K cost is cost_usd_total");
    const second = await runGrid(args, { log: () => {} });
    assert.equal(second.ran, 0);
    assert.equal(second.skipped_done, 1);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("runGrid: an interrupted arm K group (dir without result.json) is resumed, not an infra-fail", async () => {
  const f = akFixture();
  try {
    mkdirSync(join(f.resultsDir, "bench-fact-check-K-seed1", "attempt-1"), { recursive: true });
    const summary = await runGrid(parseArgs(f.armK), { log: () => {} });
    assert.equal(summary.ran, 1);
    assert.equal(summary.infra_failed, 0);
    assert.ok(invocations(f.invocationsLog)[0].argv.includes("--resume"));
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("runGrid: unknown arm K cost is never summed as zero; it is reported and halts later runs under --max-cost-usd", async () => {
  const f = akFixture();
  try {
    mkdirSync(join(f.cDir, "bench-fact-check-C-seed2"), { recursive: true });
    writeFileSync(join(f.cDir, "bench-fact-check-C-seed2", "result.json"), JSON.stringify({ outcome: "task_pass", usage: { cost_usd: 0.6 }, wall_clock: { duration_ms: 5000 } }));
    process.env.STUB_K_COST = "null";
    const twoSeeds = [...f.armK];
    twoSeeds[twoSeeds.indexOf("--seeds") + 1] = "1,2";
    const args = parseArgs([...twoSeeds, "--max-cost-usd", "100"]);
    const summary = await runGrid(args, { log: () => {} });
    assert.equal(summary.ran, 1, "seed 2 must not start while a finished group has unknown cost");
    assert.equal(summary.unknown_cost_groups, 1);
    assert.equal(summary.skipped_cost_cap, 1);
    assert.equal(summary.total_cost_usd, 0);
    // A resumed grid must also see the unknown cost on disk.
    const again = await runGrid(args, { log: () => {} });
    assert.equal(again.unknown_cost_groups, 1);
    assert.equal(again.ran, 0);
  } finally {
    delete process.env.STUB_K_COST;
    rmSync(f.dir, { recursive: true, force: true });
  }
});

console.log("BENCH GRID OK");
