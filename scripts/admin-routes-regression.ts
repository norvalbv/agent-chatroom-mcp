/**
 * Dashboard admin routes (src/launch/admin-routes.ts): the owner starts a run, adds a seat to a live room and holds a
 * decision from /ui. Starting a run or a seat spends money and acts on other agents, so both need the human token even
 * on a loopback hub with CHATROOM_INSECURE_LOCAL=1; a write from another site's page is refused outright. An isolated hub
 * per run with CHATROOM_SPAWN_DRY=1: nothing is launched, the launcher's log names a dry run id.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runArgs } from '../src/launch/admin-routes.js';

// the launcher's argv, pure: one flat room on this hub, the brief first so swarm.ts reads it as the task
const a = runArgs({ task: 'Find why the nightly build is slow and fix it.', agents: 3, model: 'claude-sonnet-5-5', timeout_min: 90, full_access: true }, { port: 7799, defaultCwd: process.cwd(), maxAgents: 12 });
assert.deepEqual(a.args, ['Find why the nightly build is slow and fix it.', '--flat', '--agents', '3', '--models', 'claude-sonnet-5-5', '--verifier-model', 'claude-sonnet-5-5', '--timeout', '90', '--port', '7799', '--cwd', process.cwd(), '--full-access']);
const bad: [Record<string, unknown>, RegExp][] = [
  [{ task: 'too short' }, /20 to 20,000/], [{ task: '--keep-hub and then do the real work please' }, /cannot start with '-'/],
  [{ task: 'A brief long enough to pass the length check.', agents: 1 }, /Seats is 2 to 12/],
  [{ task: 'A brief long enough to pass the length check.', model: '--apply' }, /not a model id/],
  [{ task: 'A brief long enough to pass the length check.', cwd: 'relative/dir' }, /not an existing absolute directory/],
  [{ task: 'A brief long enough to pass the length check.', timeout_min: 2 }, /Minutes is 5 to 720/],
];
for (const [b, re] of bad) assert.throws(() => runArgs(b, { port: 7799, defaultCwd: process.cwd(), maxAgents: 12 }), re);

const port = 19000 + Math.floor(Math.random() * 10000);
const dir = mkdtempSync(join(tmpdir(), 'admin-routes-'));
const env: Record<string, string> = { ...process.env } as Record<string, string>;
for (const key of Object.keys(env)) if (key.startsWith('CHATROOM_')) delete env[key];
Object.assign(env, { PORT: String(port), CHATROOM_DATA_DIR: join(dir, 'data'), CHATROOM_UI_RUNS_DIR: join(dir, 'runs'), CHATROOM_LOG_DIR: join(dir, 'spawned'), CHATROOM_SPAWN_DRY: '1', CHATROOM_INSECURE_LOCAL: '1', CHATROOM_HUMAN_TOKEN: 'owner-key' });
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/index.ts'], { env, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const owner = { 'x-chatroom-token': 'owner-key' };
try {
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) { try { ready = (await fetch(base)).ok; } catch {} if (!ready) await new Promise(r => setTimeout(r, 50)); }
  assert.ok(ready, 'isolated hub started');
  const brief = { name: 'benji', task: 'Measure the wait payload and cut what seats never read.', agents: 3, model: 'claude-haiku-5-5' };

  // starting a run: the token even on loopback; another site's page is refused before any check
  assert.equal((await post('/runs', brief)).status, 401, 'a run needs the human token under INSECURE_LOCAL');
  assert.equal((await post('/runs', brief, { ...owner, origin: 'https://evil.example' })).status, 403, 'a cross-site write is refused');
  assert.equal((await post(`/rooms/x/close`, {}, { origin: 'https://evil.example' })).status, 403, 'and so is a body-less close from another page');
  assert.equal((await post('/runs', { ...brief, task: 'short' }, owner)).status, 400);
  const started = await post('/runs', brief, { ...owner, origin: base });
  assert.equal(started.status, 201, await started.clone().text());
  const run = await started.json() as { id: string; run_id: string | null; log: string };
  assert.match(String(run.run_id), /^swarm-\d{6}-dry0$/, 'the run id is read from the launcher log');
  assert.match(readFileSync(run.log, 'utf8'), /"--flat","--agents","3","--models","claude-haiku-5-5"/);
  const list = await (await fetch(`${base}/runs`)).json() as { runs: { id: string }[]; models: string[] };
  assert.equal(list.runs[0].id, run.id); assert.ok(list.models.includes('claude-opus-5-5'));
  assert.equal((await post(`/runs/${run.id}/stop`, {}, owner)).status, 200);
  assert.equal((await post('/runs/nope/stop', {}, owner)).status, 404, 'only runs this hub started can be stopped');

  // a seat added from the dashboard: same spawner as request_agent (dry), announced in the room
  const room = 'admin-room';
  assert.equal((await post(`/rooms/${room}/messages`, { name: 'benji', content: 'opening the room' })).status, 200);
  assert.equal((await post(`/rooms/${room}/recruit`, { name: 'benji', brief: 'Review the open claim and report what fails.' })).status, 401);
  const rec = await post(`/rooms/${room}/recruit`, { name: 'benji', brief: 'Review the open claim and report what fails.', model: 'claude-haiku-5-5', count: 2 }, owner);
  assert.equal(rec.status, 201, await rec.clone().text());
  assert.equal(((await rec.json()) as { spawned: string[] }).spawned.length, 2);
  const budgets = await (await fetch(`${base}/rooms/${room}/recruitment`)).json() as { budgets: { room_total_recruits: { used: number } } };
  assert.equal(budgets.budgets.room_total_recruits.used, 2);
  const log = await (await fetch(`${base}/rooms/${room}/messages`)).json() as { content: string }[];
  assert.ok(log.some(m => /benji added .* from the dashboard/.test(m.content)), 'the room is told who added whom');

  // the recruit pin binds agents' requests; the owner's explicit pick on the dashboard is not one
  assert.equal((await post('/policy', { agent: 'openrouter', model: 'deepseek/deepseek-v4-flash-0731' }, owner)).status, 200);
  const picked = await (await post(`/rooms/${room}/recruit`, { name: 'benji', brief: 'Check the profile numbers against the CI logs.', model: 'claude-opus-5-5' }, owner)).json() as { agent: string; model: string };
  assert.deepEqual([picked.agent, picked.model], ['claude', 'claude-opus-5-5'], 'the owner picked the model: the pin does not override it');
  const pinned = await (await post(`/rooms/${room}/recruit`, { name: 'benji', brief: 'Check the profile numbers against the CI logs.' }, owner)).json() as { agent: string; model: string };
  assert.deepEqual([pinned.agent, pinned.model], ['openrouter', 'deepseek/deepseek-v4-flash-0731'], 'no pick: the pin applies as before');

  // hold: written as the human, blocks the decision; cleared the same way
  const held = await post(`/rooms/${room}/hold`, { name: 'benji', hold: true, reason: 'I want to read it first' });
  assert.deepEqual(await held.json(), { room, held: true });
  assert.deepEqual(await (await post(`/rooms/${room}/hold`, { name: 'benji', hold: false })).json(), { room, held: false });
  // every owner action is a countable event in the room log, beside the prose announce
  const events = readFileSync(join(dir, 'data', `${room}.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(e => e.type === 'owner_action');
  assert.deepEqual(events.map(e => e.action), ['recruit', 'recruit', 'recruit', 'hold', 'release']);
  assert.equal(events[1].picked, 'claude-opus-5-5');
} finally {
  child.kill('SIGTERM');
  await new Promise<void>(r => child.exitCode !== null ? r() : child.once('exit', () => r()));
  rmSync(dir, { recursive: true, force: true });
}
console.log('ADMIN ROUTES OK (run argv, token + same-origin gates, dry run, recruit, owner pick over the pin, hold)');
