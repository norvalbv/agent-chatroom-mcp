/** bench-arrow-fn-values: two independent references agree with the frozen oracle, and the lexical-closure reading changes the answer. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';
import { runArrow } from '../tasks/bench-arrow-fn-values/fixtures/reference/arrow.mjs';

const dir = resolve('tasks/bench-arrow-fn-values');
const expected = () => JSON.parse(readFileSync(resolve(dir, 'oracle/oracle.json'), 'utf8')).expected as string;
const program = () => readFileSync(resolve(dir, 'public/program.arrow'), 'utf8');

test('arrow: JS and Python references agree with oracle.json', () => {
  assert.equal(loadTask(dir).oracle.kind, 'exact-answer');
  assert.equal(runArrow(program()).join(' '), expected());
  const py = spawnSync('python3', [resolve(dir, 'fixtures/reference/arrow.py'), resolve(dir, 'public/program.arrow')], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  assert.equal(py.stdout.trim(), expected());
});

test('arrow: a function value does not capture its creator (spot checks of the SCOPE rule)', () => {
  const t = (src: string) => runArrow(src).join(' ');
  assert.equal(t('SET n 100\nDEF adder n\nRET (fn (x) (+ x n))\nEND\nPRINT (call (call adder 5) 1)'), '101');
  assert.equal(t('DEF mk\nSET c 3\nRET (fn () c)\nEND\nPRINT (call (call mk))'), '0');
  assert.equal(t('SET c 9\nDEF mk\nSET c 3\nRET (fn () c)\nEND\nPRINT (call (call mk))'), '9');
  assert.equal(t('DEF b\nGLOBAL c\nSET c (+ c 1)\nRET c\nEND\nPRINT (call b)\nPRINT c'), '1 1');
  assert.equal(t('PRINT (call 5 (call (fn () 1)))'), '0');
});

test('arrow: scoring accepts the frozen answer and rejects the closure reading', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const d = mkdtempSync(join(tmpdir(), 'arrow-score-'));
  try {
    writeFileSync(join(d, 'answer.txt'), expected());
    assert.equal((await scoreTask(dir, d)).reason, 'task_pass');
    writeFileSync(join(d, 'answer.txt'), expected().replace(/^6 7 12 16 7 101/, '6 7 12 16 7 6'));
    assert.equal((await scoreTask(dir, d)).reason, 'task_fail');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
