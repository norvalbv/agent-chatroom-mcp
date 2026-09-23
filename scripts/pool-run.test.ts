/** Offline tests for `pool run` (docs/experiments/2026-09-23-pool-throughput.md): briefs, worktrees, fake seats,
 * the deadline, usage and the account record. No model calls: a stub `claude` stands in for every seat.
 * node --import tsx scripts/pool-run.test.ts */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadPool } from './pool-format.ts';
import { makeDryRunPool } from './pool-fixture.ts';
import { ROOM_BRIEF_LINE, briefFor, projectSlug, runArm } from './pool-run.ts';

const fresh = () => realpathSync(mkdtempSync(join(tmpdir(), 'pool-run-')));
const git = (cwd: string, ...args: string[]) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).stdout.trim();
const setup = () => {
  const base = fresh();
  const fx = makeDryRunPool(base);
  const solutions = join(base, 'solutions.json');
  writeFileSync(solutions, JSON.stringify(fx.solutions));
  const switchLog = join(base, 'switcher.log');
  writeFileSync(switchLog, '2026-09-01 10:00:00,000 - INFO - Switched from account 1 to 3\n');
  return { base, fx, solutions, switchLog, scratch: join(base, 'scratch'), claudeHome: join(base, 'claude-home') };
};

test('briefs: solo gets all items, split its third, rooms the organise line; all state the deadline and one commit per item', () => {
  const { base, fx } = setup();
  try {
    const { pool } = loadPool(fx.poolDir);
    const ids = pool.items.map(i => i.id);
    const solo = briefFor(pool, 'solo', { integrationBranch: 'x' });
    for (const item of pool.items) { assert.ok(solo.includes(`[${item.id}]`)); assert.ok(solo.includes(item.brief)); }
    for (let k = 0; k < 3; k++) {
      const b = briefFor(pool, 'split', { seatIndex: k, integrationBranch: 'x' });
      for (const id of ids) assert.equal(b.includes(`[${id}]`), pool.split[k].includes(id), `split ${k} ${id}`);
    }
    const room = briefFor(pool, 'room3', { integrationBranch: 'pool/dry-run/room3-rep1/integration' });
    assert.ok(room.includes(ROOM_BRIEF_LINE));
    assert.ok(room.includes('pool/dry-run/room3-rep1/integration'));
    for (const b of [solo, room, briefFor(pool, 'split', { seatIndex: 0, integrationBranch: 'x' })]) {
      assert.match(b, new RegExp(`${pool.deadline_min} minutes`));
      assert.match(b, /one commit per item/i);
      assert.match(b, /item id in the commit message/i);
      assert.ok(!b.includes('reference.patch'));
      assert.ok(!b.includes('agent-chatroom-hidden'));
      assert.ok(!b.includes(fx.hiddenParent));
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('projectSlug matches Claude Code project directory names', () => {
  assert.equal(projectSlug('/Users/a b/x.y/.swarm-worktrees/s-1'), '-Users-a-b-x-y--swarm-worktrees-s-1');
});

test('scratch root inside the pool repo or this repo is refused', async () => {
  const { base, fx, solutions } = setup();
  try {
    await assert.rejects(runArm({ poolDir: fx.poolDir, arm: 'solo', rep: 1, scratch: join(fx.repo, 'runs'), fake: { solutions } }), /outside/);
    await assert.rejects(runArm({ poolDir: fx.poolDir, arm: 'solo', rep: 1, scratch: resolve('runs-inside'), fake: { solutions } }), /outside/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('solo, fake seat: fresh worktree at base, one commit per item, run.json with usage, account and transcript', async () => {
  const { base, fx, solutions, switchLog, scratch, claudeHome } = setup();
  const prevHidden = process.env.POOL_HIDDEN_ROOT;
  process.env.POOL_HIDDEN_ROOT = fx.hiddenParent;
  try {
    const { pool } = loadPool(fx.poolDir);
    const runDir = await runArm({ poolDir: fx.poolDir, arm: 'solo', rep: 1, scratch, fake: { solutions }, switchLog, claudeConfigDir: claudeHome });
    assert.equal(runDir, join(scratch, 'dry-run', 'solo-rep1'));
    const run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
    assert.equal(run.arm, 'solo'); assert.equal(run.rep, 1); assert.equal(run.fake, true);
    assert.equal(run.base_commit, pool.base_commit);
    assert.match(run.pool_sha256, /^[a-f0-9]{64}$/);
    assert.equal(run.account.account, 3);
    assert.equal(run.seats.length, 1);
    const seat = run.seats[0];
    assert.equal(seat.name, 'solo');
    assert.equal(seat.branch, 'pool/dry-run/solo-rep1/solo');
    assert.equal(seat.worktree, join(runDir, 'wt', 'solo'));
    assert.equal(seat.killed_by_deadline, false);
    assert.equal(seat.cost_estimated, false);
    assert.equal(typeof seat.cost_usd, 'number');
    assert.ok(existsSync(seat.transcript));
    assert.ok(readFileSync(join(runDir, 'briefs', 'solo.txt'), 'utf8').includes('[double]'));
    // one commit per item on the seat branch, above base, with the item id in the message
    const log = git(fx.repo, 'log', '--format=%s', `${pool.base_commit}..${seat.branch}`).split('\n');
    assert.deepEqual(log.map(s => s.split(':')[0]).sort(), ['double', 'greet']);
    // the seat never saw the hidden root: not in its brief, not in its environment
    assert.ok(!readFileSync(seat.transcript, 'utf8').includes(fx.hiddenParent));
    assert.equal(git(fx.repo, 'status', '--porcelain'), '');
  } finally {
    if (prevHidden === undefined) delete process.env.POOL_HIDDEN_ROOT; else process.env.POOL_HIDDEN_ROOT = prevHidden;
    rmSync(base, { recursive: true, force: true });
  }
});

test('split, fake seats: three worktrees, each seat commits only its third', async () => {
  const { base, fx, solutions, scratch, claudeHome } = setup();
  try {
    const { pool } = loadPool(fx.poolDir);
    const runDir = await runArm({ poolDir: fx.poolDir, arm: 'split', rep: 2, scratch, fake: { solutions }, claudeConfigDir: claudeHome });
    const run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
    assert.deepEqual(run.seats.map((s: any) => s.name), ['split-1', 'split-2', 'split-3']);
    assert.equal(run.account.account, null);
    assert.match(run.account.reason, /switch log/);
    run.seats.forEach((s: any, k: number) => {
      const subjects = git(fx.repo, 'log', '--format=%s', `${pool.base_commit}..${s.branch}`);
      const got = subjects ? subjects.split('\n').map(x => x.split(':')[0]).sort() : [];
      assert.deepEqual(got, [...pool.split[k]].sort(), s.name);
    });
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('a seat still working at the deadline is stopped and its cost is marked an estimate', async () => {
  const { base, fx, solutions, scratch, claudeHome } = setup();
  try {
    const t0 = Date.now();
    const runDir = await runArm({ poolDir: fx.poolDir, arm: 'solo', rep: 3, scratch, fake: { solutions, mode: 'hang' }, deadlineMs: 1500, claudeConfigDir: claudeHome });
    assert.ok(Date.now() - t0 < 15_000);
    const run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
    assert.equal(run.deadline_override_ms, 1500);
    const seat = run.seats[0];
    assert.equal(seat.killed_by_deadline, true);
    assert.equal(seat.cost_estimated, true);
    assert.ok(seat.partial_usage && seat.partial_usage.output_tokens > 0);
    assert.ok(seat.cost_usd === null ? typeof seat.cost_estimate_reason === 'string' : seat.cost_usd > 0);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('claude session transcripts whose cwd is under the run dir are copied into the run for the audit', async () => {
  const { base, fx, solutions, scratch, claudeHome } = setup();
  try {
    const runDir = await runArm({ poolDir: fx.poolDir, arm: 'solo', rep: 4, scratch, fake: { solutions, session: true }, claudeConfigDir: claudeHome });
    const sessions = join(runDir, 'seats', 'solo', 'sessions');
    assert.ok(existsSync(sessions));
    assert.ok(readdirSync(sessions).some(f => f.endsWith('.jsonl')));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

const dist = resolve('dist', 'swarm.js');
test('room3, fake seats through dist/swarm.js on a private hub: worker branches and the declared integration branch are recorded', { skip: !existsSync(dist) && 'dist/swarm.js not built' }, async () => {
  const { base, fx, solutions, scratch, claudeHome } = setup();
  try {
    const before = existsSync(resolve('swarms')) ? readdirSync(resolve('swarms')).length : 0;
    const runDir = await runArm({ poolDir: fx.poolDir, arm: 'room3', rep: 1, scratch, fake: { solutions, integrate: true }, deadlineMs: 60_000, claudeConfigDir: claudeHome });
    const run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
    assert.equal(run.room.integration_branch, 'pool/dry-run/room3-rep1/integration');
    assert.equal(run.room.declared_branch, 'pool/dry-run/room3-rep1/integration');
    assert.equal(run.room.worker_branches.length, 3);
    assert.ok(run.room.argv.includes('--no-carry') && run.room.argv.includes('--require-verification') && run.room.argv.includes('--full-access'));
    assert.equal(run.room.argv[run.room.argv.indexOf('--agents') + 1], '4');
    assert.ok(existsSync(join(runDir, 'room', 'data')));
    assert.ok(existsSync(join(runDir, 'room', 'swarm', 'report.md')));
    // every seat swarm launched gets a row; a seat that exited cleanly carries its actual cost from swarm's usage sidecar
    assert.deepEqual(run.seats.map((s: any) => s.name).sort(), ['claude-opus-5-5-1', 'claude-opus-5-5-2', 'claude-opus-5-5-3', 'verifier']);
    for (const s of run.seats) { assert.equal(s.cost_estimated, false, s.name); assert.equal(s.cost_usd, 0.001, s.name); }
    // the swarm report is moved out of this checkout's swarms/
    assert.equal(existsSync(resolve('swarms')) ? readdirSync(resolve('swarms')).length : 0, before);
    // the hub is gone
    const port = run.room.port;
    assert.equal(spawnSync('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout.trim(), '');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('room3, fake seats that never finish: every seat process is gone once run returns at the deadline', { skip: !existsSync(dist) && 'dist/swarm.js not built' }, async () => {
  const { base, fx, solutions, scratch, claudeHome } = setup();
  try {
    const t0 = Date.now();
    const runDir = await runArm({ poolDir: fx.poolDir, arm: 'room3', rep: 2, scratch, fake: { solutions, mode: 'hang', session: true }, deadlineMs: 5000, claudeConfigDir: claudeHome });
    assert.ok(Date.now() - t0 < 90_000);
    const left = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout.split('\n').filter(l => l.includes(join(runDir, 'fake-bin')) || l.includes(runDir + '/'));
    assert.deepEqual(left, []);
    const run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
    assert.equal(run.room.declared_branch, null);
    // killed seats: no sidecar, so each is estimated from its own session (the verifier's is the one in the room worktree)
    assert.deepEqual(run.seats.map((s: any) => s.name).sort(), ['claude-opus-5-5-1', 'claude-opus-5-5-2', 'claude-opus-5-5-3', 'verifier']);
    for (const s of run.seats) { assert.equal(s.cost_estimated, true, s.name); assert.equal(s.sessions.length, 1, s.name); }
    assert.equal(spawnSync('lsof', ['-ti', `:${run.room.port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout.trim(), '');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('dry run end to end through the CLI: run (fake solo) → finalize → score → audit, both items pass and the run is clean', async () => {
  const { base, fx, solutions, scratch } = setup();
  try {
    const cli = (...a: string[]) => spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts', 'pool.ts'), ...a], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: join(base, 'claude-home') } });
    const r = cli('run', '--pool', fx.poolDir, '--arm', 'solo', '--rep', '1', '--scratch', scratch, '--fake-solutions', solutions);
    assert.equal(r.status, 0, r.stderr);
    const runDir = r.stdout.trim().split('\n').pop()!;
    for (const step of ['finalize', 'score', 'audit']) { const s = cli(step, '--run', runDir, '--hidden', fx.hiddenParent); assert.equal(s.status, 0, step + ': ' + s.stderr + s.stdout); }
    const score = JSON.parse(readFileSync(join(runDir, 'score.json'), 'utf8'));
    assert.deepEqual(Object.fromEntries(score.items.map((i: any) => [i.id, i.pass])), { double: true, greet: true });
    assert.equal(JSON.parse(readFileSync(join(runDir, 'audit.json'), 'utf8')).void, false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
