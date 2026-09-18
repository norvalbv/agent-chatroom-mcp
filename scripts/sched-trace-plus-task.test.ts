/** tasks/sched-trace-plus: the hidden reference must reproduce oracle.json, the independent Python check must agree,
 * each ignored new rule (device queue, decay, idle resets LAST) must change the answer, the scorer must fail a near-miss,
 * and nothing hidden may sit in public/.
 * Run: node --import tsx --test scripts/sched-trace-plus-task.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';

const task = resolve('tasks/sched-trace-plus');
const expected = JSON.parse(readFileSync(join(task, 'oracle/oracle.json'), 'utf8')).expected as string;
const jobs = join(task, 'public/jobs.txt');
const reference = (mut = '') => spawnSync(process.execPath, [join(task, 'oracle/reference.mjs'), jobs], { encoding: 'utf8', timeout: 15000, env: { ...process.env, MUT: mut } });

test('reference simulator output equals oracle.json; 24 jobs', () => {
  const run = reference();
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), expected);
  assert.equal(expected.split(' ').length, 24);
});

test('independent Python check agrees (skipped when python3 is absent)', () => {
  const py = spawnSync('python3', [join(task, 'oracle/independent-check.py'), jobs], { encoding: 'utf8', timeout: 15000 });
  if (py.error) return;
  assert.equal(py.status, 0, py.stderr);
  assert.equal(py.stdout.trim(), expected);
});

test('ignoring the device queue, the decay rule, or the idle-resets-LAST rule changes the answer', () => {
  for (const mut of ['nodevice', 'nodecay', 'keeplast']) assert.notEqual(reference(mut).stdout.trim(), expected, mut);
});

test('scoreTask: expected passes; one job off by one tick and a missing file fail distinctly', async () => {
  assert.equal(loadTask(task).oracle.kind, 'exact-answer');
  const root = mkdtempSync(join(tmpdir(), 'sched-plus-'));
  try {
    cpSync(join(task, 'public'), root, { recursive: true });
    assert.equal((await scoreTask(task, root)).reason, 'parse_failure');
    writeFileSync(join(root, 'answer.txt'), expected);
    assert.equal((await scoreTask(task, root)).reason, 'task_pass');
    writeFileSync(join(root, 'answer.txt'), expected.replace(/^A:9/, 'A:10'));
    assert.equal((await scoreTask(task, root)).reason, 'task_fail');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('public/ holds only the brief, the spec and jobs.txt', () => {
  assert.deepEqual(readdirSync(join(task, 'public')).sort(), ['brief.txt', 'jobs.txt', 'spec.txt']);
  for (const f of readdirSync(join(task, 'public'))) assert.ok(!readFileSync(join(task, 'public', f), 'utf8').includes(expected));
  assert.equal(existsSync(join(task, 'oracle/reference.mjs')), true);
});
