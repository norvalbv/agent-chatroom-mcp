/** Regression for bench-shelf-lang (claim/spec-trap-timezone-encoding, audit-family pivot).
 * Truth is cross-checked by two independent interpreters (TypeScript and Python) before being
 * frozen into oracle/oracle.json, so the expected string is machine-derived, not author-asserted.
 * Run: node --import tsx --test scripts/shelf-lang-tasks.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';
import { runShelf } from '../tasks/bench-shelf-lang/fixtures/reference/shelf.ts';

const dir = resolve('tasks/bench-shelf-lang');

for (const name of ['bench-shelf-lang', 'bench-shelf-long']) {
  const d = resolve('tasks', name);
  test(`${name}: TypeScript and Python references agree with the frozen oracle`, () => {
    const expected = JSON.parse(readFileSync(resolve(d, 'oracle/oracle.json'), 'utf8')).expected as string;
    const source = readFileSync(resolve(d, 'public/program.shelf'), 'utf8');
    assert.equal(runShelf(source).join('|'), expected);
    const py = spawnSync('python3', [resolve(d, 'fixtures/reference/shelf.py'), resolve(d, 'public/program.shelf')], { encoding: 'utf8' });
    assert.equal(py.status, 0, py.stderr);
    assert.equal(py.stdout.trim(), expected);
  });
}

test('bench-shelf-lang: TypeScript and Python reference interpreters agree, and match the frozen oracle', () => {
  assert.equal(loadTask(dir).oracle.kind, 'exact-answer');
  const expected = JSON.parse(readFileSync(resolve(dir, 'oracle/oracle.json'), 'utf8')).expected as string;
  const source = readFileSync(resolve(dir, 'public/program.shelf'), 'utf8');
  const tsOut = runShelf(source).join('|');
  assert.equal(tsOut, expected);
  const py = spawnSync('python3', [resolve(dir, 'fixtures/reference/shelf.py'), resolve(dir, 'public/program.shelf')], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  assert.equal(py.stdout.trim(), expected);
});

test('bench-shelf-lang: LET deep-copies by structure while PUSH/SET/FOR/RUN(list) share (spot checks)', () => {
  const cases: { name: string; src: string; expect: string }[] = [
    { name: 'LET copies nested structure', src: 'DEF g l\nPUSH l 2\nEND\nLET a (list (list 1))\nLET b a\nRUN g (idx b 0)\nPRINT a\nPRINT b', expect: '[[1]]|[[1,2]]' },
    { name: 'PUSH shares the pushed object', src: 'LET x (list 1)\nLET y (list)\nPUSH y x\nPUSH x 2\nPRINT y', expect: '[[1,2]]' },
    { name: 'FOR snapshots the list but shares elements', src: 'LET l (list 1 2)\nFOR v l\nPUSH l (+ v 10)\nEND\nPRINT l', expect: '[1,2,11,12]' },
    { name: 'RUN passes lists by reference, ints by value', src: 'DEF f n l\nLET n (+ n 1)\nPUSH l n\nEND\nLET k 1\nLET acc (list)\nRUN f k acc\nRUN f k acc\nPRINT k\nPRINT acc', expect: '1|[2,2]' },
    { name: 'local scope does not leak to caller; global lookup falls through', src: 'LET g 1\nDEF t\nLET g 2\nPRINT g\nEND\nRUN t\nPRINT g', expect: '2|1' },
  ];
  for (const c of cases) assert.equal(runShelf(c.src).join('|'), c.expect, c.name);
});

test('bench-shelf-lang: scoreTask normalization and outcome vocabulary', async () => {
  const root = resolve('.tmp-shelf-score-test');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const d = mkdtempSync(join(tmpdir(), 'shelf-score-'));
  try {
    const expected = JSON.parse(readFileSync(resolve(dir, 'oracle/oracle.json'), 'utf8')).expected as string;
    writeFileSync(join(d, 'answer.txt'), expected);
    assert.equal((await scoreTask(dir, d)).reason, 'task_pass');
    writeFileSync(join(d, 'answer.txt'), expected.replace('[1,2,3]', '[3,2,1]'));
    assert.equal((await scoreTask(dir, d)).reason, 'task_fail');
    rmSync(join(d, 'answer.txt'));
    assert.equal((await scoreTask(dir, d)).reason, 'parse_failure');
  } finally { rmSync(d, { recursive: true, force: true }); }
  void root;
});
