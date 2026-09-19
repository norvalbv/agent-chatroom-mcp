/** Stage-aware build executor. bench-build computes scores using the frozen oracle. */
import { spawn, execFileSync } from 'node:child_process';
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { claudeArgs } from '../src/claude-args.js';
import { rollupUsage } from '../src/result.js';
import { Hub } from '../src/hub.js';
import { delay, hashFile, hashTree, hashWorkspace, WORKSPACE_HASH_SCRIPT, json, revision, runClaudeSeat, stop, track, type SeatRecord } from './bench-build-runtime.ts';
const here = dirname(fileURLToPath(import.meta.url)), repoRoot = resolve(here, '..');
const baseTools = ['Read', 'Edit', 'Write', 'MultiEdit', 'Bash', 'Glob', 'Grep'];
type Effort = { level: string; settings_path: string; settings_sha256: string | null; own_git_root: boolean };
type RunSeat = SeatRecord & { budget_usd: number; effort: Effort; thinking_tokens: number | null };
function pinEffort(workspace: string, level: string): Effort {
  // Same mechanism calibrated in swarm-191130-twok. No git config writes.
  execFileSync('git', ['init', '--quiet', workspace], { stdio: 'pipe' });
  mkdirSync(join(workspace, '.claude'), { recursive: true });
  const settings = join(workspace, '.claude', 'settings.json');
  json(settings, { effortLevel: level });
  const actual = execFileSync('git', ['-C', workspace, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  if (realpathSync(actual) !== realpathSync(workspace)) throw new Error('effort workspace is not its own git root');
  return { level, settings_path: '.claude/settings.json', settings_sha256: hashFile(settings), own_git_root: true };
}
function thinking(record: SeatRecord): number | null {
  if (!record.model_usage || !Object.keys(record.model_usage).length) return null;
  const values = Object.values(record.model_usage).map((m: any) => m?.thinkingTokens ?? m?.thinking_tokens ?? m?.reasoningTokens ?? m?.reasoning_tokens);
  return values.every(v => Number.isFinite(v) && v >= 0) ? values.reduce((a, b) => a + b, 0) : null;
}
export function classifyBuildFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('tamper:')) return 'tamper';
  if (message.startsWith('invalid_room:')) return 'invalid_room';
  if (message.startsWith('timeout:')) return 'timeout';
  return 'infrastructure_error';
}
export function validateBuildRoom(dataDir: string, count: number, workspace: string) {
  const replay = new Hub({ dataDir }), room = replay.getRoom('build');
  const proposal = room.conclusion ? room.proposals.get(room.conclusion.proposalId) : undefined;
  const verify = proposal && room.requireVerification ? replay.verifiedBy(room, proposal) : undefined;
  const author = proposal ? room.participants.get(proposal.by.id) : undefined;
  const reviewer = verify ? [...room.participants.values()].find(p => p.name === verify.by) : undefined;
  const distinct = !!author?.session && !!reviewer?.session && author.session !== reviewer.session;
  const assigned = !!author && !!reviewer && [...room.board.entries()].some(([key, entry]) => key.startsWith('claim/') && entry.by === author.name && entry.reviewerId === reviewer.id);
  const sessions = new Set([...room.participants.values()].map(p => p.session).filter(Boolean)).size;
  const policy = room.requireVerification === true && room.requireChallenge === true && room.quorum === 'supermajority' && room.expectedParticipants === count;
  let artifactHash: string | null = null;
  try { artifactHash = JSON.parse(verify?.text.split('\n')[0] ?? '{}').workspace_sha256 ?? null; } catch {}
  const finalHash = hashWorkspace(workspace);
  const artifactMatches = typeof artifactHash === 'string' && /^[a-f0-9]{64}$/.test(artifactHash) && artifactHash === finalHash;
  return { assigned_reviewer: assigned, required_policy: policy, verified_workspace_sha256: artifactHash, final_workspace_sha256: finalHash, artifact_matches: artifactMatches, state: room.state, proposal_id: proposal?.id ?? null,
    verified: room.state === 'concluded' && !!verify && distinct && assigned && sessions >= count && policy && artifactMatches,
    verifier_session_distinct: distinct, distinct_sessions: sessions,
    verification_by: verify?.by ?? null, conclusion: room.conclusion ?? null };
}
async function main() {
  const [taskArg, arm, seedArg, ...args] = process.argv.slice(2);
  const flag = (key: string, fallback?: string) => { const n = args.indexOf('--' + key); return n < 0 ? fallback : args[n + 1]; };
  if (!taskArg || !['A', 'B', 'C'].includes(arm) || !Number.isInteger(Number(seedArg))) throw new Error('usage TASK A|B|C SEED --root DIR --max-budget-usd N');
  const cap = Number(flag('max-budget-usd')), deadlineMs = Number(flag('deadline-ms', flag('timeout-ms', '900000')));
  const effortLevel = flag('effort', 'medium')!, count = Number(flag('seats', '4')), port = Number(flag('port', '19850'));
  if (!(cap > 0 && Number.isFinite(cap))) throw new Error('positive --max-budget-usd required for every arm');
  if (!(deadlineMs > 0 && Number.isFinite(deadlineMs))) throw new Error('invalid deadline');
  if (!['low', 'medium', 'high'].includes(effortLevel)) throw new Error('invalid effort');
  if (arm === 'C' && count !== 4 && count !== 5) throw new Error('build room needs four or five seats');
  if (!Number.isInteger(port) || port <= 8000 || port > 65534 || port === 7717) throw new Error('invalid benchmark port');
  const rootArg = flag('root'); if (!rootArg) throw new Error('--root required');
  const root = resolve(rootArg); if (existsSync(root)) throw new Error('Refusing to reuse run root');
  const task = realpathSync(resolve(taskArg)), before = hashTree(task), model = flag('model', 'sonnet')!;
  const expectedHash = flag('expected-task-sha256');
  if (!expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash) || expectedHash !== before) throw new Error('prelaunch task hash does not match the frozen --expected-task-sha256');
  const taskId = JSON.parse(readFileSync(join(task, 'task.json'), 'utf8')).task_id;
  const brief = readFileSync(join(task, 'public', 'brief.txt'), 'utf8');
  mkdirSync(root, { recursive: true });
  const workspace = join(root, 'workspace'); cpSync(join(task, 'public'), workspace, { recursive: true });
  writeFileSync(join(workspace, '.bench-hash.mjs'), WORKSPACE_HASH_SCRIPT);
  const effort = pinEffort(workspace, effortLevel), started = Date.now(), deadlineAt = started + deadlineMs;
  const records: RunSeat[] = [];
  const emptyMcp = join(root, 'mcp-empty.json'); json(emptyMcp, { mcpServers: {} });
  let failure: string | null = null, errorText: string | null = null;
  let reviewIntegrity: any = null, roomValidation: any = null;
  let hub: ReturnType<typeof spawn> | null = null, hubFd: number | null = null;
  const generatorHashes = () => Object.fromEntries(readdirSync(here).filter(name => /^bench-build(?:-[a-z]+)?-gen\.ts$/.test(name)).sort().map(name => [name, hashFile(join(here,name))]));
  const frozenGenerators = generatorHashes();
  const build: any = { generator_hashes: frozenGenerators, head_revision: revision(repoRoot), runner_sha256: hashFile(fileURLToPath(import.meta.url)), runtime_sha256: hashFile(join(here, 'bench-build-runtime.ts')), helpers_sha256: hashTree(join(repoRoot, 'src')), hub_entry: null, hub_entry_sha256: null, hub_build_sha256: null, hub_revision: null, provenance_scope: null };
  const seat = async (name: string, prompt: string, cwd: string, budget: number, mcp = emptyMcp, tools = baseTools) => {
    if (Date.now() >= deadlineAt) throw new Error('timeout: total arm deadline exhausted');
    // The room shares one pinned workspace; only B's copy needs separate initialization.
    const settings = cwd === workspace ? effort : pinEffort(cwd, effortLevel);
    const argv = claudeArgs({ text: prompt, mcpJson: mcp, tools, model, outputFormat: 'stream-json' });
    argv.push('--max-budget-usd', String(budget));
    const record = await runClaudeSeat(name, argv, cwd, deadlineAt - Date.now());
    const full = { ...record, budget_usd: budget, effort: settings, thinking_tokens: thinking(record) };
    records.push(full); json(join(root, name + '.json'), full);
    if (hashFile(join(cwd, settings.settings_path)) !== settings.settings_sha256) throw new Error('tamper: seat changed pinned effort');
    if (record.killed_by_deadline) throw new Error('timeout: seat deadline');
    if (record.exit_code !== 0 || !record.usage) throw new Error('infrastructure_error: seat failed or spend unknown');
    return full;
  };
  const workPrompt = brief + '\nModify the source files in this working directory. File edits are your submission.';
  try {
    if (arm === 'A') await seat('single', workPrompt, workspace, cap);
    if (arm === 'B') {
      const builder = await seat('builder-1', workPrompt, workspace, cap * .5);
      const copy = join(root, 'review-workspace'); cpSync(workspace, copy, { recursive: true });
      const snapshotBefore = hashTree(workspace);
      let review: RunSeat;
      try {
        review = await seat('reviewer', `${brief}\nYou are reviewing another engineer's submission. Their final message:\n${builder.text}\nThis directory is a snapshot; edits here are not submitted. Respond exactly APPROVE or REVISE: followed by actionable corrections.`, copy, cap * .25, emptyMcp, ['Read', 'Bash', 'Glob', 'Grep']);
      } finally {
        const snapshotAfter = hashTree(workspace);
        reviewIntegrity = { workspace_sha256_before: snapshotBefore, workspace_sha256_after: snapshotAfter, unchanged: snapshotBefore === snapshotAfter };
        if (!reviewIntegrity.unchanged) throw new Error('tamper: reviewer changed scored workspace through snapshot boundary');
      }
      if (!/^APPROVE\s*$/i.test(review.text.trim())) await seat('builder-2', `${workPrompt}\nIndependent review feedback:\n${review.text}\nApply the necessary revision.`, workspace, cap * .25);
    }
    if (arm === 'C') {
      const probe = createServer();
      await new Promise<void>((ok, no) => { probe.once('error', no); probe.listen(port, '127.0.0.1', () => probe.close(() => ok())); });
      const entry = resolve(flag('hub-entry', join(repoRoot, 'dist', 'index.js'))!);
      Object.assign(build, { hub_entry: entry, hub_entry_sha256: hashFile(entry), hub_build_sha256: hashTree(dirname(entry)), hub_revision: revision(dirname(entry)), provenance_scope: 'hub-directory-tree; external dependencies excluded' });
      const dataDir = join(root, 'data'); mkdirSync(dataDir);
      const token = randomBytes(24).toString('hex'), hubEnv = { ...process.env };
      for (const key of Object.keys(hubEnv)) if (key.startsWith('CHATROOM_') || /API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)) delete hubEnv[key];
      Object.assign(hubEnv, { PORT: String(port), HOST: '127.0.0.1', CHATROOM_HUMAN_TOKEN: token, CHATROOM_NO_RECRUIT: '1', CHATROOM_DATA_DIR: dataDir, CHATROOM_DEFAULT_CWD: workspace, CHATROOM_LOG_DIR: join(root, 'spawned') });
      hubFd = openSync(join(root, 'hub.log'), 'w');
      hub = track(spawn(process.execPath, [entry], { cwd: workspace, env: hubEnv, stdio: ['ignore', hubFd, hubFd] }));
      let spawnError: unknown; hub.once('error', e => { spawnError = e; });
      const url = `http://127.0.0.1:${port}`; let ready = false;
      while (Date.now() < Math.min(deadlineAt, started + 30000)) {
        if (spawnError || hub.exitCode !== null) throw new Error('hub exited during startup: ' + spawnError);
        try { const r = await fetch(url + '/rooms', { signal: AbortSignal.timeout(1000) }); if (r.ok) { ready = true; break; } } catch {}
        await delay(50);
      }
      if (!ready) throw new Error('hub startup timed out');
      const created = await fetch(url + '/rooms/build/create', { method: 'POST', headers: { 'content-type': 'application/json', 'x-chatroom-token': token }, body: JSON.stringify({ topic: brief, expected_participants: count, quorum: 'supermajority', require_challenge: true, require_verification: true }) });
      if (!created.ok) throw new Error('room create HTTP ' + created.status);
      const mcp = join(root, 'mcp.json'); json(mcp, { mcpServers: { chatroom: { type: 'http', url: url + '/mcp' } } });
      const attempts = await Promise.allSettled(Array.from({ length: count }, (_, i) => seat('seat-' + (i + 1), `${workPrompt}\nJoin room build as seat-${i + 1}. Claim work on the board; the hub assigns reviewers. Have a non-author read and verify the final diff. Write verify/* with JSON first line {proposal,command,cwd,exit_code,output_tail} and actual exit_code 0. After tests and all edits, run node .bench-hash.mjs and add workspace_sha256 to that same JSON first line with its exact output. The final submitted workspace must match that independently verified hash; no edits afterward. Claims/evidence/proposals/votes are public; named working exchanges quiet. Use wait_for_messages hold_until_actionable=true. Leave after conclusion.`, workspace, cap / count, mcp, [...baseTools, 'mcp__chatroom__*'])));
      const rejected = attempts.find(a => a.status === 'rejected'); if (rejected?.status === 'rejected') throw rejected.reason;
      await stop(hub); hub = null;
      // Reuse the hub's verification parser and session rule, never seat prose.
      roomValidation = validateBuildRoom(dataDir, count, workspace);
      json(join(root, 'room-validation.json'), roomValidation);
      if (!roomValidation.verified) throw new Error('invalid_room: no independently verified conclusion');
    }
  } catch (error) {
    errorText = String(error);
    failure = classifyBuildFailure(error);
  } finally { if (hub) await stop(hub); if (hubFd !== null) closeSync(hubFd); }
  let after: string | null = null;
  try { after = hashTree(task); } catch (e) { failure = 'tamper'; errorText = String(e); }
  if (after !== before) failure = 'tamper';
  if (JSON.stringify(generatorHashes()) !== JSON.stringify(frozenGenerators) ||
      hashFile(fileURLToPath(import.meta.url)) !== build.runner_sha256 ||
      hashFile(join(here, 'bench-build-runtime.ts')) !== build.runtime_sha256 ||
      hashTree(join(repoRoot, 'src')) !== build.helpers_sha256 ||
      (build.hub_entry && hashTree(dirname(build.hub_entry)) !== build.hub_build_sha256)) {
    failure = 'tamper'; errorText = 'executor or served hub changed during execution';
  }
  const usage = rollupUsage(records.map(r => ({ usage: r.usage })));
  const completeCost = records.length > 0 && records.every(r => r.usage && Number.isFinite(r.usage.cost));
  const runConfig = { seed: Number(seedArg), task_sha256: before, generator_hashes: frozenGenerators,
    runner_sha256: build.runner_sha256, runtime_sha256: build.runtime_sha256, helpers_sha256: build.helpers_sha256,
    hub_build_sha256: build.hub_build_sha256, model, arm, effort_level: effortLevel,
    effort_settings_sha256: effort.settings_sha256, cap_usd: cap, deadline_ms: deadlineMs, seats: arm === 'C' ? count : null,
    allocations: arm === 'B' ? [.5, .25, .25] : arm === 'C' ? Array(count).fill(1 / count) : [1] };
  const fingerprint = createHash('sha256').update(JSON.stringify(runConfig)).digest('hex');
  const result = { run_config: runConfig, run_fingerprint: fingerprint, schemaVersion: 1, task_id: taskId, arm, seed: Number(seedArg), model, outcome: failure ?? 'completed', reason: failure ?? 'completed', error: errorText,
    anti_tamper: { hash_before: before, hash_after: after, unchanged: after === before }, effort, review_integrity: reviewIntegrity, room_validation: roomValidation, seats: records,
    usage: { ...usage, cost_usd: completeCost ? usage!.cost_usd : null }, turns: { summed: records.reduce((n, r) => n + (r.num_turns ?? 0), 0) },
    wall_clock: { started_at: new Date(started).toISOString(), completed_at: new Date().toISOString(), duration_ms: Date.now() - started },
    budget: { max_budget_usd: cap, deadline_ms: deadlineMs, allocations: arm === 'B' ? [.5, .25, .25] : arm === 'C' ? Array(count).fill(1 / count) : [1], overshoot_usd: completeCost ? Math.max(0, usage!.cost_usd - cap) : null }, build };
  json(join(root, 'result.json'), result); console.log(root);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(String(e)); process.exitCode = 1; });
