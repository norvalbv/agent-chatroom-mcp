/** tasks/gleam-machine: the hidden reference machine must reproduce oracle.json, each habit-based misreading
 * (6502-style flags) must change the answer or fail to terminate, the scorer must fail the near-misses,
 * and nothing hidden may sit in public/.
 * Run: node --import tsx --test scripts/gleam-task.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';

const task = resolve('tasks/gleam-machine');
const expected = JSON.parse(readFileSync(join(task, 'oracle/oracle.json'), 'utf8')).expected as string;
const reference = (habit = '') => spawnSync(process.execPath, [join(task, 'oracle/reference.mjs'), join(task, 'public/program.gleam')], { encoding: 'utf8', timeout: 15000, env: { ...process.env, GLEAM_HABIT: habit } });

test('reference machine output equals oracle.json expected', () => {
  const run = reference();
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), expected);
});

test('each 6502-habit misreading of the flag rule changes the answer or never halts', () => {
  for (const habit of ['load', 'incdec', 'shift']) {
    const run = reference(habit);
    assert.ok(run.status !== 0 || run.stdout.trim() !== expected, `habit ${habit} must not reproduce the expected answer`);
  }
});

test('scoreTask: expected passes; a wrong token and a missing file fail distinctly', async () => {
  assert.equal(loadTask(task).oracle.kind, 'exact-answer');
  const root = mkdtempSync(join(tmpdir(), 'gleam-task-'));
  try {
    cpSync(join(task, 'public'), root, { recursive: true });
    assert.equal((await scoreTask(task, root)).reason, 'parse_failure');
    writeFileSync(join(root, 'answer.txt'), expected);
    assert.equal((await scoreTask(task, root)).reason, 'task_pass');
    const t = expected.split(' ');
    t[t.length - 1] = '7';
    writeFileSync(join(root, 'answer.txt'), t.join(' '));
    assert.equal((await scoreTask(task, root)).reason, 'task_fail');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('public/ holds only the brief, the spec and the program: no reference machine, no expected value', () => {
  assert.deepEqual(readdirSync(join(task, 'public')).sort(), ['brief.txt', 'program.gleam', 'spec.txt']);
  for (const f of readdirSync(join(task, 'public'))) assert.ok(!readFileSync(join(task, 'public', f), 'utf8').includes(expected));
  assert.equal(existsSync(join(task, 'oracle/reference.mjs')), true);
});
