/** tasks/sched-trace: the hidden reference simulator must reproduce oracle.json's expected value,
 * the scorer must pass exactly that and fail a plausible near-miss, and nothing hidden may sit in public/.
 * Run: node --import tsx --test scripts/sched-trace-task.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';

const task = resolve('tasks/sched-trace');
const expected = JSON.parse(readFileSync(join(task, 'oracle/oracle.json'), 'utf8')).expected as string;
const reference = () => spawnSync(process.execPath, [join(task, 'oracle/reference.mjs'), join(task, 'public/jobs.txt')], { encoding: 'utf8', timeout: 15000 });

test('reference simulator output equals oracle.json expected', () => {
  const run = reference();
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), expected);
});

test('scoreTask: expected passes; a one-job-off near-miss (real arm-A seed1 slip: C:7 not C:6) and a missing file fail distinctly', async () => {
  assert.equal(loadTask(task).oracle.kind, 'exact-answer');
  const root = mkdtempSync(join(tmpdir(), 'sched-trace-task-'));
  try {
    cpSync(join(task, 'public'), root, { recursive: true });
    assert.equal((await scoreTask(task, root)).reason, 'parse_failure');
    writeFileSync(join(root, 'answer.txt'), expected);
    assert.equal((await scoreTask(task, root)).reason, 'task_pass');
    const nearMiss = expected.replace('C:6', 'C:7');
    assert.notEqual(nearMiss, expected);
    writeFileSync(join(root, 'answer.txt'), nearMiss);
    assert.equal((await scoreTask(task, root)).reason, 'task_fail');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('public/ holds only the brief, the spec and jobs.txt: no reference simulator, no expected value', () => {
  assert.deepEqual(readdirSync(join(task, 'public')).sort(), ['brief.txt', 'jobs.txt', 'spec.txt']);
  for (const f of readdirSync(join(task, 'public'))) assert.ok(!readFileSync(join(task, 'public', f), 'utf8').includes(expected));
  assert.equal(existsSync(join(task, 'oracle/reference.mjs')), true);
});
