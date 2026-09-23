/** Offline tests for finalize, score and the leakage audit (docs/experiments/2026-09-23-pool-throughput.md):
 * node --import tsx scripts/pool-score.test.ts
 * Run dirs are hand-built the way pool-run lays them out (board 'layout'), so these tests need no seats. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { hiddenRoot, loadPool, lockPool, worktreeAt } from './pool-format.ts';
import { makeDryRunPool } from './pool-fixture.ts';
import { auditRun, finalizeRun, scoreRun } from './pool-score.ts';

const fresh = () => mkdtempSync(join(tmpdir(), 'pool-score-'));
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();

type Fx = ReturnType<typeof makeDryRunPool>;
/** A seat worktree at base_commit on `branch`, with `commits` applied as [message, {path: content}] in order. */
function seat(fx: Fx, runDir: string, name: string, branch: string, commits: [string, Record<string, string>][], transcript = '{"type":"assistant"}\n') {
  const { pool } = loadPool(fx.poolDir);
  const wt = join(runDir, 'wt', name);
  worktreeAt(pool.repo, pool.base_commit, wt, branch);
  for (const [message, files] of commits) {
    for (const [path, content] of Object.entries(files)) { mkdirSync(dirname(join(wt, path)), { recursive: true }); writeFileSync(join(wt, path), content); }
    git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', message);
  }
  mkdirSync(join(runDir, 'seats', name), { recursive: true });
  writeFileSync(join(runDir, 'seats', name, 'transcript.jsonl'), transcript);
  return { name, branch, worktree: wt, transcript: join(runDir, 'seats', name, 'transcript.jsonl'), usage: null, cost_usd: 0.5, cost_estimated: false, killed_by_deadline: false };
}
const fix = (fx: Fx, id: string) => ({ [fx.solutions[id].path]: fx.solutions[id].content });
function runJson(fx: Fx, runDir: string, arm: string, seats: any[], room?: any) {
  const { pool, sha256 } = loadPool(fx.poolDir);
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ pool: pool.name, pool_dir: fx.poolDir, pool_sha256: sha256, arm, rep: 1, repo: pool.repo, base_commit: pool.base_commit, deadline_min: pool.deadline_min, seats, room, fake: true }, null, 2));
}
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

test('solo: final head is the seat branch; score passes fixed items and records attempts, suite and cost', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base), R = join(base, 'run'); mkdirSync(R);
    runJson(fx, R, 'solo', [seat(fx, R, 'solo', 'pool/dry-run/solo-rep1/solo', [['double: fix doubling', fix(fx, 'double')]])]);
    const final = finalizeRun(R);
    assert.equal(final.source, 'branch');
    assert.equal(final.head, git(fx.repo, 'rev-parse', 'pool/dry-run/solo-rep1/solo'));
    assert.deepEqual(read(join(R, 'final.json')).head, final.head);
    const score = scoreRun(R, { hiddenParent: fx.hiddenParent });
    const byId = Object.fromEntries(score.items.map((i: any) => [i.id, i]));
    assert.equal(byId.double.pass, true);
    assert.equal(byId.greet.pass, false);
    assert.equal(byId.double.attempted, true);
    assert.equal(byId.greet.attempted, false);
    assert.equal(score.passed, 1);
    assert.equal(score.suite.pass, true);
    assert.equal(score.cost_usd, 0.5);
    assert.equal(score.void, false);
    assert.deepEqual(read(join(R, 'score.json')).passed, 1);
    // the scorer cleans up: no worktree left holding hidden tests, and nothing written into the pool repo's checkout
    assert.equal(git(fx.repo, 'worktree', 'list', '--porcelain').split('worktree ').length - 1, 2, 'only the main checkout and the seat worktree remain');
    assert.equal(git(fx.repo, 'status', '--porcelain'), '');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('split: branches merge in fixed order; a conflict keeps the earlier branch and is recorded', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base), R = join(base, 'run'); mkdirSync(R);
    const p = 'pool/dry-run/split-rep1/';
    // split-2 is listed first in run.json: the order must come from the seat names, not the array
    const s2 = seat(fx, R, 'split-2', p + 'split-2', [['greet: fix', { ...fix(fx, 'greet'), 'NOTES.md': 'from two\n' }]]);
    const s1 = seat(fx, R, 'split-1', p + 'split-1', [['double: fix', { ...fix(fx, 'double'), 'NOTES.md': 'from one\n' }]]);
    const s3 = seat(fx, R, 'split-3', p + 'split-3', []);
    const s10 = { ...seat(fx, R, 'split-10', p + 'split-10', []), branch: null }; // numeric order; a seat with no branch is skipped
    runJson(fx, R, 'split', [s2, s10, s1, s3]);
    const final = finalizeRun(R);
    assert.equal(final.source, 'merge');
    assert.deepEqual(final.order, [p + 'split-1', p + 'split-2', p + 'split-3']);
    assert.deepEqual(final.conflicts, [{ branch: p + 'split-2', files: ['NOTES.md'] }]);
    assert.equal(git(fx.repo, 'show', final.head + ':NOTES.md'), 'from one');
    const score = scoreRun(R, { hiddenParent: fx.hiddenParent });
    assert.equal(score.passed, 2, 'the non-conflicting greet fix from the later branch survives');
    assert.equal(score.conflicts, 1);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('rooms: the declared integration branch wins; without one the worker branches merge like split', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base);
    const R1 = join(base, 'r1'); mkdirSync(R1);
    const w1 = seat(fx, R1, 'w1', 'swarm/x1/claude-1', [['double: fix', fix(fx, 'double')]]);
    const integ = seat(fx, R1, 'integ', 'pool/dry-run/room3-rep1/integration', [['double: fix', fix(fx, 'double')], ['greet: fix', fix(fx, 'greet')]]);
    runJson(fx, R1, 'room3', [], { integration_branch: integ.branch, worker_branches: [w1.branch], data_dir: join(R1, 'room', 'data') });
    const f1 = finalizeRun(R1);
    assert.equal(f1.source, 'integration');
    assert.equal(f1.head, git(fx.repo, 'rev-parse', integ.branch));

    const R2 = join(base, 'r2'); mkdirSync(R2);
    const a = seat(fx, R2, 'a', 'swarm/x2/claude-b', [['greet: fix', fix(fx, 'greet')]]);
    const b = seat(fx, R2, 'b', 'swarm/x2/claude-a', [['double: fix', fix(fx, 'double')]]);
    const c = seat(fx, R2, 'c', 'swarm/x2/claude-a10', []);
    runJson(fx, R2, 'room3', [], { integration_branch: 'pool/dry-run/room3-rep2/integration', declared_branch: null, worker_branches: [c.branch, a.branch, b.branch], data_dir: join(R2, 'room', 'data'),
      swarm_usage: { cost_usd: 1.25, coverage: 'partial' } });
    const f2 = finalizeRun(R2);
    assert.equal(f2.source, 'merge');
    assert.deepEqual(f2.order, ['swarm/x2/claude-a', 'swarm/x2/claude-a10', 'swarm/x2/claude-b']);
    const s2 = scoreRun(R2, { hiddenParent: fx.hiddenParent });
    assert.equal(s2.passed, 2);
    // a room's seats are the swarm's: its cost comes from the swarm's usage rollup, estimated unless coverage is complete
    assert.equal(s2.cost_usd, 1.25);
    assert.equal(s2.cost_estimated, true);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('score never copies reference.patch and runs the suite without the hidden tests present', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base), R = join(base, 'run'); mkdirSync(R);
    runJson(fx, R, 'solo', [seat(fx, R, 'solo', 'pool/dry-run/solo-rep1/solo', [])]);
    finalizeRun(R);
    const score = scoreRun(R, { hiddenParent: fx.hiddenParent });
    assert.equal(score.passed, 0);
    assert.equal(score.suite.pass, true, 'failing hidden tests must not leak into the project suite run');
    const found = spawnSync('find', [base, '-name', 'reference.patch', '-not', '-path', fx.hiddenParent + '/*'], { encoding: 'utf8' }).stdout.trim();
    assert.equal(found, '');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('audit: a transcript naming the hidden root or a hidden test file voids the run; a clean one does not', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base);
    const hidden = hiddenRoot('dry-run', fx.hiddenParent);
    const testName = readFileSync(join(hidden, 'double', 'cmd'), 'utf8').trim().split(/\s+/).pop()!.split('/').pop()!;
    const cases: [string, string, boolean][] = [
      ['clean', '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"npm test"}}]}}\n', false],
      ['path', `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"ls ${hidden}"}}]}}\n`, true],
      ['name', `{"type":"user","message":{"content":[{"type":"tool_result","content":"found ${testName}"}]}}\n`, true],
    ];
    for (const [label, transcript, voided] of cases) {
      const R = join(base, label); mkdirSync(R);
      runJson(fx, R, 'solo', [seat(fx, R, 'solo', `pool/dry-run/${label}/solo`, [], transcript)]);
      const audit = auditRun(R, { hiddenParent: fx.hiddenParent });
      assert.equal(audit.void, voided, label);
      if (voided) assert.ok(audit.hits.length > 0 && audit.hits.every((h: any) => h.file.startsWith(R)), label);
      assert.equal(read(join(R, 'audit.json')).void, voided);
      finalizeRun(R);
      assert.equal(scoreRun(R, { hiddenParent: fx.hiddenParent }).void, voided, label + ': score carries the audit verdict');
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('audit scans room logs too: a hit anywhere under room/ voids a room run', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base), R = join(base, 'run'); mkdirSync(R);
    const hidden = hiddenRoot('dry-run', fx.hiddenParent);
    mkdirSync(join(R, 'room', 'spawned'), { recursive: true });
    writeFileSync(join(R, 'room', 'spawned', 'claude-3.log'), `cat ${join(hidden, 'greet', 'reference.patch')}\n`);
    runJson(fx, R, 'room3', [], { integration_branch: 'none', worker_branches: [], data_dir: join(R, 'room', 'data') });
    assert.equal(auditRun(R, { hiddenParent: fx.hiddenParent }).void, true);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('CLI: pool.ts finalize, score and audit write their json and print it', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base), R = join(base, 'run'); mkdirSync(R);
    runJson(fx, R, 'solo', [seat(fx, R, 'solo', 'pool/dry-run/solo-rep1/solo', [['double: fix', fix(fx, 'double')], ['greet: fix', fix(fx, 'greet')]])]);
    const cli = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/pool.ts', ...args], { encoding: 'utf8' });
    const f = cli('finalize', '--run', R); assert.equal(f.status, 0, f.stderr);
    const a = cli('audit', '--run', R, '--hidden', fx.hiddenParent); assert.equal(a.status, 0, a.stderr);
    assert.equal(JSON.parse(a.stdout).void, false);
    const s = cli('score', '--run', R, '--hidden', fx.hiddenParent); assert.equal(s.status, 0, s.stderr);
    assert.equal(JSON.parse(s.stdout).passed, 2);
    assert.ok(existsSync(join(R, 'score.json')));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('score is not fooled by an outer node --test context: unfixed items still fail', () => {
  const base = fresh(), prev = process.env.NODE_TEST_CONTEXT;
  process.env.NODE_TEST_CONTEXT = 'child-v8'; // what a node --test parent hands its children; a child `node --test` then exits 0 on failure
  try {
    const fx = makeDryRunPool(base), R = join(base, 'run'); mkdirSync(R);
    runJson(fx, R, 'solo', [seat(fx, R, 'solo', 'pool/dry-run/solo-rep1/solo', [])]);
    finalizeRun(R);
    assert.equal(scoreRun(R, { hiddenParent: fx.hiddenParent }).passed, 0);
  } finally {
    if (prev === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = prev;
    rmSync(base, { recursive: true, force: true });
  }
});

test('audit scans the briefs builders saw: a brief naming the hidden root voids the run', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base), R = join(base, 'run'); mkdirSync(R);
    mkdirSync(join(R, 'briefs'));
    writeFileSync(join(R, 'briefs', 'solo.txt'), `Build the items. Tests are in ${hiddenRoot('dry-run', fx.hiddenParent)}.\n`);
    runJson(fx, R, 'solo', [seat(fx, R, 'solo', 'pool/dry-run/solo-rep1/solo', [])]);
    const audit = auditRun(R, { hiddenParent: fx.hiddenParent });
    assert.equal(audit.void, true);
    assert.ok(audit.hits.some((h: any) => h.file.includes('/briefs/')));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('score links the pool repo\'s node_modules into its checkouts, so a hidden test or the suite can load dependencies', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base), R = join(base, 'run'); mkdirSync(R);
    // an installed, gitignored dependency in the pool's main checkout, as for this hub's tsx/typescript
    writeFileSync(join(fx.repo, '.git', 'info', 'exclude'), 'node_modules\n');
    mkdirSync(join(fx.repo, 'node_modules', 'fakedep'), { recursive: true });
    writeFileSync(join(fx.repo, 'node_modules', 'fakedep', 'index.js'), 'module.exports = 1;\n');
    const need = `node -e "require('fakedep')"`;
    writeFileSync(join(hiddenRoot('dry-run', fx.hiddenParent), 'greet', 'cmd'), `${need} && node --test test/greet.hidden.test.mjs\n`);
    const poolPath = join(fx.poolDir, 'pool.json'), p = read(poolPath);
    p.suite_cmd = `${need} && npm test`; writeFileSync(poolPath, JSON.stringify(p, null, 2) + '\n'); lockPool(fx.poolDir);
    runJson(fx, R, 'solo', [seat(fx, R, 'solo', 'pool/dry-run/solo-rep1/solo', [['greet: fix', fix(fx, 'greet')]])]);
    finalizeRun(R);
    const score = scoreRun(R, { hiddenParent: fx.hiddenParent });
    assert.equal(score.suite.pass, true, score.suite.output_tail);
    assert.equal(score.items.find((i: any) => i.id === 'greet').pass, true);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('score runs each item alone: an item whose cmd is broad never runs another item\'s hidden test', () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base), R = join(base, 'run'); mkdirSync(R);
    writeFileSync(join(hiddenRoot('dry-run', fx.hiddenParent), 'double', 'cmd'), 'node --test test/\n');
    runJson(fx, R, 'solo', [seat(fx, R, 'solo', 'pool/dry-run/solo-rep1/solo', [['double: fix', fix(fx, 'double')]])]);
    finalizeRun(R);
    const byId = Object.fromEntries(scoreRun(R, { hiddenParent: fx.hiddenParent }).items.map((i: any) => [i.id, i.pass]));
    assert.deepEqual(byId, { double: true, greet: false });
  } finally { rmSync(base, { recursive: true, force: true }); }
});
