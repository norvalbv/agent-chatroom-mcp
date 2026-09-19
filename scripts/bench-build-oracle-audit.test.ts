/** Non-author catalogue audit: exercise defects absent from the two sample instances. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSrc, deriveInstance, writeTask } from './bench-build-gen.ts';

function score(task: string, workspace: string) {
  const run = spawnSync(process.execPath, ['--import', 'tsx', join(task, 'oracle', 'score.ts'), workspace],
    { encoding: 'utf8', timeout: 30_000 });
  assert.ok(run.status === 0 || run.status === 1, run.stderr);
  assert.ok(run.stdout.trim(), run.stderr || 'oracle emitted no JSON');
  return JSON.parse(run.stdout);
}

test('D05 generated baseline never counts its planted coupon defect as a new regression', async () => {
  const root = mkdtempSync(join(tmpdir(), 'build-oracle-d05-'));
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    const seed = Array.from({ length: 40 }, (_, i) => i + 3).find(i => deriveInstance(i).defects.includes('D05'))!;
    assert.ok(seed, 'catalogue must generate a coupon-order defect');
    const task = join(root, 'task');
    const inst = await writeTask(seed, task);
    const scored = score(task, join(task, 'public'));
    assert.equal(scored.defects_caught, 0);
    assert.equal(scored.regressions_failed, 0, JSON.stringify(scored));
    assert.equal(scored.defects_shipped, inst.defects.length);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('breaking a known but unplanted catalogue behaviour is a shipped regression', () => {
  const task = resolve('tasks/build-billing-s1');
  const workspace = mkdtempSync(join(tmpdir(), 'build-oracle-new-defect-'));
  try {
    cpSync(join(task, 'public'), workspace, { recursive: true });
    const inst = JSON.parse(readFileSync(join(task, 'oracle', 'instance.json'), 'utf8'));
    assert.ok(!inst.defects.includes('D01'), 'this sample starts with correct negative-half rounding');
    for (const [file, source] of Object.entries(buildSrc(inst, new Set<string>(inst.defects)))) {
      writeFileSync(join(workspace, 'src', file), source);
    }
    assert.equal(score(task, workspace).defects_shipped, 0, 'reference must be clean before the attack');
    writeFileSync(join(workspace, 'src', 'money.ts'), buildSrc({ ...inst, defects: ['D01'] }, new Set())['money.ts']);
    const scored = score(task, workspace);
    assert.equal(scored.defects_caught, inst.defects.length, 'original plants remain repaired');
    assert.ok(scored.regressions_failed > 0, 'a previously correct catalogue behaviour was broken');
    assert.ok(scored.defects_shipped > 0, JSON.stringify(scored));
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test('candidate global serialization changes cannot forge all hidden checks passing', () => {
  const task = resolve('tasks/build-billing-s1');
  const workspace = mkdtempSync(join(tmpdir(), 'build-oracle-stringify-'));
  try {
    cpSync(join(task, 'public'), workspace, { recursive: true });
    const money = join(workspace, 'src', 'money.ts');
    writeFileSync(money, readFileSync(money, 'utf8') + `
const originalStringify = JSON.stringify;
JSON.stringify = function(value, ...args) {
  if (value && typeof value === 'object' && 'oracle_results' in value) return originalStringify(value, ...args);
  return 'null';
};
`);
    const scored = score(task, workspace);
    assert.equal(scored.defects_caught, 0, 'no planted function was repaired by this mutation');
    assert.equal(scored.score, 0);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});
