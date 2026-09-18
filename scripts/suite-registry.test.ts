/** tasks/SUITE.json is the one machine-readable record of every task's status. It must list every tasks/ directory, agree with the
 * raised bar (paper/amendments.md), point at a real admission record, and bench-grid must refuse tasks that are not primary or weak.
 * Run: node --import tsx --test scripts/suite-registry.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from './bench-grid.js';
type Entry = { id: string; status: string; family: string; arm_a: { pass: number; n: number } | null; admission: string; note?: string };
const suite = JSON.parse(readFileSync('tasks/SUITE.json', 'utf8')) as { tasks: Entry[] };
const dirs = readdirSync('tasks').filter((n) => statSync(join('tasks', n)).isDirectory());

test('SUITE.json lists exactly the task directories, once each', () => {
  const ids = suite.tasks.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate id');
  assert.deepEqual([...ids].sort(), [...dirs].sort());
});
test('every entry has a family and an admission record that exists', () => {
  for (const t of suite.tasks) {
    assert.ok(t.family && t.family.length > 0, `${t.id}: family`);
    if (t.status !== 'pending') assert.ok(existsSync(t.admission), `${t.id}: ${t.admission} missing`);
  }
});
test('statuses agree with the raised bar: primary 0.3-0.7, weak above 0.7 to 0.9, retired above 0.9 or 0, all on at least 10 seeds for primary and weak', () => {
  for (const t of suite.tasks) {
    assert.ok(['primary', 'weak', 'retired', 'pending'].includes(t.status), `${t.id}: status ${t.status}`);
    if (t.status === 'pending') { assert.equal(t.arm_a, null, `${t.id}: pending has no rate yet`); continue; }
    if (t.arm_a === null) { assert.equal(t.status, 'retired', `${t.id}: only a retired task may lack a rate`); continue; }
    const rate = t.arm_a.pass / t.arm_a.n;
    if (t.status === 'primary') { assert.ok(t.arm_a.n >= 10 && rate >= 0.3 && rate <= 0.7, `${t.id}: primary needs n>=10 and 0.3-0.7`); }
    else if (t.status === 'weak') { assert.ok(t.arm_a.n >= 10 && rate > 0.7 && rate <= 0.9, `${t.id}: weak needs n>=10 and (0.7, 0.9]`); }
    else assert.ok(rate > 0.9 || rate === 0, `${t.id}: retired needs a rate above 0.9 or 0`);
  }
});
test("each admission record carries the entry's arm A count, and weak or retired ones say so", () => {
  for (const t of suite.tasks) {
    if (t.admission === 'paper/amendments.md' || t.status === 'pending' || t.arm_a === null) continue;
    const text = readFileSync(t.admission, 'utf8');
    const { pass, n } = t.arm_a;
    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    const pattern = new RegExp(`\\b${pass} (of|/|out of) ?${n}\\b|\\b${pass}/${n}\\b|\\b(${n}|${words[n] ?? n}) seeds?,? ${pass} pass`, 'i');
    assert.ok(pattern.test(text), `${t.id}: ${t.admission} does not state ${pass} of ${n}`);
    if (t.status === 'weak') assert.match(text, /weak/i, `${t.id}: record does not say weak`);
    if (t.status === 'retired') assert.match(text, /reject|retired|ceiling/i, `${t.id}: record does not say retired`);
  }
});
test('bench-grid refuses retired and pending tasks and unlisted ones, allows primary and weak, and --include-retired overrides', () => {
  const dir = mkdtempSync(join(tmpdir(), 'suite-registry-'));
  try {
    for (const n of ['p', 'w', 'r', 'x', 'u']) mkdirSync(join(dir, n));
    writeFileSync(join(dir, 'SUITE.json'), JSON.stringify({ tasks: [{ id: 'p', status: 'primary' }, { id: 'w', status: 'weak' }, { id: 'r', status: 'retired' }, { id: 'x', status: 'pending' }] }));
    const run = (tasks: string, ...extra: string[]) => parseArgs(['--tasks', tasks, '--seeds', '1', '--tasks-dir', dir, ...extra]);
    assert.equal(run('p,w').taskDirs.length, 2);
    assert.throws(() => run('r'), /retired.*refusing/);
    assert.throws(() => run('x'), /pending.*refusing/);
    assert.throws(() => run('p,u'), /not listed/);
    assert.equal(run('r,x,u', '--include-retired').taskDirs.length, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('the real suite: primary tasks parse, a retired one is refused', () => {
  const primaries = suite.tasks.filter((t) => t.status === 'primary').map((t) => t.id);
  assert.ok(primaries.length >= 1);
  assert.equal(parseArgs(['--tasks', primaries.join(','), '--seeds', '1-3']).taskDirs.length, primaries.length);
  assert.throws(() => parseArgs(['--tasks', 'bench-long-brief', '--seeds', '1']), /refusing/);
});
