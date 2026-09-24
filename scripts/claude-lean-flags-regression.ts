/**
 * Failing-first regression for the token round of 2026-09-18 (swarm-102357-g062): a Claude Code seat's
 * first turn pays for Claude Code's own system prompt, built-in tool definitions, and the operator's
 * skills/plugins/memory, none of which a chatroom seat uses (docs/token-round-0918.md). This asserts the
 * exact lean `claude -p` argv for every seat kind the launcher and spawner produce — worker, verifier and
 * planner (src/swarm.ts runClaude) and recruit (src/spawner.ts) — and that --claude-full /
 * CHATROOM_CLAUDE_FULL=1 restores today's exact args, unchanged.
 *
 * RED on 3977211: none of --tools, --disable-slash-commands, --setting-sources or
 * --exclude-dynamic-system-prompt-sections appear on any claude seat's argv; there is no --claude-full
 * opt-out. GREEN once src/swarm.ts and src/spawner.ts add the lean flags by default.
 *
 * Hermetic: reuses the seat-env-regression.ts technique (VM executes the real TS source with synthetic
 * OS boundaries; node:child_process.spawn is captured, never invoked). No real subprocess, network,
 * credential or .env access, no real claude binary.
 * Run: NODE_OPTIONS=--experimental-vm-modules npx tsx scripts/claude-lean-flags-regression.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { StringDecoder } from 'node:string_decoder';
import { transformSync } from 'esbuild';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const HUMAN = 'synthetic-human';
const fixture = '# synthetic fixture ONLY\nCHATROOM_HUMAN_TOKEN=synthetic-human\n';
const syntheticEnv = (extra: Record<string, string> = {}) => ({ CHATROOM_HUMAN_TOKEN: HUMAN, PATH: '/synthetic/bin', HOME: '/synthetic/home', MCP_TOOL_TIMEOUT: '1', ...extra });
type Capture = { cmd: string; args: string[]; options: any; stdin?: { text: string } };

/** Same VM-with-synthetic-OS-boundaries technique as scripts/seat-env-regression.ts: real TS source for
 * env/spawner/swarm/respawn/claude-args (all pure or already covered by that file's minimization
 * regression), everything else mocked. Kept as its own copy rather than a shared import so this file's
 * only job — the lean-flags argv contract — cannot be perturbed by unrelated edits to that file. */
async function harness(entry: string, env: Record<string, string>, argv: string[] = [], opts: { hubAbsent?: boolean } = {}) {
  const calls: Capture[] = [];
  let hubAbsent = !!opts.hubAbsent; // the first fetch fails once, so swarm.ts's ensureHub spawns the hub and its env is captured
  const proc = { env, argv: ['node', entry, ...argv], execPath: '/synthetic/node', cwd: () => '/fixture', on() {}, stdout: { write() {} }, stderr: { write() {} }, exit(code: number) { if (code) throw new Error(`unexpected exit ${code}`); } };
  const fs = {
    realpathSync: (x: string) => x,
    existsSync: (f: string) => f.endsWith('.env'),
    readFileSync(f: string) {
      if (f.endsWith('.env')) return fixture;
      if (f.endsWith('/prompts/planner.md')) return 'Synthetic fixture prompt planner';
      if (f.includes('/prompts/')) return 'Synthetic fixture prompt {{NAME}} {{ROOM}} {{TOPIC}}';
      throw new Error(`unexpected fixture read: ${f}`);
    },
    mkdirSync() {}, writeFileSync() {}, createWriteStream() { return { write() { return true; }, end() {}, on() { return this; } }; }, symlinkSync() {}, readdirSync() { return []; }, statSync() { return { mtimeMs: 0 }; },
    // src/sandbox.ts (--sandbox only): no node_modules link in the synthetic fixture
    lstatSync() { throw Object.assign(new Error('synthetic: no such path'), { code: 'ENOENT' }); },
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
      if (args.includes('--is-inside-work-tree')) return { status: 0, stdout: 'false', stderr: '' };
      return { status: 1, stdout: '', stderr: '' };
    },
  };
  const context = vm.createContext({
    process: proc, console: { log() {}, error() {} }, setTimeout, clearTimeout, setInterval, clearInterval, Date, URL, AbortSignal,
    async fetch(target: string) {
      if (hubAbsent) { hubAbsent = false; throw new Error('synthetic hub absent'); }
      return { status: 200, async json() { return target.endsWith('/rooms') || target.includes('/messages?') ? [] : { caps: { max_live_per_room: 12 }, state: 'concluded', conclusion: { text: 'fixture' } }; }, async text() { return ''; } };
    },
  });
  const cache = new Map<string, any>();
  const mocks: Record<string, any> = {
    'node:fs': fs, 'node:path': path, 'node:url': url, 'node:child_process': cp, 'node:crypto': { randomUUID: () => 'synthetic-session-id' }, 'node:string_decoder': { StringDecoder }, './strays.js': { stopStrays: async () => 0 },
    './hub.js': { HubError: Error }, './settled.js': { settledAxes: () => '' }, './seat.js': { runSeat: async () => ({ final: 'fixture', ok: true }) },
    './seat-handoff-report.js': { handoffMarkerLine: () => '' },
    './result.js': { collectRoomSnapshot: async (_base: string, name: string) => ({ name, payload: { state: 'concluded', conclusion: { text: 'fixture' } }, transcript: { text: '' } }), readRunResult: () => ({}), writeRunResult: () => undefined, renderRunReport: () => '', rollupUsage: () => undefined, parseClaudeCliOutput: (raw: string) => ({ text: raw, usage: null }) },
  };
  async function module(name: string): Promise<any> {
    if (cache.has(name)) return cache.get(name);
    if (mocks[name]) {
      const values = mocks[name];
      const mod = new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
      cache.set(name, mod); return mod;
    }
    const base = name.replace(/^\.\//, '').replace(/\.js$/, '');
    // Real source for these only: swarm/spawner (under test), env/respawn (their real deps), claude-args (the shared lean-args builder, pure), sandbox (its --sandbox block, pure over the mocked fs).
    assert.ok(['env', 'spawner', 'swarm', 'respawn', 'claude-args', 'codex-seat', 'sandbox'].includes(base), `unmocked import ${name}`);
    const source = readFileSync(path.join(root, 'src', `${base}.ts`), 'utf8');
    const code = transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' }).code;
    const mod = new vm.SourceTextModule(code, { context, initializeImportMeta(meta) { meta.url = `file:///fixture/src/${base}.js`; } });
    cache.set(name, mod);
    await mod.link((specifier: string) => module(specifier));
    return mod;
  }
  const mod = await module(entry);
  await mod.evaluate();
  return { exports: mod.namespace as any, env, calls };
}

/** The four lean flags, asserted together since a partial application is not the delivered contract. */
function assertLean(call: Capture, msg: string) {
  assert.ok(call.args.includes('--disable-slash-commands'), `${msg}: --disable-slash-commands present`);
  const settingSourcesAt = call.args.indexOf('--setting-sources');
  assert.ok(settingSourcesAt >= 0 && call.args[settingSourcesAt + 1] === 'project', `${msg}: --setting-sources project`);
  assert.ok(call.args.includes('--exclude-dynamic-system-prompt-sections'), `${msg}: --exclude-dynamic-system-prompt-sections present`);
  const toolsAt = call.args.indexOf('--tools');
  assert.ok(toolsAt >= 0, `${msg}: --tools present`);
  const toolsValue = call.args[toolsAt + 1];
  assert.ok(toolsValue.length > 0 && !toolsValue.includes('mcp__'), `${msg}: --tools is the built-in-only list (no mcp__ entries; MCP is already scoped by --strict-mcp-config), got "${toolsValue}"`);
  const outputFormatAt = call.args.indexOf('--output-format');
  assert.ok(outputFormatAt >= 0 && call.args[outputFormatAt + 1] === 'json', `${msg}: --output-format json still present (usage telemetry)`);
  // Auto-memory off (the operator's MEMORY.md anchors every seat on the same prior conclusions), heartbeat hook kept.
  const settingsAt = call.args.indexOf('--settings');
  assert.ok(settingsAt >= 0, `${msg}: --settings present`);
  const settings = JSON.parse(call.args[settingsAt + 1]);
  assert.equal(settings.autoMemoryEnabled, false, `${msg}: --settings disables auto-memory`);
  assert.ok(settings.hooks?.PreToolUse, `${msg}: --settings still carries the heartbeat hook`);
}
/** --claude-full / CHATROOM_CLAUDE_FULL=1: byte-for-byte today's args, none of the four lean flags. */
function assertFull(call: Capture, msg: string) {
  for (const flag of ['--tools', '--disable-slash-commands', '--setting-sources', '--exclude-dynamic-system-prompt-sections']) {
    assert.ok(!call.args.includes(flag), `${msg}: --claude-full must omit ${flag}`);
  }
  assert.ok(call.args.includes('--mcp-config') && call.args.includes('--strict-mcp-config') && call.args.includes('--allowedTools'), `${msg}: base args intact`);
  const outputFormatAt = call.args.indexOf('--output-format');
  assert.ok(outputFormatAt >= 0 && call.args[outputFormatAt + 1] === 'json', `${msg}: --output-format json still present`);
  const settingsAt = call.args.indexOf('--settings');
  assert.ok(settingsAt < 0 || !('autoMemoryEnabled' in JSON.parse(call.args[settingsAt + 1])), `${msg}: --claude-full leaves auto-memory alone`);
}

let failures = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`); } catch (error) { failures++; console.error(`FAIL ${name}: ${(error as Error).message}`); }
}

// ---- launcher: worker, verifier, planner (src/swarm.ts runClaude) ----
await test('swarm lean by default: planner, verifier and worker all get the lean flags', async () => {
  const h = await harness('swarm', syntheticEnv(), ['synthetic task', '--agents', '4', '--full-access']);
  const seats = h.calls.filter(c => c.cmd === 'claude');
  assert.ok(seats.length >= 3, `expected planner+verifier+>=1 worker, got ${seats.length}`);
  for (const seat of seats) assertLean(seat, `swarm seat (argv: ${JSON.stringify(seat.args)})`);
});
await test('swarm --claude-full restores today\'s exact args for every claude seat', async () => {
  const h = await harness('swarm', syntheticEnv(), ['synthetic task', '--agents', '4', '--full-access', '--claude-full']);
  const seats = h.calls.filter(c => c.cmd === 'claude');
  assert.ok(seats.length >= 3, `expected planner+verifier+>=1 worker, got ${seats.length}`);
  for (const seat of seats) assertFull(seat, `swarm --claude-full seat (argv: ${JSON.stringify(seat.args)})`);
});
await test('swarm lean flags survive --flat (worker-only) runs too', async () => {
  const h = await harness('swarm', syntheticEnv(), ['synthetic task', '--flat', '--agents', '2']);
  const seats = h.calls.filter(c => c.cmd === 'claude');
  assert.ok(seats.length >= 1, 'at least the verifier is a claude seat');
  for (const seat of seats) assertLean(seat, `flat swarm seat (argv: ${JSON.stringify(seat.args)})`);
});

// ---- spawner: recruits (src/spawner.ts claude path) ----
// CHATROOM_RECRUIT_AGENT=claude: the hub's recruit policy pins every recruit's provider (defaults to
// openrouter, see policyFromEnv/spawner.ts:114) and wins over an individual request's `agent`, so a
// synthetic env with no policy override would silently launch these as openrouter, not claude.
for (const canEdit of [false, true]) await test(`spawner recruit lean by default (canEdit=${canEdit})`, async () => {
  const h = await harness('spawner', syntheticEnv({ CHATROOM_RECRUIT_AGENT: 'claude' }));
  const spawner = new h.exports.Spawner({ mcpUrl: 'http://synthetic.invalid/mcp', defaultCwd: '/fixture', logDir: '/fixture/logs' });
  spawner.request({ room: 'synthetic-room', requestedBy: 'synthetic-parent', brief: 'Lean-flags recruit regression, canEdit variant', agent: 'claude', name: 'fixture-recruit', canEdit });
  const seats = h.calls.filter(c => c.cmd === 'claude');
  assert.equal(seats.length, 1, 'exactly one claude recruit spawned');
  assertLean(seats[0], `recruit canEdit=${canEdit} (argv: ${JSON.stringify(seats[0].args)})`);
});
for (const canEdit of [false, true]) await test(`spawner recruit CHATROOM_CLAUDE_FULL=1 restores today's exact args (canEdit=${canEdit})`, async () => {
  const h = await harness('spawner', syntheticEnv({ CHATROOM_RECRUIT_AGENT: 'claude', CHATROOM_CLAUDE_FULL: '1' }));
  const spawner = new h.exports.Spawner({ mcpUrl: 'http://synthetic.invalid/mcp', defaultCwd: '/fixture', logDir: '/fixture/logs' });
  spawner.request({ room: 'synthetic-room', requestedBy: 'synthetic-parent', brief: 'Lean-flags recruit regression, canEdit variant', agent: 'claude', name: 'fixture-recruit', canEdit });
  const seats = h.calls.filter(c => c.cmd === 'claude');
  assert.equal(seats.length, 1, 'exactly one claude recruit spawned');
  assertFull(seats[0], `recruit CHATROOM_CLAUDE_FULL canEdit=${canEdit} (argv: ${JSON.stringify(seats[0].args)})`);
});
await test('spawner recruit: codex and openrouter agents are untouched by the claude lean flags', async () => {
  const h = await harness('spawner', syntheticEnv({ CHATROOM_RECRUIT_AGENT: 'any', OPENROUTER_API_KEY: 'synthetic-provider' }));
  const spawner = new h.exports.Spawner({ mcpUrl: 'http://synthetic.invalid/mcp', defaultCwd: '/fixture', logDir: '/fixture/logs' });
  spawner.request({ room: 'synthetic-room', requestedBy: 'synthetic-parent', brief: 'non-claude recruit lean-flags isolation check', agent: 'codex', name: 'fixture-codex' });
  spawner.request({ room: 'synthetic-room', requestedBy: 'synthetic-parent', brief: 'non-claude recruit lean-flags isolation check', agent: 'openrouter', name: 'fixture-openrouter' });
  const nonClaude = h.calls.filter(c => c.cmd !== 'claude');
  assert.equal(nonClaude.length, 2);
  for (const call of nonClaude) assert.ok(!call.args.includes('--disable-slash-commands'), 'lean flags are claude-only');
});

// ---- heartbeat wiring (swarm-140818-f1qy item 3): every claude seat gets the tool hook and a seat key; codex a keyed URL ----
function assertBeat(call: Capture, msg: string) {
  const key = call.options.env.CHATROOM_SEAT_KEY;
  assert.ok(key, `${msg}: CHATROOM_SEAT_KEY in the seat env`);
  assert.match(call.options.env.CHATROOM_HEARTBEAT_URL ?? '', /\/heartbeat$/, `${msg}: CHATROOM_HEARTBEAT_URL`);
  if (call.cmd === 'claude') {
    const s = JSON.parse(call.args[call.args.indexOf('--settings') + 1] ?? '{}');
    assert.match(s.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command ?? '', /heartbeat-hook\.mjs"$/, `${msg}: --settings PreToolUse heartbeat hook`);
  } else if (call.cmd === 'codex') {
    assert.ok(call.args.some(a => a.includes(`seat=${key}`)), `${msg}: codex MCP URL carries ?seat=`);
  }
}
await test('heartbeat: swarm claude and codex seats carry the seat key and hook', async () => {
  const h = await harness('swarm', syntheticEnv(), ['synthetic task', '--agents', '4', '--codex', '1', '--full-access']);
  const seats = h.calls.filter(c => c.cmd === 'claude' || c.cmd === 'codex');
  assert.ok(seats.some(c => c.cmd === 'codex') && seats.some(c => c.cmd === 'claude'));
  for (const seat of seats) assertBeat(seat, `swarm ${seat.cmd} seat`);
});
await test('heartbeat: spawner claude and codex recruits carry the seat key and hook', async () => {
  const h = await harness('spawner', syntheticEnv({ CHATROOM_RECRUIT_AGENT: 'any' }));
  const spawner = new h.exports.Spawner({ mcpUrl: 'http://synthetic.invalid/mcp', defaultCwd: '/fixture', logDir: '/fixture/logs' });
  spawner.request({ room: 'synthetic-room', requestedBy: 'synthetic-parent', brief: 'heartbeat wiring regression recruit', agent: 'claude', name: 'fixture-claude' });
  spawner.request({ room: 'synthetic-room', requestedBy: 'synthetic-parent', brief: 'heartbeat wiring regression recruit', agent: 'codex', name: 'fixture-codex' });
  assert.equal(h.calls.length, 2);
  for (const seat of h.calls) assertBeat(seat, `recruit ${seat.cmd}`);
});

// ---- --sandbox / CHATROOM_SANDBOX=1 (src/sandbox.ts; docs/reuse-survey-2026-09-23.md "OS isolation for claude seats") ----
// Default off: no claude seat carries a sandbox block and no OpenRouter seat gets --sandbox. With it on, every claude seat's
// --settings carries Claude Code's sandbox (strict, fail-closed, npm/GitHub/hub allowlist, local binding), a read-only
// seat's cwd is denied, OpenRouter seats get --sandbox, and a hub the launcher starts gets CHATROOM_SANDBOX=1 for recruits.
const sandboxOf = (call: Capture) => { const at = call.args.indexOf('--settings'); return at < 0 ? undefined : JSON.parse(call.args[at + 1]).sandbox; };
function assertSandboxed(call: Capture, write: boolean, msg: string) {
  const sb = sandboxOf(call);
  assert.ok(sb, `${msg}: --settings carries a sandbox block`);
  assert.equal(sb.enabled, true, `${msg}: enabled`);
  assert.equal(sb.allowUnsandboxedCommands, false, `${msg}: no unsandboxed retry`);
  assert.equal(sb.failIfUnavailable, true, `${msg}: fails closed`);
  assert.equal(sb.network.allowLocalBinding, true, `${msg}: loopback for the hub and dev hubs`);
  for (const d of ['registry.npmjs.org', 'github.com', '127.0.0.1:7717']) assert.ok(sb.network.allowedDomains.includes(d), `${msg}: allowlist has ${d}`);
  if (write) assert.ok(!sb.filesystem.denyWrite, `${msg}: a write seat keeps its cwd writable`);
  else assert.deepEqual(sb.filesystem.denyWrite, [call.options.cwd], `${msg}: a read-only seat's cwd is denied (its Bash is not prompt-only any more)`);
}
await test('--sandbox is off by default: no sandbox block, no --sandbox for OpenRouter seats, no CHATROOM_SANDBOX for the hub', async () => {
  const h = await harness('swarm', syntheticEnv({ OPENROUTER_API_KEY: 'synthetic-provider' }), ['synthetic task', '--agents', '4', '--full-access', '--openrouter', '1'], { hubAbsent: true });
  const claude = h.calls.filter(c => c.cmd === 'claude');
  assert.ok(claude.length >= 3);
  for (const c of claude) assert.equal(sandboxOf(c), undefined, 'no sandbox block by default');
  const or = h.calls.filter(c => c.args.some(a => a.endsWith('openrouter.ts') || a.endsWith('openrouter.js')));
  assert.equal(or.length, 1, 'one OpenRouter seat');
  assert.ok(!or[0].args.includes('--sandbox'));
  const hub = h.calls.find(c => c.args.some(a => a.endsWith('dist/index.js')));
  assert.ok(hub, 'the launcher started the hub');
  assert.equal(hub?.options.env.CHATROOM_SANDBOX, undefined);
});
await test('swarm --sandbox: every claude seat is sandboxed (read-only planner denied its cwd), OpenRouter seats and the hub follow', async () => {
  const h = await harness('swarm', syntheticEnv({ OPENROUTER_API_KEY: 'synthetic-provider' }), ['synthetic task', '--agents', '4', '--full-access', '--openrouter', '1', '--sandbox'], { hubAbsent: true });
  const claude = h.calls.filter(c => c.cmd === 'claude');
  assert.ok(claude.length >= 3, `planner+verifier+worker, got ${claude.length}`);
  for (const c of claude) {
    const toolsAt = c.args.indexOf('--allowedTools');
    assertSandboxed(c, c.args[toolsAt + 1].split(',').includes('Edit'), `swarm seat ${c.args[toolsAt + 1]}`);
    assertLean(c, 'lean flags unchanged under --sandbox');
  }
  const planner = claude.find(c => !c.args[c.args.indexOf('--allowedTools') + 1].includes('mcp__'));
  assert.ok(planner && sandboxOf(planner).filesystem.denyWrite, 'the planner (read-only) is denied its cwd');
  const or = h.calls.filter(c => c.args.some(a => a.endsWith('openrouter.ts') || a.endsWith('openrouter.js')));
  assert.equal(or.length, 1);
  assert.ok(or[0].args.includes('--sandbox'), 'the OpenRouter seat wraps run_command in sandbox-runtime');
  const hub = h.calls.find(c => c.args.some(a => a.endsWith('dist/index.js')));
  assert.equal(hub?.options.env.CHATROOM_SANDBOX, '1', 'a hub the launcher starts sandboxes its recruits too');
});
await test('swarm --sandbox --claude-full: the sandbox is kept (a boundary, not a token saving)', async () => {
  const h = await harness('swarm', syntheticEnv(), ['synthetic task', '--agents', '4', '--full-access', '--claude-full', '--sandbox']);
  const claude = h.calls.filter(c => c.cmd === 'claude');
  for (const c of claude) { assertFull(c, 'full flags'); assert.ok(sandboxOf(c)?.enabled, 'sandbox kept under --claude-full'); }
});
for (const canEdit of [false, true]) await test(`spawner CHATROOM_SANDBOX=1 sandboxes claude and OpenRouter recruits (canEdit=${canEdit})`, async () => {
  const h = await harness('spawner', syntheticEnv({ CHATROOM_RECRUIT_AGENT: 'any', CHATROOM_SANDBOX: '1', OPENROUTER_API_KEY: 'synthetic-provider' }));
  const spawner = new h.exports.Spawner({ mcpUrl: 'http://127.0.0.1:7717/mcp', defaultCwd: '/fixture', logDir: '/fixture/logs' });
  spawner.request({ room: 'synthetic-room', requestedBy: 'synthetic-parent', brief: 'sandbox wiring regression recruit', agent: 'claude', name: 'fixture-claude', canEdit });
  spawner.request({ room: 'synthetic-room', requestedBy: 'synthetic-parent', brief: 'sandbox wiring regression recruit', agent: 'openrouter', name: 'fixture-or', canEdit });
  const claude = h.calls.filter(c => c.cmd === 'claude');
  assert.equal(claude.length, 1);
  assertSandboxed(claude[0], canEdit, `recruit canEdit=${canEdit}`);
  const or = h.calls.filter(c => c.cmd !== 'claude');
  assert.equal(or.length, 1);
  assert.ok(or[0].args.includes('--sandbox'));
});
await test('spawner without CHATROOM_SANDBOX: recruits are not sandboxed', async () => {
  const h = await harness('spawner', syntheticEnv({ CHATROOM_RECRUIT_AGENT: 'claude' }));
  const spawner = new h.exports.Spawner({ mcpUrl: 'http://127.0.0.1:7717/mcp', defaultCwd: '/fixture', logDir: '/fixture/logs' });
  spawner.request({ room: 'synthetic-room', requestedBy: 'synthetic-parent', brief: 'sandbox wiring regression recruit', agent: 'claude', name: 'fixture-claude', canEdit: true });
  assert.equal(sandboxOf(h.calls[0]), undefined);
});

console.log(`CLAUDE LEAN FLAGS: ${failures ? `${failures} failed` : 'OK'}`);
process.exitCode = failures ? 1 : 0;
