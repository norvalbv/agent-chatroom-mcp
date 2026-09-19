/** tasks/complementary-fix: two independent boundary-inclusivity bugs (mergeIntervals, tierRate) in one
 * file, each scored by its own invariant group. Neither fixture that fixes only one bug may pass the
 * whole task; only both-fixed passes; broken must fail both groups. Nothing hidden may sit in public/.
 * Run: node --import tsx --test scripts/complementary-fix-task.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';

const task = resolve('tasks/complementary-fix');

function workspace(variant: 'broken' | 'correct' | 'only-merge-fixed' | 'only-tier-fixed') {
  const dir = mkdtempSync(join(tmpdir(), `complementary-fix-${variant}-`));
  cpSync(join(task, 'public'), dir, { recursive: true });
  cpSync(join(task, 'fixtures', variant), dir, { recursive: true });
  return dir;
}

function hidden(dir: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', join(task, 'oracle/score.ts'), dir], { encoding: 'utf8', timeout: 15000 });
}

test('loadTask dispatches the boundary-inclusivity-pair kind to oracle/score.ts', () => {
  assert.equal(loadTask(task).oracle.kind, 'boundary-inclusivity-pair');
});

test('hidden oracle: broken fails both invariant groups', () => {
  const dir = workspace('broken');
  try {
    const run = hidden(dir);
    assert.equal(run.status, 1, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.equal(out.score, 0);
    assert.deepEqual(out.group_results, { merge: false, tier: false });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hidden oracle: correct passes both invariant groups', () => {
  const dir = workspace('correct');
  try {
    const run = hidden(dir);
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.equal(out.score, 1);
    assert.deepEqual(out.group_results, { merge: true, tier: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hidden oracle: fixing only mergeIntervals leaves tierRate failing (and the whole task failing)', () => {
  const dir = workspace('only-merge-fixed');
  try {
    const run = hidden(dir);
    assert.equal(run.status, 1, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.equal(out.score, 0);
    assert.deepEqual(out.group_results, { merge: true, tier: false });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hidden oracle: fixing only tierRate leaves mergeIntervals failing (and the whole task failing)', () => {
  const dir = workspace('only-tier-fixed');
  try {
    const run = hidden(dir);
    assert.equal(run.status, 1, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.equal(out.score, 0);
    assert.deepEqual(out.group_results, { merge: false, tier: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('scoreTask (the real harness dispatch) agrees: correct passes, broken and each partial fixture fail', async () => {
  for (const [variant, reason] of [
    ['correct', 'task_pass'],
    ['broken', 'task_fail'],
    ['only-merge-fixed', 'task_fail'],
    ['only-tier-fixed', 'task_fail'],
  ] as const) {
    const dir = workspace(variant);
    try {
      const scored = await scoreTask(task, dir);
      assert.equal(scored.reason, reason, variant);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('public/ holds only the brief, the source file and package.json: no oracle, no fixtures, no group labels', () => {
  assert.deepEqual(readdirSync(join(task, 'public')).sort(), ['brief.txt', 'package.json', 'scheduling.ts']);
  const brief = readFileSync(join(task, 'public/brief.txt'), 'utf8');
  assert.ok(!brief.toLowerCase().includes('group'));
  assert.ok(!brief.toLowerCase().includes('bug'));
});
