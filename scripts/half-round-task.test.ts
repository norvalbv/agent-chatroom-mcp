/** tasks/half-round: the BigInt reference must reproduce oracle.json (which came from the Fraction generator), the
 * double-rounding shortcut (decimal -> double -> half) must be wrong on many inputs, the scorer must fail a
 * near-miss, and nothing hidden may sit in public/.
 * Run: node --import tsx --test scripts/half-round-task.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';

const task = resolve('tasks/half-round');
const expected = JSON.parse(readFileSync(join(task, 'oracle/oracle.json'), 'utf8')).expected as string;
const inputs = readFileSync(join(task, 'public/inputs.txt'), 'utf8').split('\n').filter(l => l.trim());

test('BigInt reference equals oracle.json and there is one token per input line', () => {
  const run = spawnSync(process.execPath, [join(task, 'oracle/reference.mjs'), join(task, 'public/inputs.txt')], { encoding: 'utf8', timeout: 15000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), expected);
  assert.equal(expected.split(' ').length, inputs.length);
});

test('the double-rounding shortcut is wrong on at least 20 inputs (checked with python3 struct "e" when available)', () => {
  const py = spawnSync('python3', [join(task, 'oracle/generate.py'), 'stats'], { encoding: 'utf8', timeout: 30000, cwd: resolve('.') });
  if (py.error || py.status !== 0) return;
  const m = /(\d+) double-rounding differs/.exec(py.stdout);
  assert.ok(m && Number(m[1]) >= 20, py.stdout);
});

test('scoreTask: expected passes; one wrong token and a missing file fail distinctly', async () => {
  assert.equal(loadTask(task).oracle.kind, 'exact-answer');
  const root = mkdtempSync(join(tmpdir(), 'half-round-task-'));
  try {
    cpSync(join(task, 'public'), root, { recursive: true });
    assert.equal((await scoreTask(task, root)).reason, 'parse_failure');
    writeFileSync(join(root, 'answer.txt'), expected);
    assert.equal((await scoreTask(task, root)).reason, 'task_pass');
    const t = expected.split(' ');
    t[7] = t[7] === '0001' ? '0002' : '0001';
    writeFileSync(join(root, 'answer.txt'), t.join(' '));
    assert.equal((await scoreTask(task, root)).reason, 'task_fail');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('public/ holds only the brief, the spec and inputs.txt: no reference, no generator, no expected value', () => {
  assert.deepEqual(readdirSync(join(task, 'public')).sort(), ['brief.txt', 'inputs.txt', 'spec.txt']);
  for (const f of readdirSync(join(task, 'public'))) assert.ok(!readFileSync(join(task, 'public', f), 'utf8').includes(expected));
  assert.equal(existsSync(join(task, 'oracle/reference.mjs')), true);
});
