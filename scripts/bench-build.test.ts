/** Contract checks for the planted-defect build-suite wrapper.  No model is invoked.
 * Run: node --import tsx scripts/bench-build.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const runner = resolve("scripts/bench-build.ts");

function fakeBench(result: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "bench-build-fake-"));
  const path = join(dir, "runner.mjs");
  writeFileSync(path, `import fs from 'node:fs'; const root=process.argv[process.argv.indexOf('--root')+1]; fs.mkdirSync(root,{recursive:true}); fs.writeFileSync(root+'/result.json',${JSON.stringify(JSON.stringify(result))});`);
  chmodSync(path, 0o755);
  return { dir, path };
}

function invoke(task: string, root: string, fake: string) {
  return spawnSync(process.execPath, ["--import", "tsx", runner, task, "A", "7", "--root", root, "--runner", fake], { encoding: "utf8", timeout: 20_000 });
}

const valid = {
  task_id: "seeded-orders-01", arm: "A", seed: 7,
  anti_tamper: { unchanged: true }, usage: { cost_usd: 0.4 },
  turns: { summed: 17 }, wall_clock: { duration_ms: 1234 },
  seats: [{ name: "single" }],
  oracle_results: [
    { name: "defect/rounding", exit_code: 0 },
    { name: "defect/cancel", exit_code: 1 },
    { name: "regression/tax-exempt", exit_code: 0 },
    { name: "regression/empty-order", exit_code: 1 },
  ],
};

test("runner exists", () => assert.ok(existsSync(runner), "scripts/bench-build.ts must exist"));

test("reduces named defect and regression checks to independent caught/shipped counts", () => {
  const task = mkdtempSync(join(tmpdir(), "bench-build-task-"));
  const root = join(tmpdir(), `bench-build-result-${process.pid}-${Date.now()}`);
  const fake = fakeBench(valid);
  try {
    const run = invoke(task, root, fake.path);
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(readFileSync(join(root, "build-result.json"), "utf8"));
    assert.deepEqual(out.scores, { defects_caught: 1, defects_total: 2, defects_shipped: 2, regression_failures: 1, regressions_total: 2 });
    assert.equal(out.provenance.raw_result, "result.json");
    assert.equal(out.provenance.anti_tamper_unchanged, true);
    assert.equal(out.usage.cost_usd, 0.4);
    assert.equal(out.turns, 17);
  } finally { rmSync(task, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); rmSync(fake.dir, { recursive: true, force: true }); }
});

test("refuses to make a score from an altered fixture or an unnamed hidden check", () => {
  const task = mkdtempSync(join(tmpdir(), "bench-build-task-"));
  const root = join(tmpdir(), `bench-build-bad-${process.pid}-${Date.now()}`);
  const fake = fakeBench({ ...valid, anti_tamper: { unchanged: false }, oracle_results: [...valid.oracle_results, { name: "mystery", exit_code: 0 }] });
  try {
    const run = invoke(task, root, fake.path);
    assert.notEqual(run.status, 0);
    assert.equal(existsSync(join(root, "build-result.json")), false);
    assert.match(run.stderr, /anti-tamper|named defect|regression/i);
  } finally { rmSync(task, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); rmSync(fake.dir, { recursive: true, force: true }); }
});
