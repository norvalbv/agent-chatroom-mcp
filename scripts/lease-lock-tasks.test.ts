/** Regression for bench-lease-lock: two independent simulators (JS, Python) agree with the frozen oracle,
 * each plausible wrong reading gives a different answer, and the scorer vocabulary holds.
 * Run: node --import tsx --test scripts/lease-lock-tasks.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';
// @ts-expect-error plain .mjs reference without types
import { parseLog, simulate } from '../tasks/bench-lease-lock/fixtures/reference/lease.mjs';

const dir = resolve('tasks/bench-lease-lock');
const log = readFileSync(resolve(dir, 'public/events.txt'), 'utf8');
const expected = JSON.parse(readFileSync(resolve(dir, 'oracle/oracle.json'), 'utf8')).expected as string;

test('bench-lease-lock: JS and Python simulators agree with the frozen oracle', () => {
  assert.equal(loadTask(dir).oracle.kind, 'exact-answer');
  assert.equal(simulate(parseLog(log)), expected);
  const py = spawnSync('python3', [resolve(dir, 'fixtures/reference/lease.py'), resolve(dir, 'public/events.txt')], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  assert.equal(py.stdout.trim(), expected);
});

test('bench-lease-lock: every plausible wrong reading gives a different answer', () => {
  for (const v of ['skip-holder', 'dedupe', 'eager']) assert.notEqual(simulate(parseLog(log), v), expected, v);
});

test('bench-lease-lock: public files do not contain the answer', () => {
  for (const f of ['SPEC.md', 'events.txt', 'brief.txt']) assert.ok(!readFileSync(resolve(dir, 'public', f), 'utf8').includes(expected), f);
});

test('bench-lease-lock: scoreTask outcome vocabulary', async () => {
  const d = mkdtempSync(join(tmpdir(), 'lease-score-'));
  try {
    writeFileSync(join(d, 'answer.txt'), expected + '\n');
    assert.equal((await scoreTask(dir, d)).reason, 'task_pass');
    writeFileSync(join(d, 'answer.txt'), simulate(parseLog(log), 'skip-holder'));
    assert.equal((await scoreTask(dir, d)).reason, 'task_fail');
    rmSync(join(d, 'answer.txt'));
    assert.equal((await scoreTask(dir, d)).reason, 'parse_failure');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
