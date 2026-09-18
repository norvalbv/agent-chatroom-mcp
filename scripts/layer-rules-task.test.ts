/** tasks/bench-layer-rules: the hidden reference resolver must reproduce oracle.json's expected value, the scorer must
 * pass exactly that and fail the imperative (top-to-bottom assignment) distractor, and nothing hidden may sit in public/.
 * Run: node --import tsx --test scripts/layer-rules-task.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';
const task = resolve('tasks/bench-layer-rules');
const expected = JSON.parse(readFileSync(join(task, 'oracle/oracle.json'), 'utf8')).expected as string;
const reference = (...extra: string[]) => spawnSync(process.execPath, [join(task, 'oracle/reference.mjs'), join(task, 'public/program.layers'), ...extra], { encoding: 'utf8', timeout: 15000 });

test('reference resolver output equals oracle.json expected', () => {
  const run = reference();
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), expected);
});
test('the imperative distractor differs from the answer in at least a quarter of the tokens', () => {
  const seq = reference('--sequential').stdout.trim().split(' ');
  const exp = expected.split(' ');
  assert.equal(seq.length, exp.length);
  assert.ok(seq.filter((v, i) => v !== exp[i]).length >= exp.length / 4);
});
test('the generator reproduces the checked-in program (seed 7)', () => {
  const run = spawnSync(process.execPath, [join(task, 'oracle/gen.mjs'), '7'], { encoding: 'utf8' });
  assert.equal(run.stdout, readFileSync(join(task, 'public/program.layers'), 'utf8'));
});
test('scoreTask: expected passes; the imperative answer, a one-token slip and a missing file fail distinctly', async () => {
  assert.equal(loadTask(task).oracle.kind, 'exact-answer');
  const root = mkdtempSync(join(tmpdir(), 'layer-rules-task-'));
  try {
    cpSync(join(task, 'public'), root, { recursive: true });
    assert.equal((await scoreTask(task, root)).reason, 'parse_failure');
    writeFileSync(join(root, 'answer.txt'), expected);
    assert.equal((await scoreTask(task, root)).reason, 'task_pass');
    writeFileSync(join(root, 'answer.txt'), reference('--sequential').stdout.trim());
    assert.equal((await scoreTask(task, root)).reason, 'task_fail');
    const tokens = expected.split(' ');
    tokens[10] = String(Number(tokens[10]) + 1);
    writeFileSync(join(root, 'answer.txt'), tokens.join(' '));
    assert.equal((await scoreTask(task, root)).reason, 'task_fail');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('public/ holds only the brief, the spec and the program: no reference resolver, no expected value', () => {
  assert.deepEqual(readdirSync(join(task, 'public')).sort(), ['brief.txt', 'program.layers', 'spec.txt']);
  for (const f of readdirSync(join(task, 'public'))) assert.ok(!readFileSync(join(task, 'public', f), 'utf8').includes(expected));
  assert.equal(existsSync(join(task, 'oracle/reference.mjs')), true);
});
