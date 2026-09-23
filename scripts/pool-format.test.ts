/** Offline tests for the pool format, manifest lock and validate (docs/experiments/2026-09-23-pool-throughput.md):
 * node --import tsx scripts/pool-format.test.ts */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hiddenRoot, loadHiddenItem, loadPool, lockPool, validatePool, worktreeAt, removeWorktree } from './pool-format.ts';
import { makeDryRunPool } from './pool-fixture.ts';

const fresh = () => mkdtempSync(join(tmpdir(), 'pool-format-'));

test('the dry-run pool has two items, a three-way split and a lock that loadPool accepts', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base);
    const { pool, sha256 } = loadPool(fx.poolDir);
    assert.equal(pool.items.length, 2);
    assert.equal(pool.split.length, 3);
    assert.deepEqual(pool.split.flat().sort(), pool.items.map(i => i.id).sort());
    assert.match(sha256, /^[a-f0-9]{64}$/);
    assert.equal(readFileSync(join(fx.poolDir, 'pool.sha256'), 'utf8').trim(), sha256);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('an edited pool.json no longer matches its lock', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base);
    const path = join(fx.poolDir, 'pool.json');
    const pool = JSON.parse(readFileSync(path, 'utf8'));
    pool.deadline_min = 31;
    writeFileSync(path, JSON.stringify(pool, null, 2) + '\n');
    assert.throws(() => loadPool(fx.poolDir), /lock/);
    lockPool(fx.poolDir);
    assert.equal(loadPool(fx.poolDir).pool.deadline_min, 31);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('schema: duplicate ids, a split that is not a partition, or a missing field are refused', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base);
    const path = join(fx.poolDir, 'pool.json');
    const good = JSON.parse(readFileSync(path, 'utf8'));
    const bad = (mutate: (p: any) => void, re: RegExp) => {
      const p = structuredClone(good); mutate(p);
      writeFileSync(path, JSON.stringify(p)); lockPool(fx.poolDir);
      assert.throws(() => loadPool(fx.poolDir), re);
    };
    bad(p => { p.items[1].id = p.items[0].id; }, /duplicate/);
    bad(p => { p.split = [[p.items[0].id], [], []]; }, /split/);
    bad(p => { p.split = [[p.items[0].id], [p.items[0].id, p.items[1].id], []]; }, /split/);
    bad(p => { p.split = [[p.items[0].id, p.items[1].id]]; }, /split/);
    bad(p => { delete p.base_commit; }, /base_commit/);
    bad(p => { p.items[0].brief = ''; }, /brief/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('hidden root defaults to ~/.agent-chatroom-hidden/<pool> and lives outside the pool repo', () => {
  const prev = process.env.POOL_HIDDEN_ROOT;
  delete process.env.POOL_HIDDEN_ROOT;
  try {
    assert.equal(hiddenRoot('hub'), join(homedir(), '.agent-chatroom-hidden', 'hub'));
    assert.equal(hiddenRoot('hub', '/x'), join('/x', 'hub'));
  } finally { if (prev !== undefined) process.env.POOL_HIDDEN_ROOT = prev; }
  const base = fresh();
  try {
    const fx = makeDryRunPool(base);
    const item = loadHiddenItem(hiddenRoot('dry-run', fx.hiddenParent), 'double');
    assert.ok(item.cmd.length > 0);
    assert.ok(item.tests.length > 0);
    assert.ok(existsSync(item.patchPath));
    assert.ok(!resolve(item.dir).startsWith(resolve(fx.repo)), 'hidden side must not be inside the repo');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('worktreeAt checks out base_commit on a named branch without touching the main checkout', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base);
    const { pool } = loadPool(fx.poolDir);
    const wt = join(base, 'wt');
    worktreeAt(pool.repo, pool.base_commit, wt, 'pool/test/solo');
    const head = spawnSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    assert.equal(head, pool.base_commit);
    assert.equal(spawnSync('git', ['-C', wt, 'branch', '--show-current'], { encoding: 'utf8' }).stdout.trim(), 'pool/test/solo');
    assert.equal(spawnSync('git', ['-C', pool.repo, 'status', '--porcelain'], { encoding: 'utf8' }).stdout, '');
    removeWorktree(pool.repo, wt);
    assert.ok(!existsSync(wt));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('validate: every dry-run item fails at base and passes with its reference patch', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base);
    const report = validatePool(fx.poolDir, { hiddenParent: fx.hiddenParent, scratch: join(base, 'scratch') });
    assert.deepEqual(report.items.map(r => r.id), ['double', 'greet']);
    for (const r of report.items) {
      assert.equal(r.fails_at_base, true, r.id);
      assert.equal(r.passes_with_reference, true, r.id);
      assert.equal(r.ok, true, r.id);
    }
    assert.equal(report.ok, true);
    assert.equal(spawnSync('git', ['-C', fx.repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).stdout.split('worktree ').length - 1, 1, 'validate removes its worktrees');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('validate reports per item: a test that already passes at base, or a patch that does not fix it, is not ok', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base);
    const hidden = hiddenRoot('dry-run', fx.hiddenParent);
    writeFileSync(join(hidden, 'double', 'cmd'), 'true\n');
    writeFileSync(join(hidden, 'greet', 'reference.patch'), '');
    const report = validatePool(fx.poolDir, { hiddenParent: fx.hiddenParent, scratch: join(base, 'scratch') });
    const byId = Object.fromEntries(report.items.map(r => [r.id, r]));
    assert.equal(byId.double.fails_at_base, false);
    assert.equal(byId.double.ok, false);
    assert.equal(byId.greet.fails_at_base, true);
    assert.equal(byId.greet.passes_with_reference, false);
    assert.equal(byId.greet.ok, false);
    assert.equal(report.ok, false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('validate refuses a hidden test file name that already occurs in the repo: the leakage audit would void every run on it', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base);
    const hidden = hiddenRoot('dry-run', fx.hiddenParent);
    // Rename double's hidden test to a name the repo already has at base.
    rmSync(join(hidden, 'double', 'tests'), { recursive: true });
    const dest = join(hidden, 'double', 'tests', 'test', 'hidden', 'base.test.mjs');
    spawnSync('mkdir', ['-p', join(dest, '..')]);
    writeFileSync(dest, "import assert from 'node:assert/strict';\nimport * as m from '../../src/math.mjs';\nassert.equal(m.double?.(2), 4);\n");
    writeFileSync(join(hidden, 'double', 'cmd'), 'node test/hidden/base.test.mjs\n');
    const report = validatePool(fx.poolDir, { hiddenParent: fx.hiddenParent, scratch: join(base, 'scratch') });
    const double = report.items.find(r => r.id === 'double')!;
    assert.equal(double.fails_at_base, true);
    assert.equal(double.passes_with_reference, true);
    assert.deepEqual(double.names_in_repo, ['base.test.mjs']);
    assert.equal(double.ok, false);
    assert.equal(report.items.find(r => r.id === 'greet')!.ok, true);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('validate refuses a pool item with no hidden side', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base);
    rmSync(join(hiddenRoot('dry-run', fx.hiddenParent), 'greet'), { recursive: true });
    const report = validatePool(fx.poolDir, { hiddenParent: fx.hiddenParent, scratch: join(base, 'scratch') });
    const greet = report.items.find(r => r.id === 'greet')!;
    assert.equal(greet.ok, false);
    assert.match(greet.error ?? '', /hidden/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('CLI: pool.ts validate prints the per-item report and exits nonzero when an item is not ok', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base);
    const cli = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/pool.ts', ...args], { encoding: 'utf8' });
    const ok = cli('validate', '--pool', fx.poolDir, '--hidden', fx.hiddenParent, '--scratch', join(base, 's1'));
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).items.length, 2);
    writeFileSync(join(hiddenRoot('dry-run', fx.hiddenParent), 'double', 'cmd'), 'true\n');
    const bad = cli('validate', '--pool', fx.poolDir, '--hidden', fx.hiddenParent, '--scratch', join(base, 's2'));
    assert.equal(bad.status, 1);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
