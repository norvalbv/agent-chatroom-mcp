/** bench-shelf-quiet: bench-shelf-lang with the copy/share rules folded into the statement bullets and the program's hint comments removed.
 * Same program semantics as its parent, so the oracle is shared; this proves it and that the hints are gone.
 * Run: node --import tsx --test scripts/shelf-quiet-task.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadTask } from './bench-oracle.ts';
import { runShelf } from '../tasks/bench-shelf-quiet/fixtures/reference/shelf.ts';

const dir = resolve('tasks/bench-shelf-quiet');
const expected = JSON.parse(readFileSync(resolve(dir, 'oracle/oracle.json'), 'utf8')).expected as string;
const source = readFileSync(resolve(dir, 'public/program.shelf'), 'utf8');

test('bench-shelf-quiet: TypeScript and Python references agree with the frozen oracle', () => {
  assert.equal(loadTask(dir).oracle.kind, 'exact-answer');
  assert.equal(runShelf(source).join('|'), expected);
  const py = spawnSync('python3', [resolve(dir, 'fixtures/reference/shelf.py'), resolve(dir, 'public/program.shelf')], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  assert.equal(py.stdout.trim(), expected);
});

test('bench-shelf-quiet: no comments in the program and no dedicated copying section in the spec', () => {
  assert.ok(!source.split('\n').some(l => l.trim().startsWith('#')));
  assert.ok(!/^## Copying/m.test(readFileSync(resolve(dir, 'public/SPEC.md'), 'utf8')));
  assert.ok(!readFileSync(resolve(dir, 'public/brief.txt'), 'utf8').includes(expected));
});
