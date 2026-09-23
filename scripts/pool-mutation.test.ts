/** Offline tests for the flag-only StrykerJS check of hidden tests (todo/mutation-check-hidden-tests.md):
 * node --import tsx scripts/pool-mutation.test.ts. Fixture pools are temporary; nothing is written into this repo. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hiddenRoot, loadHiddenItem, loadPool } from './pool-format.ts';
import { makeDryRunPool } from './pool-fixture.ts';
import { mutationCheckItem, nodeSatisfies, patchRanges, runGrouped, strykerInstall } from './pool-mutation.ts';
import { validateAll } from './pool.ts';

const fresh = () => realpathSync(mkdtempSync(join(tmpdir(), 'pool-mutation-')));
/** greet's hidden test only checks that greet exists, so it accepts a wrong greeting: the lax test the check exists to catch. */
const weakenGreet = (fx: ReturnType<typeof makeDryRunPool>) => writeFileSync(join(hiddenRoot('dry-run', fx.hiddenParent), 'greet', 'tests', 'test', 'greet.hidden.test.mjs'),
  "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport * as t from '../src/text.mjs';\n\ntest('greet', () => { assert.equal(typeof t.greet, 'function'); });\n");

test('patchRanges: added and changed lines of JS/TS source, merged when adjacent; tests, hidden tests and other files left out', () => {
  const patch = [
    'diff --git a/src/a.ts b/src/a.ts', 'index 1..2 100644', '--- a/src/a.ts', '+++ b/src/a.ts',
    '@@ -1,4 +1,5 @@', ' one', '-two', '+TWO', '+2b', ' three', '--- a removed line that looks like a header', '+++ an added line that looks like a header',
    '@@ -20,2 +21,2 @@', ' x', '-y', '+Y', '\\ No newline at end of file',
    'diff --git a/src/new.mjs b/src/new.mjs', 'new file mode 100644', '--- /dev/null', '+++ b/src/new.mjs', '@@ -0,0 +1,2 @@', '+export const a = 1;', '+export const b = 2;',
    'diff --git a/src/gone.js b/src/gone.js', 'deleted file mode 100644', '--- a/src/gone.js', '+++ /dev/null', '@@ -1 +0,0 @@', '-x',
    'diff --git a/README.md b/README.md', '--- a/README.md', '+++ b/README.md', '@@ -1 +1 @@', '-a', '+b',
    'diff --git a/src/a.test.ts b/src/a.test.ts', '--- a/src/a.test.ts', '+++ b/src/a.test.ts', '@@ -1 +1 @@', '-a', '+b',
    'diff --git a/test/hidden.mjs b/test/hidden.mjs', '--- a/test/hidden.mjs', '+++ b/test/hidden.mjs', '@@ -1 +1 @@', '-a', '+b', '',
  ].join('\n');
  const { ranges, skipped } = patchRanges(patch, ['test/hidden.mjs']);
  assert.deepEqual(ranges, [{ file: 'src/a.ts', start: 2, end: 3 }, { file: 'src/a.ts', start: 5, end: 5 }, { file: 'src/a.ts', start: 22, end: 22 }, { file: 'src/new.mjs', start: 1, end: 2 }]);
  assert.deepEqual(skipped, ['README.md', 'src/a.test.ts', 'test/hidden.mjs']);
});

test('the Node gate reads the engines range StrykerJS declares (10.0.0 needs Node >=22)', () => {
  const stryker = strykerInstall();
  assert.ok(stryker, '@stryker-mutator/core is a devDependency');
  assert.equal(stryker.engines, '>=22.0.0');
  assert.equal(nodeSatisfies(stryker.engines, process.versions.node), true, 'this repo runs on a Node StrykerJS accepts');
  assert.deepEqual(['20.19.0', '21.9.9', '22.0.0', 'v23.1.0'].map(v => nodeSatisfies('>=22.0.0', v)), [false, false, true, true]);
  assert.equal(nodeSatisfies('^22 || ^24', '20.0.0'), true, 'a range it cannot read is left to StrykerJS');
});

test('a weak hidden test is flagged with its surviving mutants; a strong one is not; neither changes validity', () => {
  const base = fresh(), prev = process.env.NODE_TEST_CONTEXT;
  process.env.NODE_TEST_CONTEXT = 'child-v8'; // an outer node --test must not make every mutant survive
  try {
    const fx = makeDryRunPool(base);
    weakenGreet(fx);
    const report = validateAll(fx.poolDir, { hiddenParent: fx.hiddenParent, scratch: join(base, 'scratch'), repeats: 1, mutation: {} });
    assert.equal(report.ok, true, 'surviving mutants never reject an item');
    const byId = Object.fromEntries(report.items.map(r => [r.id, r as typeof r & { mutation?: any }]));
    assert.equal(byId.greet.ok, true);
    assert.equal(byId.greet.mutation.flagged, true, JSON.stringify(byId.greet.mutation));
    assert.ok(byId.greet.mutation.survivors.some((s: any) => s.file === 'src/text.mjs' && s.line >= 4 && s.replacement !== undefined));
    assert.deepEqual(byId.greet.mutation.ranges, ['src/text.mjs:4-7']);
    assert.equal(byId.double.mutation.flagged, false, JSON.stringify(byId.double.mutation));
    assert.ok(byId.double.mutation.mutants > 0 && byId.double.mutation.killed === byId.double.mutation.mutants);
    assert.deepEqual(report.mutation?.flagged, ['greet']);
    assert.equal(spawnSync('git', ['-C', fx.repo, 'status', '--porcelain'], { encoding: 'utf8' }).stdout, '', 'the pool repo is untouched');
    assert.equal(spawnSync('git', ['-C', fx.repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).stdout.split('worktree ').length - 1, 1, 'no scratch worktree left behind');
  } finally {
    if (prev === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = prev;
    rmSync(base, { recursive: true, force: true });
  }
});

test('an item whose reference fix fails is not mutated, and an unsupported Node is reported instead of run', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base);
    writeFileSync(join(hiddenRoot('dry-run', fx.hiddenParent), 'greet', 'reference.patch'), '');
    const report = validateAll(fx.poolDir, { hiddenParent: fx.hiddenParent, scratch: join(base, 's'), repeats: 1, mutation: {} });
    const greet = report.items.find(r => r.id === 'greet') as any;
    assert.equal(greet.ok, false);
    assert.match(greet.mutation.skipped, /reference fix does not pass/);
    const { pool } = loadPool(fx.poolDir);
    const old = mutationCheckItem({ repo: pool.repo, baseCommit: pool.base_commit, item: loadHiddenItem(hiddenRoot('dry-run', fx.hiddenParent), 'double'), scratch: join(base, 's2'), nodeVersion: '20.11.1' });
    assert.match(old.error ?? '', /needs Node >=22\.0\.0; this is Node 20\.11\.1/);
    assert.equal(old.flagged, false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('runGrouped kills the whole process group at the deadline, background children included', () => {
  const marker = 'pool-mutation-test-' + randomBytes(6).toString('hex');
  const cwd = fresh();
  try {
    // Both node processes carry the unique marker in argv: one in the background, one in the foreground.
    const idle = `"$0" -e 'setInterval(()=>{},1000)' ${marker}`;
    const r = runGrouped(['/bin/sh', '-c', `${idle} & ${idle}`, process.execPath], cwd, 1500, process.env);
    assert.equal(r.timed_out, true);
    const left = spawnSync('ps', ['-Ao', 'command'], { encoding: 'utf8' }).stdout.split('\n').filter(l => l.includes(marker) && !l.includes('ps -Ao'));
    assert.deepEqual(left, []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('CLI: pool.ts validate --mutation prints a FLAG line for the weak item and exits 0', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base);
    weakenGreet(fx);
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/pool.ts', 'validate', '--pool', fx.poolDir, '--hidden', fx.hiddenParent, '--scratch', join(base, 's'), '--repeats', '1', '--mutation'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /ok {3}greet: .*FLAG: \d+ of \d+ mutants survived/);
    assert.match(r.stderr, /ok {3}double: .*mutation: \d+ mutants, none survived/);
    assert.deepEqual(JSON.parse(r.stdout).mutation.flagged, ['greet']);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
