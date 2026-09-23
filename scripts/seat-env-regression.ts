/** Hermetic callsite regression. No real subprocess, network, credential or .env access.
 * Run: NODE_OPTIONS=--experimental-vm-modules npx tsx scripts/seat-env-regression.ts
 * VM executes complete TypeScript modules (transpiled by esbuild) with synthetic OS boundaries.
 * This tests minimization only; same-user filesystem access is NOT sandboxed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const HUMAN = 'synthetic-human';
const PROVIDER = 'synthetic-provider';
const fixture = '# synthetic fixture ONLY\nCHATROOM_HUMAN_TOKEN=synthetic-human\nOPENROUTER_API_KEY=synthetic-provider\nOTHER_CONFIG="fixture-value"\n';
const syntheticEnv = () => ({ CHATROOM_HUMAN_TOKEN: HUMAN, OPENROUTER_API_KEY: PROVIDER, ANTHROPIC_API_KEY: 'synthetic-anthropic', OPENAI_API_KEY: 'synthetic-openai', PATH: '/synthetic/bin', HOME: '/synthetic/home', MCP_TOOL_TIMEOUT: '1' });
type Capture = { cmd: string; args: string[]; options: any; stdin?: { text: string } };
async function harness(entry: string, env: Record<string, string>, argv: string[] = [], worktrees: "none" | "success" | "fail" = "none") {
  const calls: Capture[] = [];
  const requests: { target: string; options: any }[] = [];
  let initialFetch = true;
  const proc = { env, argv: ['node', entry, ...argv], execPath: '/synthetic/node', cwd: () => '/fixture', on() {}, stdout: { write() {} }, stderr: { write() {} }, exit(code: number) { if (code) throw new Error(`unexpected exit ${code}`); } };
  const fs = { realpathSync: (x: string) => x,
    existsSync: (f: string) => f.endsWith('.env'),
    readFileSync(f: string) {
      // Deliberately no delegated disk reads: even dotenv and prompts are in-memory fixtures.
      if (f.endsWith('.env')) return fixture;
      if (f.endsWith('/prompts/planner.md')) return 'Synthetic fixture prompt planner';
      if (f.includes('/prompts/')) return 'Synthetic fixture prompt {{NAME}} {{ROOM}} {{TOPIC}}';
      throw new Error(`unexpected fixture read: ${f}`);
    },
    mkdirSync() {}, writeFileSync() {}, createWriteStream() { return {}; }, symlinkSync() {}, readdirSync() { return []; }, statSync() { return { mtimeMs: 0 }; },
  };
  const cp = {
    spawn(cmd: string, args: string[], options: any) {
      calls.push({ cmd, args, options });
      const child: any = new EventEmitter();
      child.stdout = new EventEmitter(); child.stdout.pipe = () => {};
      child.stderr = new EventEmitter(); child.stderr.pipe = () => {};
      child.pid = 42; child.kill = () => {}; child.unref = () => {};
      child.stdin = { text: '', on() { return this; }, write(d: string) { this.text += d; return true; }, end(d?: string) { if (d) this.text += d; } };
      calls[calls.length - 1].stdin = child.stdin;
      setImmediate(() => {
        if (args.some(a => a.includes('Synthetic fixture prompt planner')) || child.stdin.text.includes('Synthetic fixture prompt planner')) child.stdout.emit('data', JSON.stringify({ summary: 'fixture', done_when: 'done', groups: [{ id: 'room', title: 'room', workers: 3, directive: 'fixture' }], verifier_directive: 'fixture' }));
        child.emit('close', 0);
      });
      return child;
    },
    spawnSync(_cmd: string, args: string[]) {
      if (args.includes('--is-inside-work-tree')) return { status: 0, stdout: worktrees === 'none' ? 'false' : 'true', stderr: '' };
      if (args.includes('worktree')) return { status: worktrees === 'success' ? 0 : 1, stdout: '', stderr: 'synthetic failure' };
      return { status: 1, stdout: '', stderr: '' };
    },
  };
  const context = vm.createContext({ process: proc, console: { log() {}, error() {} }, setTimeout, clearTimeout, setInterval, clearInterval, Date, URL, AbortSignal,
    async fetch(target: string, options?: any) {
      requests.push({ target, options });
      // Exercise ensureHub's fallback spawn without contacting a hub.
      if (entry === 'swarm' && initialFetch) { initialFetch = false; throw new Error('synthetic hub absent'); }
      return { status: 200, async json() { return target.endsWith('/rooms') || target.includes('/messages?') ? [] : { caps: { max_live_per_room: 12 }, state: 'concluded', conclusion: { text: 'fixture' } }; }, async text() { return ''; } };
    },
  });
  const cache = new Map<string, any>();
  const mocks: Record<string, any> = { 'node:fs': fs, 'node:path': path, 'node:url': url, 'node:child_process': cp, 'node:crypto': { randomUUID: () => 'synthetic-session-id' }, './hub.js': { HubError: Error }, './settled.js': { settledAxes: () => '' }, './seat.js': { runSeat: async () => ({ final: 'fixture', ok: true }) }, './seat-handoff-report.js': { handoffMarkerLine: () => '' }, './result.js': { collectRoomSnapshot: async (_base: string, name: string) => ({ name, payload: { state: 'concluded', conclusion: { text: 'fixture' } }, transcript: { text: '' } }), readRunResult: () => ({}), writeRunResult: () => undefined, renderRunReport: () => '', rollupUsage: () => undefined, parseClaudeCliOutput: (raw: string) => ({ text: raw, usage: null }) } };
  async function module(name: string): Promise<any> {
    if (cache.has(name)) return cache.get(name);
    if (mocks[name]) {
      const values = mocks[name];
      const mod = new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
      cache.set(name, mod); return mod;
    }
    const base = name.replace(/^\.\//, '').replace(/\.js$/, '');
    assert.ok(['env', 'spawner', 'swarm', 'openrouter', 'respawn', 'claude-args'].includes(base), `unmocked import ${name}`); // respawn.ts and claude-args.ts are pure: real import
    // Only these explicitly allowlisted source files are read from disk.
    const source = readFileSync(path.join(root, 'src', `${base}.ts`), 'utf8');
    const code = transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' }).code;
    const mod = new vm.SourceTextModule(code, { context, initializeImportMeta(meta) { meta.url = `file:///fixture/src/${base}.js`; } });
    cache.set(name, mod);
    await mod.link((specifier: string) => module(specifier));
    return mod;
  }
  const mod = await module(entry);
  await mod.evaluate();
  return { exports: mod.namespace as any, env, calls, requests };
}
function checkSeat(call: Capture) {
  assert.equal(Object.hasOwn(call.options.env, 'CHATROOM_HUMAN_TOKEN'), false, 'seat spawn options must omit human token');
  for (const [key, value] of Object.entries(syntheticEnv())) {
    if (key !== 'CHATROOM_HUMAN_TOKEN' && key !== 'MCP_TOOL_TIMEOUT') assert.equal(call.options.env[key], value, `${key} retained`);
  }
  assert.equal(call.options.env.MCP_TOOL_TIMEOUT, '120000');
}
let failures = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`); } catch (error) { failures++; console.error(`FAIL ${name}: ${(error as Error).message}`); }
}
for (const agent of ['claude', 'codex', 'openrouter']) await test(`spawner ${agent} actual spawn options`, async () => {
  const h = await harness('spawner', syntheticEnv());
  const spawner = new h.exports.Spawner({ mcpUrl: 'http://synthetic.invalid/mcp', defaultCwd: '/fixture', logDir: '/fixture/logs' });
  spawner.request({ room: 'synthetic-room', requestedBy: 'synthetic-parent', brief: 'Synthetic non-networking credential minimization regression', agent, name: `fixture-${agent}` });
  assert.equal(h.calls.length, 1); checkSeat(h.calls[0]); assert.equal(h.env.CHATROOM_HUMAN_TOKEN, HUMAN, 'parent environment unchanged');
});
await test('swarm all provider seats, hub env and controller header', async () => {
  const h = await harness('swarm', syntheticEnv(), ['synthetic task', '--flat', '--agents', '4', '--codex', '1', '--openrouter', '1', '--require-verification']);
  const hub = h.calls.filter(c => c.args.some(a => a.endsWith('/dist/index.js')));
  const seats = h.calls.filter(c => !hub.includes(c));
  assert.equal(hub.length, 1); assert.equal(hub[0].options.env.CHATROOM_HUMAN_TOKEN, HUMAN, 'hub controller credential retained');
  assert.equal(seats.length, 4); assert.ok(seats.some(c => c.cmd === 'codex')); assert.ok(seats.some(c => c.args.includes('/fixture/src/openrouter.ts')));
  const claudeSeat = seats.find(c => c.cmd === 'claude');
  assert.ok(claudeSeat, 'a claude seat was spawned');
  const outputFormatAt = claudeSeat!.args.indexOf('--output-format');
  assert.ok(outputFormatAt >= 0 && claudeSeat!.args[outputFormatAt + 1] === 'json', 'runClaude requests --output-format json so the seat reports usage (R4 goal 2)');
  const create = h.requests.find(r => r.target.endsWith('/create'));
  assert.equal(create?.options.headers['x-chatroom-token'], HUMAN, 'launcher control auth retained');
  assert.equal(h.env.CHATROOM_HUMAN_TOKEN, HUMAN, 'launcher env unchanged');
  for (const seat of seats) checkSeat(seat);
});
await test('swarm seats get their prompt on stdin, never in argv (a pkill -f on a brief word killed 14 seats)', async () => {
  const h = await harness('swarm', syntheticEnv(), ['synthetic task about offline-runner', '--flat', '--agents', '3']);
  const seats = h.calls.filter(c => c.cmd === 'claude');
  assert.ok(seats.length >= 3, 'seats launched');
  for (const c of seats) {
    assert.ok(!c.args.some(a => a.includes('offline-runner')), 'brief not in argv');
    assert.ok((c.stdin?.text ?? '').length > 0, 'every seat gets its prompt on stdin');
  }
  assert.ok(seats.filter(c => /offline-runner/.test(c.stdin?.text ?? '')).length >= 2, 'the workers\' brief arrives on stdin');
});
await test('OpenRouter startup excludes token from synthetic dotenv', async () => {
  const h = await harness('openrouter', {}, ['-p', 'synthetic prompt']);
  assert.equal(h.env.OPENROUTER_API_KEY, PROVIDER, 'provider key still loaded');
  assert.equal(h.env.OTHER_CONFIG, 'fixture-value');
  assert.equal(Object.hasOwn(h.env, 'CHATROOM_HUMAN_TOKEN'), false, 'seat dotenv must not reload token');
});
await test('default controller dotenv behavior retained', async () => {
  const h = await harness('env', {});
  const loaded = h.exports.loadDotEnv();
  assert.equal(h.env.CHATROOM_HUMAN_TOKEN, HUMAN); assert.equal(h.env.OPENROUTER_API_KEY, PROVIDER);
  assert.ok(loaded.includes('CHATROOM_HUMAN_TOKEN'));
  h.env.OPENROUTER_API_KEY = 'synthetic-exported'; h.exports.loadDotEnv(); assert.equal(h.env.OPENROUTER_API_KEY, 'synthetic-exported');
});
console.log(`SEAT ENV: ${failures ? `${failures} failed` : 'OK'} (synthetic only; minimization, NOT sandboxing)`);
process.exitCode = failures ? 1 : 0;
// ---- non-bypass checks (behavioral, no source-string matching) ----
await test('helper clone purity and API conformance', async () => {
  const h = await harness('env', syntheticEnv());
  const { seatChildEnv, SEAT_ENV_EXCLUSIONS } = h.exports;
  assert.ok(Array.isArray(SEAT_ENV_EXCLUSIONS) && SEAT_ENV_EXCLUSIONS.includes('CHATROOM_HUMAN_TOKEN'), 'SEAT_ENV_EXCLUSIONS declares token');
  const input = syntheticEnv();
  const env = seatChildEnv(input);
  assert.notEqual(env, input, 'returns a clone, not the input');
  assert.ok(Object.hasOwn(env, 'CHATROOM_HUMAN_TOKEN') === false, 'omits token from clone');
  assert.ok(Object.hasOwn(input, 'CHATROOM_HUMAN_TOKEN') === true, 'caller env untouched');
  assert.equal(env.MCP_TOOL_TIMEOUT, '120000', 'sets seat timeout');
  const frozen = Object.freeze({ OPENROUTER_API_KEY: PROVIDER, CHATROOM_HUMAN_TOKEN: HUMAN });
  const out = seatChildEnv(frozen);
  assert.equal(Object.keys(out).length, 2, 'clone is flat and exact');
  assert.equal(out.OPENROUTER_API_KEY, PROVIDER, 'provider key preserved by value');
  assert.equal(out.MCP_TOOL_TIMEOUT, '120000', 'seat timeout set');
  assert.ok(Object.hasOwn(out, 'CHATROOM_HUMAN_TOKEN') === false, 'frozen input never mutated');
  assert.equal(Object.hasOwn(frozen, 'CHATROOM_HUMAN_TOKEN'), true, 'frozen input still has its key');
});
await test('seat dotenv cannot bypass exclusion via unexpected key', async () => {
  const h = await harness('openrouter', {}, ['-p', 'synthetic prompt']);
  assert.ok(Object.hasOwn(h.env, 'CHATROOM_HUMAN_TOKEN') === false, 'dotenv exclusion still enforced for token');
});
await test('loadDotEnv exclusion option: token omitted, others loaded', async () => {
  const h = await harness('env', {});
  const loaded = h.exports.loadDotEnv(undefined, { exclude: ['CHATROOM_HUMAN_TOKEN'] });
  assert.ok(loaded.includes('OPENROUTER_API_KEY') && !loaded.includes('CHATROOM_HUMAN_TOKEN'));
  assert.equal(Object.hasOwn(h.env, 'CHATROOM_HUMAN_TOKEN'), false);
  assert.equal(h.env.OPENROUTER_API_KEY, PROVIDER);
  const reloaded = h.exports.loadDotEnv(undefined, { exclude: ['CHATROOM_HUMAN_TOKEN'] });
  assert.equal(reloaded.length, 0); // existing values are never overridden
});
console.log(`SEAT ENV: ${failures ? `${failures} failed` : 'OK'} (synthetic only; minimization, NOT sandboxing)`);
process.exitCode = failures ? 1 : 0;

// Commit attribution at the actual subprocess boundaries, not source-string checks.
const gitKeys = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];
const humanIdentity = Object.fromEntries(gitKeys.map(k => [k, `inherited-${k}`]));
function checkIdentity(call: Capture, name?: string) {
  for (const key of gitKeys) assert.equal(call.options.env[key], name ? (key.endsWith('EMAIL') ? `${name}@swarm.local` : name) : humanIdentity[key], key);
}
for (const agent of ['claude', 'codex', 'openrouter']) for (const canEdit of [false, true]) await test(`authorship spawner ${agent} canEdit=${canEdit}`, async () => {
  const h = await harness('spawner', { ...syntheticEnv(), ...humanIdentity }, [], 'success');
  const spawner = new h.exports.Spawner({ mcpUrl: 'http://synthetic.invalid/mcp', defaultCwd: '/fixture', logDir: '/fixture/logs' });
  spawner.request({ room: 'synthetic-room', requestedBy: 'parent', brief: 'Verify synthetic commit attribution only', agent, name: 'seat-abc', canEdit });
  assert.equal(h.calls.length, 1); checkIdentity(h.calls[0], canEdit ? 'seat-abc' : undefined);
});
for (const worktrees of ['none', 'success', 'fail'] as const) for (const full of [false, true]) await test(`authorship swarm full=${full} worktrees=${worktrees}`, async () => {
  const h = await harness('swarm', { ...syntheticEnv(), ...humanIdentity }, ['synthetic task', '--flat', '--agents', '4', '--codex', '1', '--openrouter', '1', ...(full ? ['--full-access'] : [])], worktrees);
  const seats = h.calls.filter(c => !c.args.some(a => a.endsWith('/dist/index.js')));
  assert.equal(seats.length, 4);
  for (const call of seats) {
    const name = path.basename(call.options.cwd);
    const worker = call.options.cwd.includes('/.swarm-worktrees/');
    checkIdentity(call, worker && full && worktrees === 'success' ? name : undefined);
  }
  assert.equal(seats.filter(c => c.options.cwd.includes('/.swarm-worktrees/')).length, full && worktrees === 'success' ? 3 : 0);
});
await test('authorship planner initializes before workers, no identity injection', async () => {
  const h = await harness('swarm', { ...syntheticEnv(), ...humanIdentity }, ['synthetic task', '--agents', '4', '--full-access'], 'success');
  const seats = h.calls.filter(c => !c.args.some(a => a.endsWith('/dist/index.js')));
  assert.equal(seats.length, 5);
  checkIdentity(seats[0]); // planner runs before worker worktrees exist
  checkIdentity(seats[1]); // verifier is never a worker
});
console.log(`SEAT ENV + AUTHORSHIP: ${failures ? `${failures} failed` : 'OK'}`);
process.exitCode = failures ? 1 : 0;
