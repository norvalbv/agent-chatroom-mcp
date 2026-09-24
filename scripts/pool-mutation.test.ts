/** Offline tests for the flag-only StrykerJS check of hidden tests (todo/mutation-check-hidden-tests.md):
 * node --import tsx scripts/pool-mutation.test.ts. Fixture pools are temporary; nothing is written into this repo. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hiddenRoot, loadHiddenItem, loadPool } from './pool-format.ts';
import { makeDryRunPool } from './pool-fixture.ts';
import { mutationCheckItem, nodeSatisfies, patchRanges, runGrouped, strykerInstall } from './pool-mutation.ts';
import { validateAll } from './pool.ts';

const fresh = () => realpathSync(mkdtempSync(join(tmpdir(), 'pool-mutation-')));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(.*)$/;
const STOPPED_BY_SIGINT = /validate stopped by SIGINT/, STOPPED_BY_SIGTERM = /validate stopped by SIGTERM/;
/** Live processes whose command line carries `marker` (a random string only this test's own processes carry). */
const withMarker = (marker: string) => spawnSync('ps', ['-Ao', 'pid=,pgid=,command='], { encoding: 'utf8' }).stdout.split('\n')
  .map(l => PS_LINE.exec(l)).filter((m): m is RegExpExecArray => !!m && m[3].includes(marker) && !m[3].startsWith('ps '))
  .map(m => ({ pid: Number(m[1]), pgid: Number(m[2]), command: m[3] }));
/** Waits up to `ms` for every marker process to be gone; returns what is left. */
async function settled(marker: string, ms: number) {
  const until = Date.now() + ms;
  while (withMarker(marker).length && Date.now() < until) await sleep(200);
  return withMarker(marker).map(p => p.command);
}
/** Test cleanup when containment failed: stop what escaped. Only processes this test started carry the marker, and a whole
 * group is killed only when its leader carries it too. */
function stopEscaped(marker: string) {
  const left = withMarker(marker), leaders = new Set(left.filter(p => p.pid === p.pgid).map(p => p.pgid));
  for (const p of left) { try { process.kill(leaders.has(p.pgid) ? -p.pgid : p.pid, 'SIGKILL'); } catch {} }
}
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

test('a weak hidden test is flagged with its surviving mutants; a strong one is not; neither changes validity', async () => {
  const base = fresh(), prev = process.env.NODE_TEST_CONTEXT;
  process.env.NODE_TEST_CONTEXT = 'child-v8'; // an outer node --test must not make every mutant survive
  try {
    const fx = makeDryRunPool(base);
    weakenGreet(fx);
    const report = await validateAll(fx.poolDir, { hiddenParent: fx.hiddenParent, scratch: join(base, 'scratch'), repeats: 1, mutation: {} });
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

test('an item whose reference fix fails is not mutated, and an unsupported Node is reported instead of run', async () => {
  const base = fresh();
  try {
    const fx = makeDryRunPool(base);
    writeFileSync(join(hiddenRoot('dry-run', fx.hiddenParent), 'greet', 'reference.patch'), '');
    const report = await validateAll(fx.poolDir, { hiddenParent: fx.hiddenParent, scratch: join(base, 's'), repeats: 1, mutation: {} });
    const greet = report.items.find(r => r.id === 'greet') as any;
    assert.equal(greet.ok, false);
    assert.match(greet.mutation.skipped, /reference fix does not pass/);
    const { pool } = loadPool(fx.poolDir);
    const old = await mutationCheckItem({ repo: pool.repo, baseCommit: pool.base_commit, item: loadHiddenItem(hiddenRoot('dry-run', fx.hiddenParent), 'double'), scratch: join(base, 's2'), nodeVersion: '20.11.1' });
    assert.match(old.error ?? '', /needs Node >=22\.0\.0; this is Node 20\.11\.1/);
    assert.equal(old.flagged, false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('runGrouped kills the whole process group at the deadline, background children included', async () => {
  const marker = 'pool-mutation-test-' + randomBytes(6).toString('hex');
  const cwd = fresh();
  try {
    // Both node processes carry the unique marker in argv: one in the background, one in the foreground.
    const idle = `"$0" -e 'setInterval(()=>{},1000)' ${marker}`;
    const r = await runGrouped(['/bin/sh', '-c', `${idle} & ${idle}`, process.execPath], cwd, 1500, process.env);
    assert.equal(r.timed_out, true);
    const left = spawnSync('ps', ['-Ao', 'command'], { encoding: 'utf8' }).stdout.split('\n').filter(l => l.includes(marker) && !l.includes('ps -Ao'));
    assert.deepEqual(left, []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

/** A caller of runGrouped in its own process group, running an idle node process that carries the marker. `exits` gives the
 * caller SIGINT and SIGTERM handlers that call process.exit, as validate's do; without them the signal's default action kills it. */
function groupedCaller(marker: string, cwd: string, exits: boolean) {
  const lib = JSON.stringify(fileURLToPath(new URL('./pool-mutation.ts', import.meta.url)));
  const code = `import { runGrouped } from ${lib};${exits ? "for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(1));" : ''}` +
    `process.stdout.write(JSON.stringify(await runGrouped([process.execPath, '-e', 'setInterval(() => {}, 1000)', ${JSON.stringify(marker)}], ${JSON.stringify(cwd)}, 120000, process.env)));`;
  // started from this checkout (as the other CLI tests are), so --import tsx resolves
  const c = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  c.stdout.on('data', d => { out += d; });
  const exited = new Promise<string>(r => c.on('exit', () => r(out)));
  assert.ok(c.pid, 'the caller started');
  return { pid: c.pid, exited };
}
async function groupedRunning(marker: string, callerPgid: number) {
  const until = Date.now() + 60_000;
  // the idle process sits in the runner's own group, apart from the caller's
  while (!withMarker(marker).some(p => p.pgid !== callerPgid && p.command.includes('setInterval'))) {
    assert.ok(Date.now() < until, 'the grouped command never started');
    await sleep(100);
  }
}

test('a stopped caller stops the grouped run: group SIGINT, SIGTERM or SIGHUP; SIGINT, SIGTERM or SIGKILL to the caller alone', async () => {
  const cwd = fresh();
  const cases: { signal: NodeJS.Signals; group: boolean; exits: boolean }[] = [
    { signal: 'SIGINT', group: true, exits: false }, { signal: 'SIGTERM', group: true, exits: false }, { signal: 'SIGHUP', group: true, exits: false },
    { signal: 'SIGKILL', group: false, exits: false },
    // the caller alone, with handlers that exit as validate's do: the grouped run is not in the caller's group, so only the
    // caller's own 'exit' hook (or the keeper's lifeline) can stop it
    { signal: 'SIGINT', group: false, exits: true }, { signal: 'SIGTERM', group: false, exits: true },
  ];
  try {
    for (const { signal, group, exits } of cases) {
      const marker = `pool-mutation-stop-${randomBytes(6).toString('hex')}`;
      try {
        const caller = groupedCaller(marker, cwd, exits);
        await groupedRunning(marker, caller.pid);
        process.kill(group ? -caller.pid : caller.pid, signal);
        await caller.exited;
        assert.deepEqual(await settled(marker, 8000), [], `${signal} to the caller${group ? "'s group" : ''} left grouped processes running`);
      } finally { stopEscaped(marker); }
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

/** Starts `pool.ts validate --mutation` in a process group of its own, with `doubleCmd` as double's hidden command. Every hidden
 * command first appends its working directory to cwd.log, so a test can tell whether StrykerJS ever ran one (it runs them in a
 * `mutation-<item>-` copy). The scratch path puts the marker on validate's and StrykerJS's command lines. */
function startValidate(base: string, marker: string, doubleCmd: string) {
  const fx = makeDryRunPool(base), scratch = join(base, marker), log = join(base, 'cwd.log'), hidden = hiddenRoot('dry-run', fx.hiddenParent);
  writeFileSync(join(hidden, 'double', 'cmd'), `echo "$PWD" >> '${log}'; ${doubleCmd}\n`);
  writeFileSync(join(hidden, 'greet', 'cmd'), `echo "$PWD" >> '${log}'; node --test test/greet.hidden.test.mjs\n`);
  const v = spawn(process.execPath, ['--import', 'tsx', 'scripts/pool.ts', 'validate', '--pool', fx.poolDir, '--hidden', fx.hiddenParent,
    '--scratch', scratch, '--repeats', '1', '--mutation'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  v.stdout.on('data', d => { stdout += d; });
  v.stderr.on('data', d => { stderr += d; });
  const exited = new Promise<{ code: number | null; stdout: string; stderr: string }>(r => v.on('close', code => r({ code, stdout, stderr })));
  const pgid = v.pid;
  assert.ok(pgid, 'validate started');
  const cwds = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
  return { fx, scratch, pgid, exited, cwds };
}
/** Waits until a process carrying the marker and `text` runs inside validate's group (`inGroup`) or outside it (StrykerJS's). */
async function running(marker: string, pgid: number, text: string, inGroup: boolean, what: string) {
  const until = Date.now() + 100_000;
  while (!withMarker(marker).some(p => (p.pgid === pgid) === inGroup && p.command.includes(text))) {
    assert.ok(Date.now() < until, `${what} never started`);
    await sleep(250);
  }
}
const MUTANT_BLOCK = 'setTimeout(() => {}, 120000)';
/** validate --mutation with double's hidden command blocking only in mutant runs (StrykerJS's command runner sets
 * __STRYKER_ACTIVE_MUTANT__ there, so validate's own runs and StrykerJS's dry run stay quick), once a mutant run is under way. */
async function validateInMutantRun(base: string, marker: string) {
  const v = startValidate(base, marker, `if [ -n "$__STRYKER_ACTIVE_MUTANT__" ]; then node -e '${MUTANT_BLOCK}' ${marker}; fi; node --test test/double.hidden.test.mjs`);
  await running(marker, v.pgid, MUTANT_BLOCK, false, 'a mutant run');
  return v;
}
/** Removes a test base. It can fail only when containment already failed and an escaped StrykerJS was still writing into it as it
 * was stopped; that must not hide the assertion that reported the escape. */
const removeBase = (base: string) => { try { rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} };
const worktrees = (repo: string) => spawnSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).stdout.split('worktree ').length - 1;
const MUTATION_COPY = '/mutation-', GREET_COPY = '/mutation-greet-';

test('SIGKILL to the validate --mutation process group stops StrykerJS and its mutant runs and leaves no worktree registered', async () => {
  const base = fresh(), marker = `pool-mutation-contain-${randomBytes(6).toString('hex')}`;
  try {
    const v = await validateInMutantRun(base, marker);
    process.kill(-v.pgid, 'SIGKILL');
    await v.exited;
    assert.deepEqual(await settled(marker, 8000), [], 'a StrykerJS process outlived validate');
    await sleep(1500); // and none starts later
    assert.deepEqual(withMarker(marker).map(p => p.command), []);
    assert.equal(worktrees(v.fx.repo), 1, 'no worktree registered in the pool repo');
  } finally { stopEscaped(marker); removeBase(base); }
});

/** A stop during a mutant run: validate and every StrykerJS process gone within seconds (the blocked mutant run alone would
 * outlast that, since StrykerJS gives each mutant run seconds before its own timeout), no report, the copy removed, and greet's
 * check never started. validate carries the marker too (its --scratch), so `settled` waits for it as well. */
async function assertStoppedInMutantRun(v: Awaited<ReturnType<typeof validateInMutantRun>>, marker: string, code: number, stopped: RegExp) {
  assert.deepEqual(await settled(marker, 8000), [], 'validate or a StrykerJS process kept running after the stop');
  const r = await v.exited;
  assert.equal(r.code, code, r.stderr);
  assert.match(r.stderr, stopped);
  assert.equal(r.stdout, '', 'no report for a stopped validate');
  assert.deepEqual(readdirSync(v.scratch).filter(n => n.startsWith('mutation-')), [], 'the scratch copy was removed');
  assert.deepEqual(v.cwds().filter(c => c.includes(GREET_COPY)), [], 'the next item was not started');
  assert.equal(worktrees(v.fx.repo), 1);
}

test('Ctrl-C (SIGINT to the group) during a mutant run stops validate --mutation at once: StrykerJS killed, copy removed, next item not started', async () => {
  const base = fresh(), marker = `pool-mutation-ctrlc-${randomBytes(6).toString('hex')}`;
  try {
    const v = await validateInMutantRun(base, marker);
    process.kill(-v.pgid, 'SIGINT');
    await assertStoppedInMutantRun(v, marker, 130, STOPPED_BY_SIGINT);
  } finally { stopEscaped(marker); removeBase(base); }
});

test('SIGTERM to the validate PID alone during a mutant run stops validate at once, and StrykerJS with it', async () => {
  const base = fresh(), marker = `pool-mutation-term-${randomBytes(6).toString('hex')}`;
  try {
    const v = await validateInMutantRun(base, marker);
    process.kill(v.pgid, 'SIGTERM'); // validate's PID only: nothing else gets the signal
    await assertStoppedInMutantRun(v, marker, 143, STOPPED_BY_SIGTERM);
  } finally { stopEscaped(marker); removeBase(base); }
});

test('Ctrl-C during the hidden-test runs ends validate --mutation before any StrykerJS run starts', async () => {
  const base = fresh(), marker = `pool-mutation-early-${randomBytes(6).toString('hex')}`;
  try {
    // double's hidden command takes 3 s outside mutant runs, so the Ctrl-C lands inside validate's own synchronous runs
    const v = startValidate(base, marker, `if [ -z "$__STRYKER_ACTIVE_MUTANT__" ]; then node -e 'setTimeout(() => {}, 3000)' ${marker}; fi; node --test test/double.hidden.test.mjs`);
    await running(marker, v.pgid, 'setTimeout(() => {}, 3000)', true, "double's hidden run");
    process.kill(-v.pgid, 'SIGINT');
    const r = await v.exited;
    assert.equal(r.code, 130, r.stderr);
    assert.match(r.stderr, STOPPED_BY_SIGINT);
    assert.equal(r.stdout, '', 'no report for a stopped validate');
    assert.ok(v.cwds().length > 0, 'the hidden commands ran');
    assert.deepEqual(v.cwds().filter(c => c.includes(MUTATION_COPY)), [], 'StrykerJS never ran a hidden command');
    assert.deepEqual(readdirSync(v.scratch).filter(n => n.startsWith('mutation-')), [], 'no mutation copy was made');
    assert.deepEqual(await settled(marker, 8000), []);
    assert.equal(worktrees(v.fx.repo), 1);
  } finally { stopEscaped(marker); removeBase(base); }
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
