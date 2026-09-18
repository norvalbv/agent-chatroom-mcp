/** tasks/quill-editor: the hidden reference must reproduce oracle.json, each plausible wrong reading must change the answer
 * (so the public program exercises every corner), the scorer must separate them, and public/ holds nothing hidden.
 * Run: node --import tsx --test scripts/quill-task.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';
const task = resolve('tasks/quill-editor');
const expected = JSON.parse(readFileSync(join(task, 'oracle/oracle.json'), 'utf8')).expected as string;
const program = join(task, 'public/program.quill');
const ref = (variant = '') => spawnSync(process.execPath, [join(task, 'oracle/reference.mjs'), program, variant], { encoding: 'utf8', timeout: 15000 });
const WRONG_READINGS = ['swapNamesStay', 'undoKeepsNames', 'swapCursorPos', 'delCursorPrev', 'undoUndoable', 'undoRestoresClipboard', 'markKeepsBoth', 'pasteCursorFirst', 'cutCursorPrev'];

test('reference interpreter output equals oracle.json expected', () => {
  const run = ref();
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), expected);
});
test('every plausible wrong reading of the spec gives a different answer on the public program', () => {
  for (const v of WRONG_READINGS) assert.notEqual(ref(v).stdout.trim(), expected, `${v} is not exercised`);
});
test('scoreTask: expected passes, a wrong reading and a missing file fail distinctly', async () => {
  assert.equal(loadTask(task).oracle.kind, 'exact-answer');
  const root = mkdtempSync(join(tmpdir(), 'quill-task-'));
  try {
    cpSync(join(task, 'public'), root, { recursive: true });
    assert.equal((await scoreTask(task, root)).reason, 'parse_failure');
    writeFileSync(join(root, 'answer.txt'), expected);
    assert.equal((await scoreTask(task, root)).reason, 'task_pass');
    writeFileSync(join(root, 'answer.txt'), ref('swapNamesStay').stdout.trim());
    assert.equal((await scoreTask(task, root)).reason, 'task_fail');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('public/ holds only the brief, the spec and the program', () => {
  assert.deepEqual(readdirSync(join(task, 'public')).sort(), ['brief.txt', 'program.quill', 'spec.txt']);
  for (const f of readdirSync(join(task, 'public'))) assert.ok(!readFileSync(join(task, 'public', f), 'utf8').includes(expected));
});
