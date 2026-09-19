/** Offline contract tests for the planted-defect build grid. No model is invoked. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBuildPlan, parseBuildGridArgs, runBuildGrid } from "./bench-build-grid.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "bench-build-grid-"));
  const tasksDir = join(dir, "tasks");
  for (const id of ["build-billing-s1", "build-billing-s2"]) {
    mkdirSync(join(tasksDir, id, "public"), { recursive: true });
    writeFileSync(join(tasksDir, id, "task.json"), JSON.stringify({ task_id: id }));
    writeFileSync(join(tasksDir, id, "public", "SPEC.md"), `# ${id}\n`);
  }
  const log = join(dir, "calls.jsonl");
  writeFileSync(log, "");
  const runner = join(dir, "stub-runner.mjs");
  writeFileSync(runner, `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const a=process.argv.slice(2), flag=n=>a[a.indexOf('--'+n)+1];
const [task,arm,seed]=a, root=flag('root'), fp=flag('run-fingerprint');
appendFileSync(${JSON.stringify(log)}, JSON.stringify({a})+'\\n');
mkdirSync(root,{recursive:true});
const unknown=process.env.STUB_UNKNOWN==='1';
writeFileSync(join(root,'build-result.json'), JSON.stringify({
 schemaVersion:1, task_id:task.split('/').pop(), arm, seed:Number(seed),
 scores:{defects_caught:4,defects_total:9,defects_shipped:5,regression_failures:0,regressions_total:14},
 checks:{defects:[{name:'defect/D01',exit_code:0}],regressions:[{name:'regression/R01',exit_code:0}]},
 usage:{cost_usd:unknown?null:0.25,coverage:unknown?'partial':'complete',thinking_tokens:123,output_tokens:456},
 wall_clock_ms:1000,seats:arm==='C'?4:arm==='B'?2:1,
 effort:{level:flag('effort'),settings_sha256:'abc',own_git_root:true},
 provenance:{run_fingerprint:fp,manifest_sha256:'manifest',runner_sha256:'runner',task_sha256_before_score:'task',task_sha256_after_score:'task'}
}));
`);
  return { dir, tasksDir, results: join(dir, "results"), runner, log };
}

function args(f: ReturnType<typeof fixture>, extra: string[] = []) {
  return parseBuildGridArgs([
    "--tasks", "build-billing-s1,build-billing-s2", "--arms", "A,B,C", "--seeds", "501-502",
    "--tasks-dir", f.tasksDir, "--results", f.results, "--runner", f.runner,
    "--model", "sonnet", "--effort", "medium", "--max-budget-usd", "2",
    "--seats", "4", "--deadline-ms", "900000", "--base-port", "24000", ...extra,
  ]);
}

test("parse and plan rotate arms within seed and reverse task order on odd offsets", () => {
  const f = fixture();
  try {
    const parsed = args(f);
    assert.deepEqual(parsed.seeds, [501, 502]);
    const labels = buildBuildPlan(parsed).map((x) => `${x.seed}:${x.taskLabel}:${x.arm}`);
    assert.deepEqual(labels.slice(0, 6), [
      "501:build-billing-s1:A", "501:build-billing-s1:B", "501:build-billing-s1:C",
      "501:build-billing-s2:A", "501:build-billing-s2:B", "501:build-billing-s2:C",
    ]);
    assert.deepEqual(labels.slice(6, 12), [
      "502:build-billing-s2:B", "502:build-billing-s2:C", "502:build-billing-s2:A",
      "502:build-billing-s1:B", "502:build-billing-s1:C", "502:build-billing-s1:A",
    ]);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("grid passes the frozen execution contract and resumes only matching fingerprints", async () => {
  const f = fixture();
  try {
    const parsed = args(f);
    const first = await runBuildGrid(parsed, { log: () => {} });
    assert.equal(first.ran, 12);
    assert.equal(first.skipped, 0);
    const calls = readFileSync(f.log, "utf8").trim().split("\n").map((line) => JSON.parse(line).a as string[]);
    assert.equal(calls.length, 12);
    for (const call of calls) {
      assert.ok(call.includes("--run-fingerprint"));
      assert.equal(call[call.indexOf("--effort") + 1], "medium");
      assert.equal(call[call.indexOf("--max-budget-usd") + 1], "2");
      assert.equal(call[call.indexOf("--seats") + 1], "4");
    }
    const second = await runBuildGrid(parsed, { log: () => {} });
    assert.equal(second.ran, 0);
    assert.equal(second.skipped, 12);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("resume refuses a stale result after task bytes change", async () => {
  const f = fixture();
  try {
    const parsed = parseBuildGridArgs([
      "--tasks", "build-billing-s1", "--arms", "A", "--seeds", "501", "--tasks-dir", f.tasksDir,
      "--results", f.results, "--runner", f.runner, "--effort", "medium", "--max-budget-usd", "2",
    ]);
    await runBuildGrid(parsed, { log: () => {} });
    writeFileSync(join(f.tasksDir, "build-billing-s1", "public", "SPEC.md"), "changed\n");
    await assert.rejects(() => runBuildGrid(parsed, { log: () => {} }), /stale result.*fingerprint/i);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("unknown terminal cost stops later cells and is never summed as zero", async () => {
  const f = fixture();
  try {
    process.env.STUB_UNKNOWN = "1";
    const parsed = parseBuildGridArgs([
      "--tasks", "build-billing-s1", "--arms", "A", "--seeds", "501-502", "--tasks-dir", f.tasksDir,
      "--results", f.results, "--runner", f.runner, "--effort", "medium", "--max-budget-usd", "2",
    ]);
    const summary = await runBuildGrid(parsed, { log: () => {} });
    assert.equal(summary.ran, 1);
    assert.equal(summary.unknownCost, 1);
    assert.equal(summary.halted, true);
    assert.equal(existsSync(join(f.results, "build-billing-s1-A-seed502")), false);
  } finally { delete process.env.STUB_UNKNOWN; rmSync(f.dir, { recursive: true, force: true }); }
});
