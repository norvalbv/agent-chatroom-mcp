/** Offline tests for the secondary, not pre-registered suite view (PASS_TO_PASS, todo/pass-to-pass-score-view.md):
 * node --import tsx scripts/pool-suite-view.test.ts. Fixture pools are temporary; nothing is written into this repo. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hiddenRoot, loadPool, lockPool, worktreeAt } from './pool-format.ts';
import { makeDryRunPool } from './pool-fixture.ts';
import { finalizeRun, scoreRun } from './pool-score.ts';
import { compareSuiteViews, parseOfflineRunner, parseSuiteOutput, parseVitestJson, readSuiteBase, recordSuiteBase, SUITE_BASE_FILE, type SuiteView } from './pool-suite-view.ts';
import { validateAll } from './pool.ts';

const RUNNER = fileURLToPath(new URL('./offline-runner.mjs', import.meta.url));
const fresh = () => realpathSync(mkdtempSync(join(tmpdir(), 'pool-suite-view-')));
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();
const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

/** Real scripts/offline-runner.mjs output: runCommands over the given commands, in a child, streams kept apart. */
function offlineRun(commands: { name: string; code: string }[]) {
  const list = JSON.stringify(commands.map(c => ({ name: c.name, command: process.execPath, args: ['--input-type=module', '-e', c.code] })));
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import { runCommands } from ${JSON.stringify(RUNNER)}; process.exitCode = runCommands(${list}, { cwd: process.cwd() });`], { encoding: 'utf8' });
  return { stdout: r.stdout, stderr: r.stderr, exit_code: r.status };
}

test('offline-runner output: failed top-level commands come from the final summary, not from a nested runner', () => {
  const nested = `import { runCommands } from ${JSON.stringify(RUNNER)}; runCommands([{ name: 'inner-fail', command: process.execPath, args: ['-e', 'process.exit(1)'] }], { cwd: process.cwd() });`;
  const r = offlineRun([{ name: 'good.test.ts', code: '' }, { name: 'bad.test.ts', code: 'process.exit(3)' }, { name: 'runner self-tests', code: nested }]);
  assert.equal(r.exit_code, 3);
  const parsed = parseOfflineRunner(r.stdout, r.stderr, r.exit_code)!;
  assert.equal(parsed.complete, true);
  assert.deepEqual(Object.keys(parsed.commands).filter(n => parsed.commands[n] === 'failed'), ['bad.test.ts']);
  assert.equal(parsed.commands['good.test.ts'], 'passed');
  assert.equal(parsed.commands['runner self-tests'], 'passed');
  const ok = offlineRun([{ name: 'a', code: '' }, { name: 'b', code: '' }]);
  assert.deepEqual(parseOfflineRunner(ok.stdout, ok.stderr, ok.exit_code), { complete: true, commands: { a: 'passed', b: 'passed' } });
});

test('offline-runner output cut off by a timeout: the running command is unknown and the view is incomplete', () => {
  const stdout = '\n[offline] a\n\n[offline] b\n\n[offline] c\n';
  const view = parseSuiteOutput({ stdout, stderr: '[offline] FAILED a: exit 1\n', exit_code: null, timed_out: true, cwd: '/' });
  assert.equal(view.format, 'offline-runner');
  assert.equal(view.complete, false);
  assert.deepEqual(view.commands, { a: 'failed', b: 'passed', c: 'unknown' });
  // killed after a nested runner (inside a) printed its own summary: that summary is not the top-level one, and its
  // failing command counts as passed, as it does in a complete run
  const nestedOut = '\n[offline] a\n\n[offline] inner\n\n[offline] b\n\n[offline] c\n';
  const nestedErr = '[offline] FAILED inner: exit 1\n[offline] FAILED 1 of 1 commands:\n  - inner: exit 1\n[offline] FAILED b: exit 2\n';
  const killed = parseSuiteOutput({ stdout: nestedOut, stderr: nestedErr, exit_code: null, timed_out: true, cwd: '/' });
  assert.deepEqual([killed.complete, killed.commands], [false, { a: 'passed', inner: 'passed', b: 'failed', c: 'unknown' }]);
  assert.equal(parseOfflineRunner('no markers here\n', '', 1), null);
});

test('vitest JSON: per-file status relative to the checkout; an all-skipped file is skipped; an npm banner before the JSON is fine', () => {
  const cwd = fresh();
  try {
    const report = { numTotalTests: 4, success: false, testResults: [
      { name: join(cwd, 'src/a.test.ts'), status: 'passed', assertionResults: [{ status: 'passed' }, { status: 'skipped' }] },
      { name: join(cwd, 'src/b.test.ts'), status: 'failed', assertionResults: [{ status: 'failed' }] },
      { name: join(cwd, 'src/c.test.ts'), status: 'passed', assertionResults: [{ status: 'skipped' }, { status: 'todo' }] },
      { name: '/elsewhere/d.test.ts', status: 'passed', assertionResults: [] },
    ] };
    const stdout = `\n> game@1.0.0 test\n> vitest run --reporter=json\n\n${JSON.stringify(report)}\n`;
    const parsed = parseVitestJson(stdout, cwd)!;
    assert.deepEqual(parsed.commands, { 'src/a.test.ts': 'passed', 'src/b.test.ts': 'failed', 'src/c.test.ts': 'skipped', '<outside>/d.test.ts': 'passed' });
    // $SUITE_REPORT wins over stdout; with neither, only the exit code is known
    const fromFile = parseSuiteOutput({ stdout: 'noise', stderr: '', exit_code: 1, timed_out: false, report: JSON.stringify(report), cwd });
    assert.equal(fromFile.format, 'vitest-json');
    assert.deepEqual(parseSuiteOutput({ stdout: 'ok', stderr: '', exit_code: 0, timed_out: false, cwd }), { format: 'exit-code', exit_code: 0, timed_out: false, complete: true, commands: null });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('compare: passed at base and now failing, skipped or gone; red at base and new failures are listed apart', () => {
  const view = (commands: SuiteView['commands'], complete = true): SuiteView => ({ format: 'offline-runner', exit_code: 1, timed_out: !complete, complete, commands });
  const base = view({ a: 'passed', b: 'passed', c: 'passed', d: 'failed', e: 'passed' });
  const head = view({ a: 'passed', b: 'failed', d: 'failed', e: 'skipped', n: 'failed' });
  const c = compareSuiteViews(base, head, 'npm test');
  assert.ok(c.available);
  assert.deepEqual([c.passed_at_base_now_failing, c.passed_at_base_now_skipped, c.passed_at_base_disappeared, c.failed_at_base, c.new_at_head_failing], [['b'], ['e'], ['c'], ['d'], ['n']]);
  const cut = compareSuiteViews(base, view({ a: 'passed', b: 'unknown' }, false), 'npm test');
  assert.ok(cut.available);
  assert.deepEqual(cut.passed_at_base_disappeared, [], 'an incomplete head run proves nothing disappeared');
  assert.deepEqual(cut.passed_at_base_not_seen_head_incomplete, ['b', 'c', 'e']);
  assert.equal(compareSuiteViews(base, { ...head, format: 'exit-code', commands: null }, 'npm test').available, false);
  const exitOnly = compareSuiteViews({ ...base, format: 'exit-code', commands: null, exit_code: 0 }, { ...head, format: 'exit-code', commands: null }, 'x');
  assert.ok(exitOnly.available && !exitOnly.per_command && exitOnly.base_exit_code === 0 && exitOnly.head_exit_code === 1);
});

/** The dry-run pool with a per-command suite: a copy of this repo's offline runner over the files in suite.txt, recommitted and relocked. */
function suitePool(base: string) {
  const fx = makeDryRunPool(base);
  put(join(fx.repo, 'offline-runner.mjs'), readFileSync(RUNNER, 'utf8'));
  put(join(fx.repo, 'suite.mjs'), "import { readFileSync } from 'node:fs';\nimport { runCommands } from './offline-runner.mjs';\nconst names = readFileSync('suite.txt', 'utf8').split('\\n').filter(Boolean);\nprocess.exitCode = runCommands(names.map(n => ({ name: n, command: process.execPath, args: ['--test', 'test/' + n] })), { cwd: process.cwd() });\n");
  // A stand-in for vitest --reporter=json --outputFile="$SUITE_REPORT": absolute file names, as vitest writes them.
  put(join(fx.repo, 'report.mjs'), "import { spawnSync } from 'node:child_process';\nimport { readFileSync, writeFileSync } from 'node:fs';\nimport { resolve } from 'node:path';\nconst names = readFileSync('suite.txt', 'utf8').split('\\n').filter(Boolean);\nconst testResults = names.map(n => { const ok = spawnSync(process.execPath, ['--test', 'test/' + n]).status === 0; return { name: resolve('test', n), status: ok ? 'passed' : 'failed', assertionResults: [{ status: ok ? 'passed' : 'failed' }] }; });\nwriteFileSync(process.env.SUITE_REPORT, JSON.stringify({ success: testResults.every(t => t.status === 'passed'), testResults }));\n");
  put(join(fx.repo, 'test', 'math.test.mjs'), "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { add } from '../src/math.mjs';\ntest('add', () => assert.equal(add(2, 3), 5));\n");
  put(join(fx.repo, 'test', 'text.test.mjs'), "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { shout } from '../src/text.mjs';\ntest('shout', () => assert.equal(shout('hi'), 'HI'));\n");
  put(join(fx.repo, 'test', 'extra.test.mjs'), "import { test } from 'node:test';\ntest('extra', () => {});\n");
  put(join(fx.repo, 'suite.txt'), 'math.test.mjs\ntext.test.mjs\nextra.test.mjs\n');
  git(fx.repo, 'add', '-A'); git(fx.repo, 'commit', '-q', '-m', 'suite');
  const poolPath = join(fx.poolDir, 'pool.json'), p = read(poolPath);
  p.base_commit = git(fx.repo, 'rev-parse', 'HEAD'); p.suite_cmd = 'node suite.mjs';
  writeFileSync(poolPath, JSON.stringify(p, null, 2) + '\n'); lockPool(fx.poolDir);
  return fx;
}

/** A solo run whose one seat fixes double, breaks shout (text.test fails) and drops extra.test from the suite. */
function breakingSoloRun(fx: ReturnType<typeof makeDryRunPool>, base: string) {
  const { pool, sha256 } = loadPool(fx.poolDir), R = join(base, 'run'), wt = join(R, 'wt', 'solo'), branch = 'pool/dry-run/solo-rep1/solo';
  mkdirSync(R, { recursive: true });
  worktreeAt(pool.repo, pool.base_commit, wt, branch);
  put(join(wt, fx.solutions.double.path), fx.solutions.double.content);
  put(join(wt, 'src', 'text.mjs'), 'export function shout(s) {\n  return s;\n}\n');
  put(join(wt, 'suite.txt'), 'math.test.mjs\ntext.test.mjs\n');
  git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', 'double: fix');
  put(join(R, 'seats', 'solo', 'transcript.jsonl'), '{"type":"assistant"}\n');
  const seat = { name: 'solo', branch, worktree: wt, transcript: join(R, 'seats', 'solo', 'transcript.jsonl'), cost_usd: 0.5, cost_estimated: false };
  writeFileSync(join(R, 'run.json'), JSON.stringify({ pool: pool.name, pool_dir: fx.poolDir, pool_sha256: sha256, arm: 'solo', rep: 1, repo: pool.repo, base_commit: pool.base_commit, deadline_min: 1, seats: [seat], fake: true }));
  finalizeRun(R);
  return R;
}

test('validate --suite-view records per-command results at base; score reports what broke as secondary and leaves suite.pass alone', () => {
  const base = fresh();
  try {
    const fx = suitePool(base);
    const report = validateAll(fx.poolDir, { hiddenParent: fx.hiddenParent, scratch: join(base, 'scratch'), repeats: 1, suiteView: true });
    assert.equal(report.ok, true);
    assert.deepEqual(report.suite_base && [report.suite_base.format, report.suite_base.commands, report.suite_base.not_passing], ['offline-runner', 3, []]);
    const text = readFileSync(join(fx.poolDir, SUITE_BASE_FILE), 'utf8'), record = JSON.parse(text);
    assert.deepEqual(record.view.commands, { 'math.test.mjs': 'passed', 'text.test.mjs': 'passed', 'extra.test.mjs': 'passed' });
    assert.match(record.note, /not pre-registered/);
    for (const secret of [base, tmpdir(), fx.hiddenParent, hiddenRoot('dry-run', fx.hiddenParent), ...fx.hiddenTestNames]) assert.ok(!text.includes(secret), `base record must not name ${secret}`);
    assert.equal(git(fx.repo, 'worktree', 'list', '--porcelain').split('worktree ').length - 1, 1, 'validate leaves no worktree behind');

    const score = scoreRun(breakingSoloRun(fx, base), { hiddenParent: fx.hiddenParent });
    assert.deepEqual(Object.keys(score.suite).sort(), ['cmd', 'exit_code', 'output_tail', 'pass'], 'the pre-registered suite record keeps its shape');
    assert.equal(score.suite.pass, false);
    assert.equal(score.passed, 1);
    const p2p = score.secondary_not_preregistered.suite_pass_to_pass;
    assert.match(score.secondary_not_preregistered.note, /not pre-registered/);
    assert.ok(p2p.available);
    assert.deepEqual([p2p.passed_at_base_now_failing, p2p.passed_at_base_disappeared, p2p.failed_at_base], [['text.test.mjs'], ['extra.test.mjs'], []]);
    assert.deepEqual(read(join(base, 'run', 'score.json')).secondary_not_preregistered.suite_pass_to_pass.passed_at_base_now_failing, ['text.test.mjs']);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('score without a base record says why the secondary view is missing and scores the suite as before', () => {
  const base = fresh();
  try {
    const fx = suitePool(base);
    const score = scoreRun(breakingSoloRun(fx, base), { hiddenParent: fx.hiddenParent });
    assert.equal(score.suite.pass, false);
    const p2p = score.secondary_not_preregistered.suite_pass_to_pass;
    assert.equal(p2p.available, false);
    assert.match(!p2p.available ? p2p.reason : '', /suite-base\.json/);
    // a record for another base commit is refused, not compared
    writeFileSync(join(fx.poolDir, SUITE_BASE_FILE), JSON.stringify({ base_commit: '0000000', suite_cmd: 'node suite.mjs', view_cmd: 'node suite.mjs', view: {} }));
    rmSync(join(base, 'run', 'score.json'));
    const stale = scoreRun(join(base, 'run'), { hiddenParent: fx.hiddenParent }).secondary_not_preregistered.suite_pass_to_pass;
    assert.match(!stale.available ? stale.reason : '', /recorded at base 0000000/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

/** A base record as recordSuiteBase writes it, and records that are not: each with the reason readSuiteBase must give. */
const GOOD_BASE = { note: 'n', pool: 'p', base_commit: 'abc123', suite_cmd: 'node suite.mjs', view_cmd: 'node suite.mjs', recorded_at: 't',
  view: { format: 'offline-runner', exit_code: 1, timed_out: false, complete: true, commands: { 'a.test.ts': 'passed', 'b.test.ts': 'failed' } } };
const withView = (view: object) => JSON.stringify({ ...GOOD_BASE, view: { ...GOOD_BASE.view, ...view } });
const MALFORMED_BASES: [string, RegExp][] = [
  [JSON.stringify(GOOD_BASE).slice(0, 200), /unreadable: .*JSON/],
  [`<<<<<<< HEAD\n${JSON.stringify(GOOD_BASE)}`, /unreadable/],
  ['[]', /not a JSON object/], ['null', /not a JSON object/],
  [JSON.stringify({ ...GOOD_BASE, view: undefined }), /malformed: no view$/],
  [JSON.stringify({ ...GOOD_BASE, view_cmd: undefined }), /malformed: no view_cmd/],
  [withView({ format: 'junit' }), /malformed: view\.format "junit"/],
  [withView({ commands: ['a.test.ts'] }), /malformed: view\.commands is neither/],
  [withView({ commands: { 'a.test.ts': 'ok' } }), /malformed: view\.commands\["a\.test\.ts"\]/],
  [withView({ complete: 'yes' }), /malformed: view\.complete/],
  [withView({ exit_code: '1' }), /malformed: view\.exit_code/],
];
const UNREADABLE = /unreadable/, NO_VIEW = /malformed: no view/, VIEW_RUN_FAILED = /running the view command at head/;

test('readSuiteBase never throws: unreadable, non-object or malformed records come back as a reason', () => {
  const dir = fresh();
  try {
    const pool = { base_commit: 'abc123', suite_cmd: 'node suite.mjs' } as Parameters<typeof readSuiteBase>[1];
    const reasonFor = (text: string) => {
      writeFileSync(join(dir, SUITE_BASE_FILE), text);
      const r = readSuiteBase(dir, pool);
      return 'reason' in r ? r.reason : null;
    };
    assert.equal(reasonFor(JSON.stringify(GOOD_BASE)), null);
    assert.equal(reasonFor(withView({ commands: null, format: 'exit-code' })), null, 'the exit-code fallback has no commands');
    for (const [text, reason] of MALFORMED_BASES) assert.match(reasonFor(text) ?? 'accepted', reason, text.slice(0, 80));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a truncated or partial suite-base.json never stops score: score.json is written and the pre-registered suite is unchanged', () => {
  const base = fresh();
  try {
    const fx = suitePool(base);
    const R = breakingSoloRun(fx, base);
    const plain = scoreRun(R, { hiddenParent: fx.hiddenParent }); // no base record at all
    const record = recordSuiteBase(fx.poolDir, { scratch: join(base, 'scratch') });
    const full = JSON.stringify(record, null, 2);
    for (const [text, reason] of [[full.slice(0, 200), UNREADABLE], [JSON.stringify({ ...record, view: undefined }), NO_VIEW]] as const) {
      writeFileSync(join(fx.poolDir, SUITE_BASE_FILE), text);
      rmSync(join(R, 'score.json'), { force: true });
      const score = scoreRun(R, { hiddenParent: fx.hiddenParent });
      const written = read(join(R, 'score.json'));
      assert.deepEqual([written.suite.pass, written.suite.exit_code, written.suite.cmd], [plain.suite.pass, plain.suite.exit_code, plain.suite.cmd]);
      assert.deepEqual([score.passed, score.of, score.items.map(i => [i.id, i.pass])], [plain.passed, plain.of, plain.items.map(i => [i.id, i.pass])]);
      const p2p = written.secondary_not_preregistered.suite_pass_to_pass;
      assert.equal(p2p.available, false);
      assert.match(p2p.reason, reason);
    }
    // a valid record whose separate head view run fails (its checkout path is taken) is reported the same way
    writeFileSync(join(fx.poolDir, SUITE_BASE_FILE), JSON.stringify({ ...record, view_cmd: 'node report.mjs' }));
    put(join(R, 'score-wt', 'suite-view'), 'in the way\n');
    rmSync(join(R, 'score.json'), { force: true });
    const blocked = scoreRun(R, { hiddenParent: fx.hiddenParent });
    assert.deepEqual([blocked.suite.pass, blocked.passed], [plain.suite.pass, plain.passed]);
    const p2p = read(join(R, 'score.json')).secondary_not_preregistered.suite_pass_to_pass;
    assert.equal(p2p.available, false);
    assert.match(p2p.reason, VIEW_RUN_FAILED);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('a vitest-style view command writes JSON to $SUITE_REPORT; score runs it apart from suite_cmd and compares per file', () => {
  const base = fresh();
  try {
    const fx = suitePool(base);
    const record = recordSuiteBase(fx.poolDir, { scratch: join(base, 'scratch'), viewCmd: 'node report.mjs' });
    assert.equal(record.view.format, 'vitest-json');
    assert.deepEqual(record.view.commands, { 'test/math.test.mjs': 'passed', 'test/text.test.mjs': 'passed', 'test/extra.test.mjs': 'passed' });
    const score = scoreRun(breakingSoloRun(fx, base), { hiddenParent: fx.hiddenParent });
    assert.equal(score.suite.cmd, 'node suite.mjs');
    const p2p = score.secondary_not_preregistered.suite_pass_to_pass;
    assert.ok(p2p.available);
    assert.equal(p2p.view_cmd, 'node report.mjs');
    assert.deepEqual([p2p.passed_at_base_now_failing, p2p.passed_at_base_disappeared], [['test/text.test.mjs'], ['test/extra.test.mjs']]);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('CLI: pool.ts validate --suite-view prints the base record summary and still exits on item validity alone', () => {
  const base = fresh();
  try {
    const fx = suitePool(base);
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/pool.ts', 'validate', '--pool', fx.poolDir, '--hidden', fx.hiddenParent, '--scratch', join(base, 's'), '--repeats', '1', '--suite-view'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).suite_base.format, 'offline-runner');
    assert.match(r.stderr, /suite at base \(secondary, not pre-registered\): offline-runner, 3 results/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
