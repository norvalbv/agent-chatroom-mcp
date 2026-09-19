/** Non-author contract audit: real grid, wrapper, executor and report; fake CLI only. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { runBuildGrid, type BuildGridArgs } from './bench-build-grid.js';
import { buildBuildReport } from './bench-build-report.js';

test('native A result survives grid validation, report and compatible resume', async () => {
  const base = mkdtempSync(join(tmpdir(), 'build-e2e-audit-'));
  const task = join(base, 'contract-audit');
  const bin = join(base, 'bin');
  const oldPath = process.env.PATH;
  try {
    mkdirSync(join(task, 'public'), { recursive: true });
    mkdirSync(join(task, 'public', 'test'));
    mkdirSync(join(task, 'oracle'));
    mkdirSync(bin);
    writeFileSync(join(task, 'task.json'), JSON.stringify({ task_id: 'contract-audit' }));
    writeFileSync(join(task, 'DEFECTS.json'), JSON.stringify({ defects: [{ id: 'repair' }], regressions: [{ id: 'stable' }] }));
    writeFileSync(join(task, 'oracle', 'oracle.json'), JSON.stringify({ kind: 'private-tests' }));
    writeFileSync(join(task, 'public', 'brief.txt'), 'Make value.txt contain fixed. Preserve stable.txt.');
    writeFileSync(join(task, 'public', 'value.txt'), 'broken');
    writeFileSync(join(task, 'public', 'stable.txt'), 'stable');
    writeFileSync(join(task, 'public', 'test', 'smoke.test.ts'), `
import assert from 'node:assert/strict';
import { test } from 'node:test';
test('public baseline remains runnable', () => assert.equal(1 + 1, 2));
`);
    writeFileSync(join(task, 'oracle', 'score.ts'), `
import { readFileSync } from 'node:fs';
const w=process.argv[2];
const fixed=readFileSync(w+'/value.txt','utf8')==='fixed';
const stable=readFileSync(w+'/stable.txt','utf8')==='stable';
console.log(JSON.stringify({score:fixed&&stable?1:0,oracle_results:[{name:'defect/repair',exit_code:fixed?0:1},{name:'regression/stable',exit_code:stable?0:1}]}));
process.exit(fixed&&stable?0:1);
`);
    writeFileSync(join(bin, 'claude'), `#!/usr/bin/env node
require('node:fs').writeFileSync('value.txt','fixed');
console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'done',num_turns:1,total_cost_usd:0.001,usage:{input_tokens:1,output_tokens:7,cache_read_input_tokens:0,cache_creation_input_tokens:0},modelUsage:{'audit-model':{thinkingTokens:3,outputTokens:7}}}));
`);
    chmodSync(join(bin, 'claude'), 0o755);
    process.env.PATH = bin + delimiter + oldPath;
    const args: BuildGridArgs = {
      taskDirs: [task], arms: ['A'], seeds: [17], resultsDir: join(base, 'results'),
      runner: resolve(process.env.BENCH_BUILD_AUDIT_RUNNER ?? 'scripts/bench-build.ts'),
      model: 'sonnet', effort: 'medium', maxBudgetUsd: 0.1, seats: 4,
      deadlineMs: 10_000, basePort: 23940, hubEntry: null, maxTotalCostUsd: 1,
    };
    const first = await runBuildGrid(args, { log() {} });
    assert.equal(first.halted, false, JSON.stringify(first));
    assert.equal(first.ran, 1);
    assert.equal(first.knownCostUsd, 0.001);
    const report = buildBuildReport(args.resultsDir, ['contract-audit'], ['A'], [17], 0.1);
    assert.equal(report.summary.valid, 1, JSON.stringify(report));
    assert.equal(report.rows[0].defects_caught, 1);
    assert.equal(report.rows[0].defects_shipped, 0);
    assert.equal(report.rows[0].cost_usd, 0.001);
    assert.equal(report.rows[0].thinking_tokens, 3);
    assert.equal(report.rows[0].output_tokens, 7);
    assert.equal(report.rows[0].public_suite_passed, true);
    const resumed = await runBuildGrid(args, { log() {} });
    assert.equal(resumed.ran, 0);
    assert.equal(resumed.skipped, 1);
    assert.equal(resumed.knownCostUsd, 0.001);
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    rmSync(base, { recursive: true, force: true });
  }
});
