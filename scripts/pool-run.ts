/** `pool run`: launch one setup of the pool-throughput study (docs/experiments/2026-09-23-pool-throughput.md) against a
 * hash-locked pool. Solo and split seats are `claude -p` seats launched the way bench-build-runner does
 * (runClaudeSeat: stream-json, deadline kill, partial usage); rooms are dist/swarm.js --flat on a private hub this
 * script starts and stops. Everything lands in <scratch>/<pool>/<arm>-rep<N>/ (board "layout" in swarm-125917-q12c):
 * run.json, briefs/, seats/<seat>/{transcript.jsonl,stderr.log,sessions/}, wt/<seat>/, room/.
 *
 * The run never reads the hidden side of the pool: briefs come from pool.json alone, and every variable whose value
 * names the hidden root is dropped from the environment of seats, the hub and the launcher.
 *
 * CLI: scripts/pool.ts run. Fake-seat mode (--fake-solutions FILE) puts a stub `claude` first on PATH: it commits each item named in its
 * brief from the fixture's solutions (never reference.patch) and emits stream-json usage, so the whole path runs
 * offline with no model call. */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeArgs } from '../src/claude-args.js';
import { carrySettings } from '../src/env.js';
import { delay, json, runClaudeSeat, stop, track, type SeatRecord } from './bench-build-runtime.ts';
import { estimateSeatCost, type MessageUsage } from './seat-cost-estimate.ts';
import { accountAt, extractSwitches } from './paper-account-regime.ts';
import { hiddenRoot, loadPool, worktreeAt, type Pool } from './pool-format.ts';

const here = dirname(fileURLToPath(import.meta.url)), repoRoot = resolve(here, '..');
export const MODEL = 'claude-opus-5-5';
export const ARMS = ['solo', 'split', 'room3', 'room15'] as const;
export type Arm = typeof ARMS[number];
const ROOM_AGENTS: Record<string, number> = { room3: 4, room15: 15 };
/** Full access for a seat without a room: the same built-in tools a swarm --full-access worker gets, minus chatroom MCP. */
const SEAT_TOOLS = ['Read', 'Grep', 'Glob', 'Bash', 'WebSearch', 'WebFetch', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
export const ROOM_BRIEF_LINE = 'Organise yourselves; integrate onto one branch before the deadline.';
/** After the deadline the launcher gets this long to write its report; every seat is already stopped. */
const REPORT_GRACE_MS = 60_000;

export const runName = (arm: string, rep: number) => `${arm}-rep${rep}`;
export const seatBranch = (pool: string, arm: string, rep: number, seat: string) => `pool/${pool}/${runName(arm, rep)}/${seat}`;
/** Claude Code keeps a session's transcript under projects/<cwd with every non-alphanumeric character as '-'>. */
export const projectSlug = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, '-');

export function briefFor(pool: Pool, arm: Arm, opts: { seatIndex?: number; integrationBranch: string }): string {
  const ids = arm === 'split' ? pool.split[opts.seatIndex ?? 0] : pool.items.map(i => i.id);
  const items = pool.items.filter(i => ids.includes(i.id));
  const lines = [
    'You are working in a git repository checked out at a fixed base commit (your working directory).',
    `Implement the following ${items.length} item${items.length === 1 ? '' : 's'}:`,
    '',
    ...items.map(i => `- [${i.id}] ${i.title}: ${i.brief}`),
    '',
    `Deadline: you have ${pool.deadline_min} minutes from now. At the deadline every process is stopped; only committed work counts.`,
    'Make one commit per item, with the item id in the commit message (for example "' + items[0]?.id + ': <summary>"). Keep the project\'s existing tests passing.',
  ];
  if (arm === 'room3' || arm === 'room15') lines.push(
    '',
    ROOM_BRIEF_LINE,
    `The integration branch must be named exactly \`${opts.integrationBranch}\` in this repository (create it with git branch); it is what gets scored. If it does not exist at the deadline, the worker branches are merged in a fixed order instead.`,
  );
  return lines.join('\n') + '\n';
}

/** No brief a builder sees may name the hidden side. */
export function assertBriefClean(brief: string, forbidden: string[]) {
  for (const f of ['reference.patch', ...forbidden]) if (f && brief.includes(f)) throw new Error(`brief leaks hidden material: ${f}`);
}

const realOrParent = (p: string): string => { let q = resolve(p); while (!existsSync(q)) q = dirname(q); return join(realpathSync(q), relative(q, resolve(p))); };
const inside = (child: string, parent: string) => child === parent || child.startsWith(parent + sep);

/** Environment for every child: no variable that names the hidden root, no inherited hub credentials. */
export function scrubbedEnv(hidden: string[], env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === 'POOL_HIDDEN_ROOT' || k.startsWith('CHATROOM_')) continue;
    if (v !== undefined && hidden.some(h => h && v.includes(h))) continue;
    out[k] = v;
  }
  return out;
}

export interface RunOptions {
  poolDir: string; arm: Arm; rep: number; scratch: string;
  /** Overrides pool.deadline_min (dry runs only; recorded as deadline_override_ms). */
  deadlineMs?: number;
  switchLog?: string;
  fake?: { solutions: string; mode?: 'commit' | 'hang'; session?: boolean; integrate?: boolean };
  /** Where Claude Code keeps projects/ (default $CLAUDE_CONFIG_DIR or ~/.claude); fake seats write there. */
  claudeConfigDir?: string;
  port?: number;
  hubEntry?: string; swarmEntry?: string;
}

interface SeatRow {
  name: string; branch: string | null; worktree: string; brief_path: string; transcript: string | null; sessions: string[];
  exit_code: number | null; killed_by_deadline: boolean; usage: unknown; partial_usage: unknown;
  cost_usd: number | null; cost_estimated: boolean; cost_estimate_basis?: string; cost_estimate_reason?: string; skipped?: string;
}

export async function runArm(o: RunOptions): Promise<string> {
  if (!ARMS.includes(o.arm)) throw new Error(`arm must be one of ${ARMS.join('|')}`);
  if (!Number.isInteger(o.rep) || o.rep < 1) throw new Error('rep must be a positive integer');
  const { pool, sha256 } = loadPool(o.poolDir);
  const repo = realpathSync(resolve(o.poolDir, pool.repo));
  const scratch = realOrParent(o.scratch);
  for (const r of [repo, realpathSync(repoRoot)]) if (inside(scratch, r)) throw new Error(`scratch root must be outside ${r}`);
  const runDir = join(scratch, pool.name, runName(o.arm, o.rep));
  if (existsSync(runDir)) throw new Error(`refusing to reuse run dir ${runDir}`);
  for (const d of ['briefs', 'seats', 'wt']) mkdirSync(join(runDir, d), { recursive: true });

  const hidden = [hiddenRoot(pool.name), process.env.POOL_HIDDEN_ROOT ?? '', join(homedir(), '.agent-chatroom-hidden')].filter(Boolean);
  const deadlineMs = o.deadlineMs ?? pool.deadline_min * 60_000;
  const configDir = o.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  let env = scrubbedEnv(hidden);
  if (o.fake) {
    const bin = join(runDir, 'fake-bin'); mkdirSync(bin);
    writeFileSync(join(bin, 'claude'), FAKE_CLAUDE); chmodSync(join(bin, 'claude'), 0o755);
    env = { ...env, PATH: bin + ':' + (env.PATH ?? ''), POOL_FAKE_SOLUTIONS: resolve(o.fake.solutions), POOL_FAKE_MODE: o.fake.mode ?? 'commit',
      POOL_FAKE_SESSION: o.fake.session ? '1' : '', POOL_FAKE_INTEGRATE: o.fake.integrate ? '1' : '', CLAUDE_CONFIG_DIR: configDir };
  }
  const integrationBranch = seatBranch(pool.name, o.arm, o.rep, 'integration');
  const started = Date.now(), deadlineAt = started + deadlineMs;
  const run: any = {
    pool: pool.name, pool_dir: realpathSync(o.poolDir), pool_sha256: sha256, arm: o.arm, rep: o.rep, repo, base_commit: pool.base_commit, deadline_min: pool.deadline_min,
    deadline_override_ms: o.deadlineMs ?? null, model: MODEL, started_at: new Date(started).toISOString(), deadline_at: new Date(deadlineAt).toISOString(),
    ended_at: null, account: accountRecord(o.switchLog ?? process.env.POOL_SWITCH_LOG, started), fake: !!o.fake, seats: [] as SeatRow[], room: null,
  };
  const writeRun = () => json(join(runDir, 'run.json'), run);
  writeRun();

  const prepare = (seat: string, brief: string) => {
    assertBriefClean(brief, hidden);
    const wt = join(runDir, 'wt', seat), branch = seatBranch(pool.name, o.arm, o.rep, seat);
    worktreeAt(repo, pool.base_commit, wt, branch);
    // Same as swarm.ts workerCwd: a worktree has no node_modules, so link the checkout's for builds and tests.
    if (existsSync(join(repo, 'node_modules')) && !existsSync(join(wt, 'node_modules'))) symlinkSync(join(repo, 'node_modules'), join(wt, 'node_modules'), 'dir');
    const briefPath = join(runDir, 'briefs', seat + '.txt'); writeFileSync(briefPath, brief);
    mkdirSync(join(runDir, 'seats', seat), { recursive: true });
    return { wt, branch, briefPath };
  };

  if (o.arm === 'solo' || o.arm === 'split') {
    const names = o.arm === 'solo' ? ['solo'] : ['split-1', 'split-2', 'split-3'];
    const mcp = join(runDir, 'mcp-empty.json'); json(mcp, { mcpServers: {} });
    const rows = await Promise.all(names.map(async (name, k) => {
      const { wt, branch, briefPath } = prepare(name, briefFor(pool, o.arm, { seatIndex: k, integrationBranch }));
      // A third with no items (the two-item dry-run pool) gets its branch but no seat: there is nothing to brief.
      if (!pool.split[k]?.length && o.arm === 'split') return { name, branch, worktree: wt, brief_path: briefPath, transcript: null, sessions: [], exit_code: null, killed_by_deadline: false,
        usage: null, partial_usage: null, cost_usd: 0, cost_estimated: false, skipped: 'no items in this third' } as SeatRow;
      const argv = claudeArgs({ text: readFileSync(briefPath, 'utf8'), mcpJson: mcp, tools: SEAT_TOOLS, model: MODEL, outputFormat: 'stream-json', settings: carrySettings(true, '') });
      const transcript = join(runDir, 'seats', name, 'transcript.jsonl');
      const record = await runClaudeSeat(name, argv, wt, Math.max(1, deadlineAt - Date.now()), { env, transcript });
      writeFileSync(join(runDir, 'seats', name, 'stderr.log'), record.stderr_tail);
      json(join(runDir, 'seats', name, 'record.json'), record);
      return seatRow(name, branch, wt, briefPath, transcript, record);
    }));
    run.seats = rows;
  } else {
    await runRoom(o, pool, runDir, env, deadlineAt, integrationBranch, prepare, run, writeRun);
  }
  // Session transcripts carry every tool call; the audit reads them from inside the run dir.
  collectSessions(configDir, runDir, run);
  run.ended_at = new Date().toISOString();
  writeRun();
  return runDir;
}

function seatRow(name: string, branch: string | null, wt: string, briefPath: string, transcript: string | null, record: SeatRecord): SeatRow {
  const row: SeatRow = { name, branch, worktree: wt, brief_path: briefPath, transcript, sessions: [], exit_code: record.exit_code, killed_by_deadline: record.killed_by_deadline,
    usage: record.usage, partial_usage: record.partial_usage, cost_usd: record.usage?.cost ?? null, cost_estimated: false };
  if (!record.usage) Object.assign(row, estimateFrom(transcript ? readFileSync(transcript, 'utf8') : '', [...(record.reported_models?.assistant ?? []), ...(record.reported_models?.system_init ?? [])]));
  return row;
}

/** Cost of a seat without a terminal `result` event: its observed per-message usage at list price, always marked an estimate. */
export function estimateFrom(ndjson: string, reported: string[]): Pick<SeatRow, 'cost_usd' | 'cost_estimated' | 'cost_estimate_basis' | 'cost_estimate_reason'> & { partial_usage?: unknown } {
  const observed: { id?: string; usage: MessageUsage }[] = [];
  const models = new Set(reported);
  for (const line of ndjson.split('\n')) {
    let e: any; try { e = JSON.parse(line); } catch { continue; }
    if (e?.type === 'assistant' && e.message?.usage) { observed.push({ id: e.message.id, usage: e.message.usage }); if (e.message.model) models.add(e.message.model); }
  }
  const est = estimateSeatCost(observed, [...models].filter(m => m !== '<synthetic>'), MODEL);
  if (est) return { cost_usd: est.usd, cost_estimated: true, cost_estimate_basis: est.basis };
  return { cost_usd: null, cost_estimated: true, cost_estimate_reason: observed.length ? `no list-price row for ${[...models].join(',') || MODEL} in scripts/seat-cost-estimate.ts` : 'no usage observed before the seat stopped' };
}

function accountRecord(path: string | undefined, at: number) {
  if (!path) return { account: null, source: null, reason: 'no switch log given (--switch-log or POOL_SWITCH_LOG)' };
  if (!existsSync(path)) return { account: null, source: path, reason: 'switch log not found' };
  const switches = extractSwitches(readFileSync(path, 'utf8'));
  const account = accountAt(switches, at);
  return { account, source: path, reason: account === null ? 'no switch recorded in the log' : null, switches_seen: switches.length };
}

/** Copies every Claude Code session whose cwd lies under the run dir into seats/<seat>/sessions/, and for rooms
 * adds one seat row per session (name from its worktree), since swarm seats report no per-seat usage of their own. */
function collectSessions(configDir: string, runDir: string, run: any) {
  const projects = join(configDir, 'projects');
  if (!existsSync(projects)) return;
  const prefix = projectSlug(runDir);
  for (const dir of readdirSync(projects).filter(d => d.startsWith(prefix)).sort()) {
    for (const file of readdirSync(join(projects, dir)).filter(f => f.endsWith('.jsonl')).sort()) {
      const src = join(projects, dir, file), text = readFileSync(src, 'utf8');
      let seat = run.seats.find((s: SeatRow) => projectSlug(s.worktree) === dir && !run.room);
      if (!seat) {
        const label = roomSeatLabel(dir, prefix);
        let name = label, n = 1;
        while (run.seats.some((s: SeatRow) => s.name === name)) name = `${label}-${++n}`;
        seat = { name, branch: null, worktree: dir, brief_path: null, transcript: null, sessions: [], exit_code: null, killed_by_deadline: null, usage: null, partial_usage: null,
          ...estimateFrom(text, []) };
        run.seats.push(seat);
      }
      const out = join(runDir, 'seats', seat.name, 'sessions'); mkdirSync(out, { recursive: true });
      cpSync(src, join(out, file));
      seat.sessions.push(join(out, file));
      seat.transcript ??= join(out, file);
    }
  }
}
const roomSeatLabel = (dir: string, prefix: string) => {
  const rest = dir.slice(prefix.length);
  const m = /--swarm-worktrees-swarm-[0-9]+-[a-z0-9]+-(.+)$/.exec(rest);
  return m ? m[1] : 'room';
};

async function freePort(): Promise<number> {
  const s = createServer(); await new Promise<void>(ok => s.listen(0, '127.0.0.1', ok));
  const port = (s.address() as { port: number }).port; await new Promise<void>(ok => s.close(() => ok())); return port;
}
const git = (cwd: string, ...args: string[]) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
/** Every live process in a group except its leader: the seats a launcher or hub started. */
function killGroupMembers(leader: ChildProcess | null) {
  if (!leader?.pid) return;
  const r = spawnSync('pgrep', ['-g', String(leader.pid)], { encoding: 'utf8' });
  for (const pid of (r.stdout ?? '').split('\n').map(Number).filter(p => p && p !== leader.pid)) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  setTimeout(() => { for (const pid of (spawnSync('pgrep', ['-g', String(leader.pid)], { encoding: 'utf8' }).stdout ?? '').split('\n').map(Number).filter(p => p && p !== leader.pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} } }, 2000).unref();
}
const exited = (c: ChildProcess) => new Promise<void>(ok => { if (c.exitCode !== null || c.signalCode !== null) ok(); else c.once('exit', () => ok()); });

async function runRoom(o: RunOptions, pool: Pool, runDir: string, env: NodeJS.ProcessEnv, deadlineAt: number, integrationBranch: string,
  prepare: (seat: string, brief: string) => { wt: string; branch: string; briefPath: string }, run: any, writeRun: () => void) {
  const agents = ROOM_AGENTS[o.arm];
  const { wt, branch, briefPath } = prepare('room', briefFor(pool, o.arm, { integrationBranch }));
  const roomDir = join(runDir, 'room'); for (const d of ['data', 'spawned']) mkdirSync(join(roomDir, d), { recursive: true });
  const port = o.port ?? await freePort();
  const hubEntry = o.hubEntry ?? join(repoRoot, 'dist', 'index.js'), swarmEntry = o.swarmEntry ?? join(repoRoot, 'dist', 'swarm.js');
  const hubEnv = { ...env, PORT: String(port), HOST: '127.0.0.1', CHATROOM_INSECURE_LOCAL: '1', CHATROOM_DATA_DIR: join(roomDir, 'data'), CHATROOM_DEFAULT_CWD: wt,
    CHATROOM_LOG_DIR: join(roomDir, 'spawned'), CHATROOM_MAX_LIVE_PER_ROOM: String(Math.max(12, agents)) };
  const hubFd = openSync(join(roomDir, 'hub.log'), 'w');
  // detached: the hub leads its own process group, so recruits it spawns can be stopped at the deadline
  const hub = track(spawn(process.execPath, [hubEntry], { cwd: wt, env: hubEnv, detached: true, stdio: ['ignore', hubFd, hubFd] }), true);
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  for (const until = Date.now() + 30_000; Date.now() < until && hub.exitCode === null;) {
    try { if ((await fetch(url + '/rooms', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await delay(100);
  }
  const minutes = (deadlineAt - Date.now()) / 60_000;
  const argv = [swarmEntry, readFileSync(briefPath, 'utf8'), '--flat', '--agents', String(agents), '--models', MODEL, '--verifier-model', MODEL,
    '--full-access', '--require-verification', '--no-carry', '--cwd', wt, '--port', String(port), '--timeout', String(Math.max(0.05, minutes))];
  run.room = { port, worktree: wt, branch, data_dir: join(roomDir, 'data'), log_dir: join(roomDir, 'spawned'), hub_log: join(roomDir, 'hub.log'), argv: argv.slice(1).map((a, i) => i === 0 ? '<brief>' : a),
    swarm_id: null as string | null, swarm_dir: null as string | null, integration_branch: integrationBranch, declared_branch: null as string | null, worker_branches: [] as string[],
    swarm_usage: null as unknown, stopped_at_deadline: false };
  writeRun();
  let swarm: ChildProcess | null = null;
  try {
    if (!ready) throw new Error('hub did not start');
    const logFd = openSync(join(roomDir, 'swarm.log'), 'w');
    swarm = track(spawn(process.execPath, argv, { cwd: wt, env: { ...env, CHATROOM_INSECURE_LOCAL: '1' }, detached: true, stdio: ['ignore', logFd, logFd] }), true);
    const done = exited(swarm);
    let timer: NodeJS.Timeout | undefined;
    const atDeadline = await Promise.race([done.then(() => false), new Promise<boolean>(ok => { timer = setTimeout(() => ok(true), Math.max(0, deadlineAt - Date.now())); })]);
    clearTimeout(timer);
    if (atDeadline) {
      // Stop every seat now (swarm's own --timeout does the same for its children); recruits belong to the hub's group.
      run.room.stopped_at_deadline = true;
      killGroupMembers(swarm); killGroupMembers(hub);
      let grace: NodeJS.Timeout | undefined;
      await Promise.race([done, new Promise<void>(ok => { grace = setTimeout(ok, REPORT_GRACE_MS); })]);
      clearTimeout(grace);
    }
    closeSync(logFd);
  } finally {
    if (swarm) await stop(swarm);
    killGroupMembers(hub);
    await stop(hub);
    closeSync(hubFd);
  }
  const id = /swarm (swarm-[0-9]+-[a-z0-9]+):/.exec(readFileSync(join(roomDir, 'swarm.log'), 'utf8'))?.[1] ?? null;
  run.room.swarm_id = id;
  if (id) {
    const src = join(repoRoot, 'swarms', id), dest = join(roomDir, 'swarm');
    if (existsSync(src)) { try { renameSync(src, dest); } catch { cpSync(src, dest, { recursive: true }); rmSync(src, { recursive: true, force: true }); } run.room.swarm_dir = dest; }
    try { run.room.swarm_usage = JSON.parse(readFileSync(join(dest, 'result.json'), 'utf8')).usage ?? null; } catch {}
    const listed = git(wt, 'branch', '--list', `swarm/${id}/*`, '--format=%(refname:short)').stdout.split('\n').filter(Boolean);
    run.room.worker_branches = listed.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  }
  run.room.declared_branch = git(wt, 'rev-parse', '--verify', '--quiet', `refs/heads/${integrationBranch}`).status === 0 ? integrationBranch : null;
}

/** Stub `claude` for fake-seat mode. Commits every item its brief names from POOL_FAKE_SOLUTIONS ({id:{path,content}}),
 * one commit per item with the id in the message; `hang` stays alive past any deadline after one assistant event. In a
 * room it commits only from a swarm worker worktree, and with POOL_FAKE_INTEGRATE the first worker declares the
 * integration branch named in the brief. */
export const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const argv = process.argv.slice(2), prompt = argv[argv.indexOf('-p') + 1] || '';
const stream = argv.includes('stream-json'), model = argv[argv.indexOf('--model') + 1] || 'claude-opus-5-5';
const out = (e) => { if (stream) process.stdout.write(JSON.stringify(e) + '\\n'); };
const cwd = process.cwd(), msgId = 'msg_' + crypto.randomBytes(4).toString('hex');
const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
out({ type: 'system', subtype: 'init', model });
out({ type: 'assistant', message: { id: msgId, model, usage, content: [{ type: 'text', text: 'working' }] } });
if (process.env.POOL_FAKE_SESSION) {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, crypto.randomUUID() + '.jsonl'), JSON.stringify({ type: 'user', cwd, message: { role: 'user', content: prompt } }) + '\\n' + JSON.stringify({ type: 'assistant', cwd, message: { id: msgId, model, usage } }) + '\\n');
}
if (process.env.POOL_FAKE_MODE === 'hang') { setInterval(() => {}, 1000); return; }
const inRoom = /Organise yourselves/.test(prompt);
const git = (...a) => cp.spawnSync('git', a, { cwd, encoding: 'utf8' });
if (!inRoom || cwd.includes(path.sep + '.swarm-worktrees' + path.sep)) {
  const solutions = JSON.parse(fs.readFileSync(process.env.POOL_FAKE_SOLUTIONS, 'utf8'));
  for (const m of prompt.matchAll(/^- \\[([A-Za-z0-9_.-]+)\\]/gm)) {
    const s = solutions[m[1]]; if (!s) continue;
    fs.mkdirSync(path.dirname(path.join(cwd, s.path)), { recursive: true });
    fs.writeFileSync(path.join(cwd, s.path), s.content);
    git('add', '--', s.path); git('commit', '-q', '-m', m[1] + ': fake fix');
  }
  const b = /named exactly \`([^\`]+)\`/.exec(prompt);
  if (inRoom && b && process.env.POOL_FAKE_INTEGRATE) git('branch', b[1]);
}
const result = { type: 'result', subtype: 'success', is_error: false, result: 'done', num_turns: 1, total_cost_usd: 0.001, modelUsage: { [model]: {} }, usage };
process.stdout.write(JSON.stringify(result) + '\\n');
`;
