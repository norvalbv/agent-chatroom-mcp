/** Offline tests for the pool format, manifest lock and validate (docs/experiments/2026-09-23-pool-throughput.md):
 * node --import tsx scripts/pool-format.test.ts */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hiddenRoot, loadHiddenItem, loadPool, lockPool, runCmd, validatePool, worktreeAt, removeWorktree } from './pool-format.ts';
import { makeDryRunPool } from './pool-fixture.ts';

const fresh = () => mkdtempSync(join(tmpdir(), 'pool-format-'));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const STOPPED_AT_THE_AWAIT = /step 1\nstopped\n$/;

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

test('runCmd does not inherit an outer node --test context: a failing hidden test still exits nonzero', () => {
  const base = fresh();
  const prev = process.env.NODE_TEST_CONTEXT;
  process.env.NODE_TEST_CONTEXT = 'child-v8';
  try {
    writeFileSync(join(base, 'fail.test.mjs'), "import { test } from 'node:test';\ntest('x', () => { throw new Error('boom'); });\n");
    assert.notEqual(runCmd('node --test fail.test.mjs', base).exit_code, 0);
  } finally {
    if (prev === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = prev;
    rmSync(base, { recursive: true, force: true });
  }
});

test('a hidden test that needs the repo\'s untracked node_modules passes validate: its worktrees link them', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base, { dependency: true });
    assert.ok(existsSync(join(fx.repo, 'node_modules', 'dry-dep')));
    const report = validatePool(fx.poolDir, { hiddenParent: fx.hiddenParent, scratch: join(base, 'scratch') });
    assert.deepEqual(report.items.map(r => [r.id, r.ok]), [['double', true], ['greet', true]], JSON.stringify(report.items.map(r => r.reference_tail)));
    const { pool } = loadPool(fx.poolDir);
    const plain = join(base, 'plain'), linked = join(base, 'linked');
    worktreeAt(pool.repo, pool.base_commit, plain);
    worktreeAt(pool.repo, pool.base_commit, linked, undefined, { linkNodeModules: true });
    assert.ok(!existsSync(join(plain, 'node_modules')));
    assert.ok(existsSync(join(linked, 'node_modules', 'dry-dep', 'index.js')));
    assert.equal(spawnSync('git', ['-C', linked, 'status', '--porcelain'], { encoding: 'utf8' }).stdout, '', 'the link is ignored, not a change');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('validate reruns each hidden test and rejects an item whose outcome flips between runs (flaky)', () => {
  const base = mkdtempSync(join(tmpdir(), 'pool-flaky-'));
  try {
    const fx = makeDryRunPool(base);
    const id = fx.pool.items[0].id;
    const cmdPath = join(fx.hiddenParent, 'dry-run', id, 'cmd');
    const original = readFileSync(cmdPath, 'utf8').trim();
    // every second run exits 1 regardless: always red at base, but green then red with the reference fix
    writeFileSync(cmdPath, `if [ -f .flip ]; then rm .flip; exit 1; fi; touch .flip; ${original}\n`);
    const report = validatePool(fx.poolDir, { hiddenParent: fx.hiddenParent, scratch: join(base, 'v'), repeats: 3 });
    const r = report.items.find((x: { id: string }) => x.id === id)!;
    assert.equal(r.flaky, true);
    assert.equal(r.ok, false, 'a flaky item is not valid');
    const other = report.items.find((x: { id: string }) => x.id !== id)!;
    assert.equal(other.ok, true, 'a stable item stays valid');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

/** A process that, resumed from `phase` of the event loop, runs a synchronous step (a spawnSync that lasts until `flag` exists),
 * awaits letSignalsIn, then prints "step 2". Its SIGINT listener prints "stopped" and exits 130, as validate's does. */
function stepper(phase: 'poll' | 'check' | 'timers', flag: string) {
  const lib = JSON.stringify(fileURLToPath(new URL('./pool-format.ts', import.meta.url)));
  const wait = "const f=process.argv[1],t0=Date.now();const t=setInterval(()=>{if(require('fs').existsSync(f)||Date.now()-t0>30000)clearInterval(t)},10)";
  const code = `import { spawnSync } from 'node:child_process'; import { readFile, writeSync } from 'node:fs'; import { letSignalsIn } from ${lib};
process.prependListener('SIGINT', () => { writeSync(1, 'stopped\\n'); process.exit(130); });
const phase = ${JSON.stringify(phase)};
if (phase === 'poll') await new Promise(r => readFile(${lib}, r)); // resumed from an fs callback, in the poll phase
else if (phase === 'check') await new Promise(r => setImmediate(r));
else await new Promise(r => setTimeout(r, 5));
writeSync(1, 'step 1\\n');
spawnSync(process.execPath, ['-e', ${JSON.stringify(wait)}, ${JSON.stringify(flag)}]);
await letSignalsIn();
writeSync(1, 'step 2\\n');`;
  // started from this checkout (as the CLI tests are), so --import tsx resolves
  const c = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  c.stderr.on('data', d => { err += d; });
  const guard = setTimeout(() => c.kill('SIGKILL'), 60_000); // this test's own child only
  const exited = new Promise<{ code: number | null; out: string; err: string }>(r => c.on('close', code => { clearTimeout(guard); r({ code, out, err }); }));
  const inStep = new Promise<void>(r => c.stdout.on('data', d => { out += d; if (out.includes('step 1')) r(); }));
  return { child: c, exited, inStep };
}

test('letSignalsIn: a SIGINT that came during a synchronous step ends the process before the next step, whichever loop phase awaited it', async () => {
  const base = fresh();
  try {
    // poll is the phase a single setImmediate fails from: it runs in the check phase of the same loop turn, before the next poll
    for (const phase of ['poll', 'check', 'timers'] as const) {
      const flag = join(base, `flag-${phase}`), s = stepper(phase, flag);
      await Promise.race([s.inStep, s.exited]);
      assert.ok(s.child.pid);
      process.kill(s.child.pid, 'SIGINT'); // this process alone: the synchronous step's own child goes on until the flag
      await sleep(300);
      writeFileSync(flag, '');
      const r = await s.exited;
      assert.equal(r.code, 130, `${phase}: ${r.out} ${r.err}`);
      assert.match(r.out, STOPPED_AT_THE_AWAIT, `${phase}: the listener ran at the await, and the next step never started`);
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
});
