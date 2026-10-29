/** The stray sweep (src/strays.ts) and its use in src/swarm.ts: node --import tsx scripts/strays.test.ts (needs npm run build)
 * swarm.ts's timeout and SIGTERM paths used to c.kill() direct children only, so a process a seat detached (a dev hub)
 * outlived `node dist/swarm.js` (docs/reuse-survey-2026-09-23.md, "Process containment and the stray sweep").
 * Every process here is started by this test, carries a random marker in its argv and is stopped by pid. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pidsUnder, stopStrays } from "../src/strays.ts";
import { collectRunSweep, runWorktreePaths, sweepRunWorktrees } from "../src/strays.ts";
import { runRooms } from "../src/launch/run-rooms.js";
import * as poolRun from "./pool-run.ts";
import { startHub } from "./seat-launch-fixture.ts";

const MARKER = `stray-marker-${randomBytes(4).toString("hex")}`;
const base = realpathSync(mkdtempSync(join(tmpdir(), "strays-")));
const started = new Set<number>();
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const idle = (cwd: string, tag: string) => {
  const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", `${MARKER}-${tag}`], { cwd, detached: true, stdio: "ignore" });
  c.unref(); started.add(c.pid!); return c.pid!;
};
const waitFor = async (ok: () => unknown, what: string, ms = 20_000) => { for (const until = Date.now() + ms; !ok(); ) { if (Date.now() > until) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 50)); } };

// ---- swarm.ts: a seat in its worktree detaches a child (as a seat's dev hub would be) and then never finishes ----
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('node:fs'), cp = require('node:child_process'), path = require('node:path');
fs.readFileSync(0, 'utf8');
const role = process.cwd().includes(path.sep + '.swarm-worktrees' + path.sep) ? 'worker' : 'verifier';
const c = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', process.env.STRAY_MARKER + '-' + role], { cwd: process.cwd(), detached: true, stdio: 'ignore' });
c.unref();
fs.writeFileSync(path.join(process.env.STRAY_RECORD_DIR, role + '.pid'), String(c.pid));
if (process.env.STRAY_RECRUITS === '1') {
 if (role === 'worker') {
  const run = path.basename(path.dirname(process.cwd())), trees = path.join(process.env.STRAY_PROJECT, '.swarm-worktrees');
  const records = {};
  for (const [label, room] of Object.entries({room:run+'-room', breakout:run+'-breakout-a', near:run+'x-room', other:'unrelated-room'})) {
   const cwd = path.join(trees, room, 'codex-recruit-1'); fs.mkdirSync(cwd, {recursive:true});
   const p = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', process.env.STRAY_MARKER + '-' + label], {cwd, detached:true, stdio:'ignore'});
   p.unref(); records[label] = {pid:p.pid, cwd};
  }
  fs.writeFileSync(path.join(process.env.STRAY_RECORD_DIR, 'recruits.json'), JSON.stringify(records));
 }
 setTimeout(() => process.exit(0), 300);
} else setInterval(() => {}, 1000);
`;
const bin = join(base, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "claude"), FAKE_CLAUDE);
chmodSync(join(bin, "claude"), 0o755);
const { hub, port } = await startHub(join(base, "hub-logs"), base);
// All async setup (the hub) finishes before the first test() is registered: node:test runs a top-level after() hook
// as soon as the tests queued so far have finished, so a test registered after a top-level await could find this torn down.
after(() => {
  hub.kill();
  for (const pid of started) if (alive(pid)) { try { process.kill(pid, "SIGKILL"); } catch {} }
  rmSync(base, { recursive: true, force: true });
});

test("stopStrays stops what runs under the dir and nothing else: not a process outside it, not a spared one", async () => {
  const dir = join(base, "unit", "run"), outside = join(base, "unit", "elsewhere");
  mkdirSync(join(dir, "seat"), { recursive: true }); mkdirSync(outside, { recursive: true });
  const inner = idle(join(dir, "seat"), "inner"), spared = idle(dir, "spared"), other = idle(outside, "outside");
  await waitFor(() => pidsUnder(dir).includes(inner) && pidsUnder(dir).includes(spared), "lsof to see both processes under the dir");
  assert.ok(!pidsUnder(dir).includes(other));
  assert.equal(await stopStrays(dir, [spared]), 1);
  await waitFor(() => !alive(inner), "the stray to stop");
  assert.ok(alive(spared) && alive(other), "only the process under the dir, and not spared, is stopped");
});

test("pool-run sweeps with the same functions, moved rather than copied", () => {
  assert.equal(poolRun.stopStrays, stopStrays);
  assert.equal(poolRun.pidsUnder, pidsUnder);
});

/** A --full-access flat run in a fresh git repo: one worker in .swarm-worktrees/<run>/, the verifier in the repo itself. */
async function run(label: string, timeoutMin: string, stop?: (swarm: ChildProcess, records: string) => Promise<void>, recruits = false, linked = false) {
  const repo = join(base, label), records = join(base, `${label}-records`);
  mkdirSync(repo); mkdirSync(records);
  const git = (...a: string[]) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  git("init", "-q"); writeFileSync(join(repo, "README.md"), "fixture\n"); git("add", "."); git("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");
  const cwd = linked ? join(base, `${label}-linked`) : repo;
  if (linked) assert.equal(git('worktree', 'add', '-b', 'linked-fixture', cwd).status, 0);
  const swarm = spawn(process.execPath, [resolve("dist", "swarm.js"), "Fixture task for the stray sweep.", "--flat", "--agents", "2", "--full-access", "--models", "claude-opus-5-5",
    "--verifier-model", "claude-opus-5-5", "--port", String(port), "--timeout", timeoutMin, "--cwd", cwd],
    { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STRAY_MARKER: MARKER, STRAY_RECORD_DIR: records, STRAY_RECRUITS: recruits ? '1' : '', STRAY_PROJECT: repo }, stdio: ["ignore", "pipe", "pipe"] });
  started.add(swarm.pid!);
  let out = "";
  swarm.stdout!.on("data", (d) => (out += d));
  swarm.stderr!.on("data", (d) => (out += d));
  const closed = new Promise((ok) => swarm.on("close", ok));
  await waitFor(() => existsSync(join(records, "worker.pid")) && existsSync(join(records, "verifier.pid")), "both seats to detach their child");
  const worker = Number(readFileSync(join(records, "worker.pid"), "utf8")), verifier = Number(readFileSync(join(records, "verifier.pid"), "utf8"));
  started.add(worker); started.add(verifier);
  if (stop) await stop(swarm, records);
  await closed;
  const recruitFile = join(records, 'recruits.json');
  const recruited: Record<string, {pid: number; cwd: string}> = existsSync(recruitFile) ? JSON.parse(readFileSync(recruitFile, 'utf8')) : {};
  for (const r of Object.values(recruited)) started.add(r.pid);
  const id = /swarm (swarm-[0-9]+-[a-z0-9]+):/.exec(out)?.[1];
  const resultFile = id && resolve('swarms', id, 'result.json');
  const result = resultFile && existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, 'utf8')) : null;
  if (id) rmSync(resolve("swarms", id), { recursive: true, force: true });
  return { out, worker, verifier, recruited, result };
}

for (const linked of [false, true]) test(`normal end sweeps run AND every run-prefixed room worktree (linked=${linked}), preserves other runs, and records each worktree`, async () => {
  const { out, worker, verifier, recruited, result } = await run(`recruits-${linked}`, '2', undefined, true, linked);
  assert.ok(!alive(worker), `the run worktree child survived:\n${out.slice(-1200)}`);
  for (const label of ['room', 'breakout']) {
    const r = recruited[label];
    assert.ok(r, `fixture started ${label}`);
    assert.ok(!alive(r.pid), `${label} recruit child ${r.pid} outlived end-of-run sweep:\n${out.slice(-1200)}`);
    const row = result?.straySweeps?.flatMap((s: any) => s.worktrees).find((w: any) => w.path === r.cwd);
    assert.equal(row?.stopped, 1, `result.json records what was stopped in ${r.cwd}`);
    assert.deepEqual(row.remaining, []);
  }
  for (const label of ['near', 'other']) assert.ok(alive(recruited[label].pid), `${label} sibling belongs to another run`);
  assert.ok(alive(verifier), 'the project checkout stays outside the sweep');
});

test('room-only roots, parent-linked breakouts, symlink escapes and near-prefix siblings', () => {
  const project = join(base, 'discovery'), trees = join(project, '.swarm-worktrees');
  const id = 'swarm-fixture-a';
  for (const name of [id + '-room', id + '-breakout-b', id + 'b-room', 'odd-breakout', 'unrelated']) mkdirSync(join(trees, name, 'seat'), {recursive:true});
  const outside = join(base, 'outside-tree'); mkdirSync(outside);
  symlinkSync(outside, join(trees, id + '-symlink'));
  symlinkSync(outside, join(trees, id + '-room', 'escaped-seat'));
  const rooms = runRooms([{name:id+'-room'}, {name:'odd-breakout', parent:id+'-room'}, {name:'unrelated'}], id, [id+'-room']);
  const paths = runWorktreePaths([project, project], id, rooms, [join(trees, 'odd-breakout', 'seat')]).map(p => p.path);
  for (const name of [id+'-room', id+'-breakout-b', 'odd-breakout']) assert.ok(paths.includes(join(trees, name, 'seat')), name);
  for (const name of [id+'b-room', 'unrelated']) assert.ok(!paths.some(p => p.startsWith(join(trees, name))), name);
  assert.ok(!paths.includes(outside));
  assert.equal(new Set(paths).size, paths.length, 'deduplicated across project roots');
  assert.deepEqual(runWorktreePaths([join(base, 'absent-project')], id), []);
});

test('a parent-linked room name alone never owns another session\'s worktrees', () => {
  const project = join(base, 'collision'), cwd = join(project, '.swarm-worktrees', 'shared-room', 'other-seat');
  mkdirSync(cwd, {recursive:true});
  assert.deepEqual(runWorktreePaths([project], 'run', ['shared-room']), [], 'a room name is not proof of worktree ownership');
});

test('an arbitrary breakout needs this hub\'s fresh spawn record and the actual matching worktree branch', async () => {
  const project = join(base, 'proven'), cwd = join(project, '.swarm-worktrees', 'odd-room', 'seat');
  mkdirSync(project);
  const git = (...args: string[]) => spawnSync('git', ['-C', project, ...args], {encoding:'utf8'});
  assert.equal(git('init', '-q').status, 0);
  writeFileSync(join(project, 'fixture'), 'x'); git('add', '.');
  assert.equal(git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture').status, 0);
  const startedAt = Date.now();
  assert.equal(git('worktree', 'add', '-b', 'swarm/odd-room/seat', cwd).status, 0);
  const record = {room:'odd-room', name:'seat', startedAt:new Date(startedAt).toISOString(), workspace:{worktree:cwd, branch:'swarm/odd-room/seat'}};
  let agents = [record];
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url === '/rooms' ? [{name:'run-room'}, {name:'odd-room', parent:'run-room'}] : agents));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const options = {cwd:project, run:'run', startedAt, rooms:['run-room'], url:`http://127.0.0.1:${(server.address() as {port:number}).port}`, reason:'fixture', log:()=>{}};
  try {
    assert.deepEqual((await collectRunSweep(options)).worktrees.map(w => w.path), [cwd], 'only the proven leaf, never the entire arbitrary room root');
    assert.deepEqual((await collectRunSweep({...options, startedAt:startedAt+60_000})).worktrees, [], 'old/reused worktree excluded');
    record.workspace.branch = 'swarm/odd-room/wrong-seat';
    assert.deepEqual((await collectRunSweep(options)).worktrees, [], 'record branch mismatch excluded');
    record.workspace.branch = 'swarm/odd-room/seat';
    assert.equal(git('-C', cwd, 'switch', '-c', 'different-actual-branch').status, 0);
    assert.deepEqual((await collectRunSweep(options)).worktrees, [], 'actual branch mismatch excluded');
    agents = [];
    assert.deepEqual((await collectRunSweep(options)).ownershipUnknown, ['odd-room'], 'missing records explicit, no cross-hub cleanup');
  } finally { await new Promise<void>(done => server.close(() => done())); }
  assert.deepEqual((await collectRunSweep(options)).worktrees, [], 'hub down: no arbitrary name authority');
});

test('a SIGTERM handler that changes cwd and lives is escaped, never stopped', async () => {
  const project = join(base, 'escaped'), cwd = join(project, '.swarm-worktrees', 'escape-room', 'seat'), outside = join(base, 'escaped-outside');
  mkdirSync(cwd, {recursive:true}); mkdirSync(outside);
  const ready = join(base, 'escaped-ready');
  const child = spawn(process.execPath, ['-e', `const fs=require('node:fs'); process.on('SIGTERM',()=>process.chdir(${JSON.stringify(outside)})); fs.writeFileSync(${JSON.stringify(ready)},'ready'); setInterval(()=>{},1000);`], {cwd, detached:true, stdio:'ignore'});
  child.unref(); started.add(child.pid!);
  await waitFor(() => existsSync(ready), 'escape handler ready');
  try {
    const rows = await sweepRunWorktrees([project], 'escape');
    const row = rows.find(r => r.path === cwd)!;
    assert.ok(alive(child.pid!), 'the process remains alive outside cwd');
    assert.equal(row.stopped, 0);
    assert.deepEqual(row.stoppedPids, []);
    assert.deepEqual((row as any).escaped, [child.pid]);
    assert.deepEqual(row.remaining, []);
  } finally { process.kill(child.pid!, 'SIGKILL'); }
});

test('denied signals report remaining PIDs and zero confirmed stops', async () => {
  const project = join(base, 'denied'), cwd = join(project, '.swarm-worktrees', 'run-room', 'seat');
  mkdirSync(cwd, {recursive:true});
  const pid = idle(cwd, 'denied');
  await waitFor(() => pidsUnder(cwd).includes(pid), 'denied fixture visible');
  const kill = process.kill;
  try {
    process.kill = (() => { throw Object.assign(new Error('fixture: EPERM'), {code:'EPERM'}); }) as typeof process.kill;
    const rows = await sweepRunWorktrees([project], 'run');
    const row = rows.find(r => r.path === cwd)!;
    assert.ok(row.targeted.includes(pid));
    assert.equal(row.stopped, 0);
    assert.deepEqual(row.stoppedPids, []);
    assert.ok(row.remaining?.includes(pid));
    assert.deepEqual(row.unknown, [pid]);
  } finally { process.kill = kill; process.kill(pid); }
});

test("swarm.ts timeout: a child a seat detached inside its worktree is stopped; one in the project checkout is left alone", async () => {
  const { out, worker, verifier } = await run("timeout", "0.1");
  assert.match(out, /timeout after 0\.1 min/);
  assert.ok(!alive(worker), `the worker's detached child outlived the run:\n${out.slice(-1200)}`);
  assert.match(out, /timeout: stopped [1-9]\d* process\(es\) still running in this run's worktrees/);
  assert.ok(alive(verifier), "the sweep never reaches outside .swarm-worktrees/<run>/");
});

test("swarm.ts SIGTERM: stopping the launcher stops a child a seat detached inside its worktree", async () => {
  const { out, worker } = await run("sigterm", "5", async (swarm) => { swarm.kill("SIGTERM"); });
  assert.match(out, /SIGTERM: stopping/);
  assert.ok(!alive(worker), `the worker's detached child outlived the launcher:\n${out.slice(-1200)}`);
});
