/** Offline end-to-end dry run of the pool-throughput harness (docs/experiments/2026-09-23-pool-throughput.md):
 * the two-item dry-run pool through validate -> run (fake seats) -> finalize -> score -> leakage audit, through
 * the CLI, with no model calls. node --import tsx scripts/pool-e2e.test.ts */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { hiddenRoot } from './pool-format.ts';
import { makeDryRunPool } from './pool-fixture.ts';

const fresh = () => realpathSync(mkdtempSync(join(tmpdir(), 'pool-e2e-')));
const cli = (env: NodeJS.ProcessEnv, ...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/pool.ts', ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000 });
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  const st = lstatSync(dir);
  if (st.isFile()) out.push(dir);
  else if (st.isDirectory()) for (const n of readdirSync(dir)) if (n !== '.git' && n !== 'node_modules') walk(join(dir, n), out);
  return out;
}

function setup(solutionsOverride?: (s: any) => any) {
  const base = fresh();
  const fx = makeDryRunPool(base);
  const solutions = join(base, 'solutions.json');
  writeFileSync(solutions, JSON.stringify(solutionsOverride ? solutionsOverride(structuredClone(fx.solutions)) : fx.solutions));
  const switchLog = join(base, 'switcher.log');
  writeFileSync(switchLog, '2026-09-01 10:00:00,000 - INFO - Switched from account 1 to 3\n');
  // The launcher never gets the hidden root; only validate/score/audit are told where it is.
  const env = { CLAUDE_CONFIG_DIR: join(base, 'claude-home') };
  return { base, fx, solutions, switchLog, env, scratch: join(base, 'scratch') };
}

function runSetup(s: ReturnType<typeof setup>, arm: string, rep = 1) {
  const run = cli(s.env, 'run', '--pool', s.fx.poolDir, '--arm', arm, '--rep', String(rep), '--scratch', s.scratch,
    '--fake-solutions', s.solutions, '--switch-log', s.switchLog, '--deadline-ms', '60000');
  assert.equal(run.status, 0, run.stderr);
  const runDir = run.stdout.trim().split('\n').pop()!;
  const fin = cli(s.env, 'finalize', '--run', runDir);
  assert.equal(fin.status, 0, fin.stderr);
  const score = cli(s.env, 'score', '--run', runDir, '--hidden', s.fx.hiddenParent);
  assert.equal(score.status, 0, score.stderr);
  return { runDir, final: readJson(join(runDir, 'final.json')), score: readJson(join(runDir, 'score.json')) };
}

/** Nothing a builder could read names the hidden side: briefs, worktrees and run.json carry neither the hidden root
 * nor any hidden test file name, and no reference.patch (or its content) exists under the run dir. */
function assertNoLeakInBuilderView(s: ReturnType<typeof setup>, runDir: string) {
  const hidden = hiddenRoot('dry-run', s.fx.hiddenParent);
  const patches = s.fx.pool.items.map(i => readFileSync(join(hidden, i.id, 'reference.patch'), 'utf8'));
  const run = readJson(join(runDir, 'run.json'));
  const builderView = [join(runDir, 'briefs'), join(runDir, 'run.json'), ...run.seats.map((x: any) => x.worktree).filter((w: string) => w && existsSync(w))];
  for (const f of builderView.flatMap(d => walk(d))) {
    assert.notEqual(basename(f), 'reference.patch', f);
    const text = readFileSync(f, 'utf8');
    assert.ok(!text.includes(s.fx.hiddenParent), `${f} names the hidden root`);
    for (const n of s.fx.hiddenTestNames) assert.ok(!text.includes(n), `${f} names hidden test ${n}`);
    for (const p of patches) assert.ok(!text.includes(p), `${f} carries a reference patch`);
  }
}

test('validate: the dry-run pool is admissible', () => {
  const s = setup();
  try {
    const r = cli(s.env, 'validate', '--pool', s.fx.poolDir, '--hidden', s.fx.hiddenParent, '--scratch', join(s.base, 'validate'));
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).items.map((i: any) => [i.id, i.ok]), [['double', true], ['greet', true]]);
  } finally { rmSync(s.base, { recursive: true, force: true }); }
});

test('solo end to end: both items pass the hidden tests on the solo branch, the suite passes, the run is clean', () => {
  const s = setup();
  try {
    const { runDir, final, score } = runSetup(s, 'solo');
    assert.equal(final.source, 'branch');
    assert.equal(score.passed, 2);
    assert.equal(score.of, 2);
    assert.equal(score.attempted, 2);
    assert.equal(score.suite.pass, true);
    assert.equal(score.void, false);
    assert.equal(score.conflicts, 0);
    assert.equal(readJson(join(runDir, 'run.json')).account.account, 3);
    assertNoLeakInBuilderView(s, runDir);
    // score leaves no hidden test behind in the run dir
    for (const f of walk(runDir)) for (const n of s.fx.hiddenTestNames) assert.notEqual(basename(f), n, f);
  } finally { rmSync(s.base, { recursive: true, force: true }); }
});

test('split end to end: three branches merged in fixed order, both items pass', () => {
  const s = setup();
  try {
    const { runDir, final, score } = runSetup(s, 'split');
    assert.equal(final.source, 'merge');
    assert.deepEqual(final.order, ['split-1', 'split-2', 'split-3'].map(n => `pool/dry-run/split-rep1/${n}`));
    assert.deepEqual(final.conflicts, []);
    assert.equal(score.passed, 2);
    assert.equal(score.suite.pass, true);
    assert.equal(score.void, false);
    assertNoLeakInBuilderView(s, runDir);
  } finally { rmSync(s.base, { recursive: true, force: true }); }
});

test('split with a conflict: the earlier branch wins the file, the conflict is recorded, the later item fails', () => {
  // greet's fake fix rewrites src/math.mjs too, so split-2 conflicts with split-1 on that file.
  const s = setup(sol => ({ ...sol, greet: { path: 'src/math.mjs', content: 'export function add(a, b) { return a + b; }\nexport const greet = n => `Hello, ${n}!`;\n' } }));
  try {
    const { final, score } = runSetup(s, 'split');
    assert.deepEqual(final.conflicts, [{ branch: 'pool/dry-run/split-rep1/split-2', files: ['src/math.mjs'] }]);
    const byId = Object.fromEntries(score.items.map((i: any) => [i.id, i]));
    assert.equal(byId.double.pass, true);
    assert.equal(byId.greet.pass, false);
    assert.equal(byId.greet.attempted, true);
    assert.equal(score.conflicts, 1);
  } finally { rmSync(s.base, { recursive: true, force: true }); }
});

test('leakage: a seat transcript that names the hidden root or a hidden test file voids the run', () => {
  for (const needle of ['root', 'name'] as const) {
    const s = setup();
    try {
      const { runDir } = runSetup(s, 'solo');
      const run = readJson(join(runDir, 'run.json'));
      const transcript = run.seats[0].transcript;
      assert.ok(transcript && existsSync(transcript), 'the solo seat has a transcript');
      const text = needle === 'root' ? join(hiddenRoot('dry-run', s.fx.hiddenParent), 'double', 'cmd') : s.fx.hiddenTestNames[1];
      appendFileSync(transcript, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: `cat ${text}` } }] } }) + '\n');
      const audit = cli(s.env, 'audit', '--run', runDir, '--hidden', s.fx.hiddenParent);
      assert.equal(audit.status, 1, `${needle}: audit must fail`);
      assert.equal(readJson(join(runDir, 'audit.json')).void, true);
      rmSync(join(runDir, 'score.json'));
      assert.equal(cli(s.env, 'score', '--run', runDir, '--hidden', s.fx.hiddenParent).status, 0);
      assert.equal(readJson(join(runDir, 'score.json')).void, true, `${needle}: score must carry the void`);
    } finally { rmSync(s.base, { recursive: true, force: true }); }
  }
});
