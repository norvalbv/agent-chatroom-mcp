/** tasks/stamp-2: same STAMP spec as stamp-interpreter (byte-identical), a new program. The hidden reference and a
 * spec-only Python interpreter must reproduce oracle.json; four wrong readings must each score task_fail;
 * nothing hidden may sit in public/.
 * Run: node --import tsx --test scripts/stamp2-task.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';
const task = resolve('tasks/stamp-2');
const expected = JSON.parse(readFileSync(join(task, 'oracle/oracle.json'), 'utf8')).expected as string;
const program = join(task, 'public/program.stamp');

const WRONG: Record<string, string> = {
  closure: '12 1 9 0 0 40 3 150 6 28 9 12 41 40 104 99 104 24 9 11 11 10 479001600 45 8 19 7 0 77 0 0 15 15 16 15 14640 1099511627776 3',
  dynamic: '12 1 9 0 0 12 3 45 6 28 1008 3008 10 40 10 99 104 24 9 11 11 10 479001600 45 8 19 7 0 77 0 0 15 15 16 15 255 1099511627776 3',
  nextGlobal: '12 1 9 0 0 12 3 45 6 3007 3005 3008 41 40 104 99 104 24 9 11 12 12 479001600 45 8 19 7 0 77 0 0 17 17 18 18 255 1099511627776 3',
  setsSequential: '36 5 9 0 0 12 3 45 6 3007 3005 3008 41 40 104 99 104 24 9 11 11 10 479001600 45 8 19 7 0 77 0 0 15 15 16 15 255 1099511627776 3',
};

test('spec.txt and brief.txt are byte-identical to stamp-interpreter (same language, new program)', () => {
  for (const f of ['spec.txt', 'brief.txt']) {
    assert.equal(readFileSync(join(task, 'public', f), 'utf8'), readFileSync(join(resolve('tasks/stamp-interpreter'), 'public', f), 'utf8'));
  }
});
test('reference interpreter output equals oracle.json expected', () => {
  const run = spawnSync(process.execPath, [join(task, 'oracle/reference.mjs'), program], { encoding: 'utf8', timeout: 15000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), expected);
});
test('spec-only Python interpreter agrees with the reference (skipped when python3 is absent)', (t) => {
  const run = spawnSync('python3', [join(task, 'oracle/independent-check.py'), program], { encoding: 'utf8', timeout: 15000 });
  if (run.error) return t.skip('python3 not available');
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), expected);
});
test('scoreTask: expected passes; each wrong reading and a missing file fail', async () => {
  assert.equal(loadTask(task).oracle.kind, 'exact-answer');
  const root = mkdtempSync(join(tmpdir(), 'stamp2-task-'));
  try {
    cpSync(join(task, 'public'), root, { recursive: true });
    assert.equal((await scoreTask(task, root)).reason, 'parse_failure');
    writeFileSync(join(root, 'answer.txt'), expected);
    assert.equal((await scoreTask(task, root)).reason, 'task_pass');
    for (const [name, wrong] of Object.entries(WRONG)) {
      assert.notEqual(wrong, expected, name);
      writeFileSync(join(root, 'answer.txt'), wrong);
      assert.equal((await scoreTask(task, root)).reason, 'task_fail', name);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('public/ holds only the brief, the spec and the program: no reference, no expected value', () => {
  assert.deepEqual(readdirSync(join(task, 'public')).sort(), ['brief.txt', 'program.stamp', 'spec.txt']);
  for (const f of readdirSync(join(task, 'public'))) assert.ok(!readFileSync(join(task, 'public', f), 'utf8').includes(expected));
});
