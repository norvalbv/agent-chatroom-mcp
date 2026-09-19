/** Non-author regressions for provenance mixing and paid-invalid-cell accounting. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBuildReport } from './bench-build-report.js';
import { runBuildGrid, type BuildGridArgs } from './bench-build-grid.js';

function measured(seed: number, taskHash: string) {
  return {
    task_id: 'same-task', arm: 'A', seed, execution_outcome: 'completed', oracle_outcome: 'task_pass', public_suite_passed: true,
    scores: { defects_caught: 1, defects_total: 1, defects_shipped: 0, regression_failures: 0, regressions_total: 1 },
    checks: { defects: [{ name: 'defect/D1', exit_code: 0 }], regressions: [{ name: 'regression/R1', exit_code: 0 }] },
    usage: { cost_usd: 0.1, coverage: 'complete', thinking_tokens: 1, output_tokens: 2 },
    wall_clock_ms: 100,
    effort: { level: 'medium', settings_sha256: 'c'.repeat(64), own_git_root: true },
    provenance: { grid_fingerprint: String(seed).repeat(64), native_run_fingerprint: 'e'.repeat(64), manifest_sha256: taskHash, runner_sha256: 'd'.repeat(64), task_sha256_before_score: taskHash, task_sha256_after_score: taskHash },
  };
}

test('same-label cells from different task versions cannot enter one catch table', () => {
  const root = mkdtempSync(join(tmpdir(), 'build-version-audit-'));
  const put = (seed: number, hash: string) => {
    const dir = join(root, `cell-${seed}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'build-result.json'), JSON.stringify(measured(seed, hash)));
  };
  try {
    put(1, 'a'.repeat(64)); put(2, 'a'.repeat(64));
    assert.equal(buildBuildReport(root, ['same-task'], ['A'], [1, 2], 2).summary.valid, 2,
      'control: the compatible complete pair must be readable');
    put(2, 'b'.repeat(64));
    let rejected = false;
    try { rejected = buildBuildReport(root, ['same-task'], ['A'], [1, 2], 2).summary.valid < 2; }
    catch { rejected = true; }
    assert.ok(rejected, 'two valid but different task/manifest hashes must not be pooled');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const mode of ['invalid-result', 'wrapper-failure'] as const) {
  test(`known paid cost survives ${mode}`, async () => {
    const base = mkdtempSync(join(tmpdir(), 'build-cost-audit-'));
    const task = join(base, 'task');
    mkdirSync(task);
    writeFileSync(join(task, 'brief.txt'), 'Offline accounting fixture; no model is called.');
    const runner = join(base, 'paid-runner.mjs');
    writeFileSync(runner, `
import fs from 'node:fs';
const argv=process.argv.slice(2), root=argv[argv.indexOf('--root')+1];
fs.mkdirSync(root,{recursive:true});
const raw={task_id:'WRONG',arm:'A',seed:1,usage:{cost_usd:0.23,coverage:'complete'}};
fs.writeFileSync(root+'/result.json',JSON.stringify(raw));
${mode === 'invalid-result' ? "fs.writeFileSync(root+'/build-result.json',JSON.stringify(raw));" : 'process.exitCode=1;'}
`);
    const args: BuildGridArgs = {
      taskDirs: [task], arms: ['A'], seeds: [1], resultsDir: join(base, 'results'), runner,
      model: 'stub', effort: 'medium', maxBudgetUsd: 2, seats: 4, deadlineMs: 10000,
      basePort: 23920, hubEntry: null, maxTotalCostUsd: null,
    };
    try {
      const summary = await runBuildGrid(args, { log: () => {} });
      assert.equal(summary.halted, true);
      assert.equal(mode === 'invalid-result' ? summary.invalid : summary.infraFailed, 1,
        'the intended failure path must actually occur');
      assert.equal(summary.knownCostUsd, 0.23,
        'a score/provenance failure does not erase measured spend');
      assert.equal(summary.unknownCost, 0);
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
}
