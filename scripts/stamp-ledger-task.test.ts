/** tasks/stamp-ledger: same byte-identical STAMP spec as stamp-interpreter, a different program. The hidden reference must reproduce
 * oracle.json, the lexical-closure reading must change the answer at exactly the nested-DEF call sites, the scorer must separate them,
 * and public/ holds nothing hidden.
 * Run: node --import tsx --test scripts/stamp-ledger-task.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';
const task = resolve('tasks/stamp-ledger');
const expected = JSON.parse(readFileSync(join(task, 'oracle/oracle.json'), 'utf8')).expected as string;
const ref = (variant = '') => spawnSync(process.execPath, [join(task, 'oracle/reference.mjs'), join(task, 'public/program.stamp'), variant], { encoding: 'utf8', timeout: 15000 });

test('reference interpreter output equals oracle.json expected', () => {
  const run = ref();
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), expected);
});
test('the lexical-closure reading differs from the answer exactly at the two report calls', () => {
  const a = expected.split(' '), b = ref('closureRead').stdout.trim().split(' ');
  assert.equal(a.length, b.length);
  const diff = a.map((x, i) => (x === b[i] ? -1 : i)).filter(i => i >= 0);
  assert.deepEqual(diff, [15, 16]);
  assert.deepEqual([a[15], a[16], b[15], b[16]], ['50', '50', '100', '20']);
});
test('the STAMP spec is byte-identical to stamp-interpreter\'s', () => {
  assert.equal(readFileSync(join(task, 'public/spec.txt'), 'utf8'), readFileSync(resolve('tasks/stamp-interpreter/public/spec.txt'), 'utf8'));
});
test('scoreTask: expected passes, the closure answer and a missing file fail distinctly', async () => {
  assert.equal(loadTask(task).oracle.kind, 'exact-answer');
  const root = mkdtempSync(join(tmpdir(), 'stamp-ledger-'));
  try {
    cpSync(join(task, 'public'), root, { recursive: true });
    assert.equal((await scoreTask(task, root)).reason, 'parse_failure');
    writeFileSync(join(root, 'answer.txt'), expected);
    assert.equal((await scoreTask(task, root)).reason, 'task_pass');
    writeFileSync(join(root, 'answer.txt'), ref('closureRead').stdout.trim());
    assert.equal((await scoreTask(task, root)).reason, 'task_fail');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('public/ holds only the brief, the spec and the program', () => {
  assert.deepEqual(readdirSync(join(task, 'public')).sort(), ['brief.txt', 'program.stamp', 'spec.txt']);
  for (const f of readdirSync(join(task, 'public'))) assert.ok(!readFileSync(join(task, 'public', f), 'utf8').includes(expected));
});
