/** tasks/jensen-machine: the hidden reference must reproduce oracle.json; the wrong readings that finish must each change the answer,
 * the ones that cannot finish must not reproduce it; the scorer must separate them; public/ holds nothing hidden.
 * Run: node --import tsx --test scripts/jensen-task.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';
const task = resolve('tasks/jensen-machine');
const expected = JSON.parse(readFileSync(join(task, 'oracle/oracle.json'), 'utf8')).expected as string;
const program = join(task, 'public/program.byname');
const ref = (variant = '') => spawnSync(process.execPath, [join(task, 'oracle/reference.mjs'), program, variant], { encoding: 'utf8', timeout: 5000 });
const FINISHING = ['byValue', 'globalThunk', 'assignLocal', 'setGlobal'];
const NONTERMINATING = ['cached', 'noAssignThrough', 'dynamicThunk'];

test('reference interpreter output equals oracle.json expected', () => {
  const run = ref();
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), expected);
});
test('each wrong reading either finishes with a different answer or cannot finish', () => {
  for (const v of FINISHING) { const r = ref(v); assert.equal(r.status, 0, v); assert.notEqual(r.stdout.trim(), expected, `${v} is not exercised`); }
  for (const v of NONTERMINATING) { const r = ref(v); assert.ok(r.error || r.status !== 0 || r.stdout.trim() !== expected, `${v} is not exercised`); }
});
test('scoreTask: expected passes, a wrong reading and a missing file fail distinctly', async () => {
  assert.equal(loadTask(task).oracle.kind, 'exact-answer');
  const root = mkdtempSync(join(tmpdir(), 'jensen-task-'));
  try {
    cpSync(join(task, 'public'), root, { recursive: true });
    assert.equal((await scoreTask(task, root)).reason, 'parse_failure');
    writeFileSync(join(root, 'answer.txt'), expected);
    assert.equal((await scoreTask(task, root)).reason, 'task_pass');
    writeFileSync(join(root, 'answer.txt'), ref('byValue').stdout.trim());
    assert.equal((await scoreTask(task, root)).reason, 'task_fail');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('public/ holds only the brief, the spec and the program', () => {
  assert.deepEqual(readdirSync(join(task, 'public')).sort(), ['brief.txt', 'program.byname', 'spec.txt']);
  for (const f of readdirSync(join(task, 'public'))) assert.ok(!readFileSync(join(task, 'public', f), 'utf8').includes(expected));
});
