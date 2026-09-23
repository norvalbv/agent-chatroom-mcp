/** finalize, score and the leakage audit for the pool-throughput study (docs/experiments/2026-09-23-pool-throughput.md).
 * Reads a run dir laid out by pool-run.ts: run.json, briefs/*, seats/<seat>/*, room/*. Writes final.json, score.json, audit.json.
 * The hidden root is never read from the run dir: score and audit take it as an argument, so nothing a builder
 * could see names it. Score worktrees holding hidden tests are removed before score returns. */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { json } from './bench-build-runtime.ts';
import { copyHiddenTests, hiddenRoot, linkNodeModules, loadHiddenItem, loadPool, removeWorktree, runCmd, worktreeAt } from './pool-format.ts';

const ITEM_TIMEOUT_MS = 10 * 60_000;
const GIT_ID = ['-c', 'user.name=pool-harness', '-c', 'user.email=pool-harness@localhost', '-c', 'commit.gpgsign=false'];
const git = (cwd: string, ...args: string[]) => spawnSync('git', ['-C', cwd, ...GIT_ID, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }); // a real repo's listings pass 1 MB (ENOBUFS)
const gitOut = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...GIT_ID, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const exists = (repo: string, ref: string) => git(repo, 'rev-parse', '--verify', '--quiet', ref + '^{commit}').status === 0;
const ahead = (repo: string, base: string, ref: string) => exists(repo, ref) && Number(gitOut(repo, 'rev-list', '--count', `${base}..${ref}`)) > 0;

export interface Conflict { branch: string; files: string[] }
export interface Final { head: string; source: 'branch' | 'integration' | 'merge'; branch: string; order: string[]; missing: string[]; conflicts: Conflict[] }

const byName = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const workerBranches = (run: any): string[] => (run.room?.worker_branches ?? run.room?.branches ?? []).filter(Boolean);

/** Branches the setup is scored on, and how: solo its branch; split its seats in split-N order; rooms the
 * declared integration branch if it moved past base, else the worker branches in name order. */
function plan(run: any): { source: Final['source']; order: string[] } {
  if (run.arm === 'solo') return { source: 'branch', order: [run.seats[0].branch] };
  if (run.arm === 'split') return { source: 'merge', order: [...run.seats].sort((a, b) => byName(a.name, b.name)).map(s => s.branch).filter(Boolean) };
  const integration = run.room?.declared_branch ?? run.room?.integration_branch;
  if (integration && ahead(run.repo, run.base_commit, integration)) return { source: 'integration', order: [integration] };
  return { source: 'merge', order: [...workerBranches(run)].sort(byName) };
}

/** Merge `order` onto base_commit in a scratch worktree. A conflicting file keeps the version already merged (the
 * earlier branch's) and is recorded; non-conflicting changes from the later branch still land. */
function mergeInOrder(run: any, runDir: string, order: string[], branch: string) {
  const wt = join(runDir, 'final-wt'), conflicts: Conflict[] = [], missing: string[] = [];
  worktreeAt(run.repo, run.base_commit, wt);
  try {
    gitOut(wt, 'checkout', '-q', '-B', branch); // -B: a rerun of the same pool/arm/rep moves the branch; final.json records the sha
    for (const b of order) {
      if (!exists(run.repo, b)) { missing.push(b); continue; }
      const m = git(wt, 'merge', '--no-ff', '--no-edit', '-m', `pool-harness: merge ${b}`, b);
      if (m.status === 0) continue;
      const files = gitOut(wt, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean).sort();
      if (!files.length) throw new Error(`merge of ${b} failed without conflicts: ${m.stderr}`);
      for (const f of files) {
        // ours = what is already merged; if ours deleted the file, keep it deleted.
        if (git(wt, 'checkout', '--ours', '--', f).status === 0) gitOut(wt, 'add', '--', f);
        else gitOut(wt, 'rm', '-q', '--', f);
      }
      gitOut(wt, 'commit', '-q', '--no-edit', '-m', `pool-harness: merge ${b} (conflicts kept earlier: ${files.join(', ')})`);
      conflicts.push({ branch: b, files });
    }
    return { head: gitOut(wt, 'rev-parse', 'HEAD'), conflicts, missing };
  } finally { removeWorktree(run.repo, wt); }
}

export function finalizeRun(runDir: string): Final {
  const run = readJson(join(runDir, 'run.json'));
  if (existsSync(join(runDir, 'final.json'))) throw new Error('final.json exists: refusing to finalize twice');
  const { source, order } = plan(run);
  const branch = `pool-final/${run.pool}/${run.arm}-rep${run.rep}`;
  let final: Final;
  if (source === 'merge') final = { source, branch, order, ...mergeInOrder(run, runDir, order, branch) };
  else {
    const present = exists(run.repo, order[0]);
    const head = present ? gitOut(run.repo, 'rev-parse', order[0]) : run.base_commit;
    gitOut(run.repo, 'branch', '-f', branch, head);
    final = { head, source, branch, order, missing: present ? [] : order, conflicts: [] };
  }
  json(join(runDir, 'final.json'), final);
  return final;
}

/** Every text file under a directory (transcripts, tool-call logs, hub data). Symlinks are not followed. */
function files(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  const st = lstatSync(dir);
  if (st.isFile()) out.push(dir);
  else if (st.isDirectory()) for (const n of readdirSync(dir)) files(join(dir, n), out);
  return out;
}

/** Needles: the hidden pool root and its parent in absolute, real and ~ forms, and every hidden test file's name. */
function needles(pool: any, hiddenParent?: string): string[] {
  const root = hiddenRoot(pool.name, hiddenParent), parent = resolve(root, '..');
  const forms = (p: string) => {
    const all = [p]; try { all.push(realpathSync(p)); } catch {}
    const home = homedir();
    for (const q of [...all]) if (q.startsWith(home + '/')) all.push('~' + q.slice(home.length));
    return all;
  };
  const names = pool.items.flatMap((i: any) => { try { return loadHiddenItem(root, i.id).tests.map((t: string) => basename(t)); } catch { return []; } });
  return [...new Set([...forms(root), ...forms(parent), ...names])].filter(n => n.length > 0);
}

export function auditRun(runDir: string, opts: { hiddenParent?: string } = {}) {
  const run = readJson(join(runDir, 'run.json'));
  const { pool } = loadPool(run.pool_dir);
  const needleList = needles(pool, opts.hiddenParent);
  const scanned = new Set<string>([...files(join(runDir, 'briefs')), ...files(join(runDir, 'seats')), ...files(join(runDir, 'room'))]);
  for (const s of run.seats ?? []) for (const t of [s.brief_path, s.transcript, ...(s.sessions ?? [])]) if (t) files(t).forEach(f => scanned.add(f));
  for (const d of [run.room?.data_dir, run.room?.log_dir, run.room?.swarm_dir, run.room?.hub_log]) if (d) files(d).forEach(f => scanned.add(f));
  const hits: { file: string; needle: string }[] = [];
  for (const file of [...scanned].sort()) {
    const text = readFileSync(file, 'utf8');
    for (const needle of needleList) if (text.includes(needle)) hits.push({ file, needle: needle === basename(needle) ? needle : '<hidden root>' });
  }
  const audit = { void: hits.length > 0, files_scanned: scanned.size, needles: needleList.length, hits };
  json(join(runDir, 'audit.json'), audit);
  return audit;
}

function attempted(run: any, final: Final, id: string): boolean {
  const refs = [final.head, ...(run.seats ?? []).map((s: any) => s.branch), ...workerBranches(run), run.room?.integration_branch].filter((r: string) => r && exists(run.repo, r));
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^A-Za-z0-9_-])${escaped}([^A-Za-z0-9_-]|$)`);
  return refs.some((r: string) => gitOut(run.repo, 'log', '--format=%B%x00', `${run.base_commit}..${r}`).split('\0').some(m => re.test(m)));
}

export function scoreRun(runDir: string, opts: { hiddenParent?: string } = {}) {
  const run = readJson(join(runDir, 'run.json'));
  const { pool, sha256 } = loadPool(run.pool_dir);
  if (sha256 !== run.pool_sha256) throw new Error('pool.json changed since the run: lock mismatch');
  const final: Final = readJson(join(runDir, 'final.json'));
  const hidden = hiddenRoot(pool.name, opts.hiddenParent);
  const scratch = join(runDir, 'score-wt'); mkdirSync(scratch, { recursive: true });
  // The project's own suite runs in a clean checkout with no hidden test present, so they cannot change its verdict.
  const suiteWt = join(scratch, 'suite'), testWt = join(scratch, 'hidden');
  const suiteCmd = pool.suite_cmd ?? 'npm test';
  let suite, items;
  worktreeAt(run.repo, final.head, suiteWt);
  linkNodeModules(run.repo, suiteWt);
  try {
    const r = runCmd(suiteCmd, suiteWt, ITEM_TIMEOUT_MS);
    suite = { cmd: suiteCmd, exit_code: r.exit_code, pass: r.exit_code === 0, output_tail: r.output_tail };
  } finally { removeWorktree(run.repo, suiteWt); }
  worktreeAt(run.repo, final.head, testWt);
  try {
    const hiddenItems = pool.items.map((i: any) => loadHiddenItem(hidden, i.id));
    // One item at a time: only its own hidden tests are present when its cmd runs; then back to the clean head
    // (clean -fd keeps ignored files such as the node_modules link, which is relinked if a non-ignoring repo lost it).
    items = pool.items.map((i: any, n: number) => {
      linkNodeModules(run.repo, testWt);
      copyHiddenTests(hiddenItems[n], testWt); // tests only; reference.patch is never copied
      const r = runCmd(hiddenItems[n].cmd, testWt, ITEM_TIMEOUT_MS);
      gitOut(testWt, 'reset', '-q', '--hard'); gitOut(testWt, 'clean', '-fdq');
      return { id: i.id, pass: r.exit_code === 0, exit_code: r.exit_code, attempted: attempted(run, final, i.id), output_tail: r.output_tail };
    });
  } finally { removeWorktree(run.repo, testWt); }
  const audit = auditRun(runDir, opts);
  const seats = run.seats ?? [];
  const costs = seats.map((s: any) => s.cost_usd).filter((c: any) => Number.isFinite(c));
  // Solo and split seats carry their own cost; a room's seats are the swarm's, rolled up in room.swarm_usage.
  const swarm = run.room?.swarm_usage;
  const cost = seats.length ? (costs.length === seats.length ? costs.reduce((a: number, b: number) => a + b, 0) : null)
    : Number.isFinite(swarm?.cost_usd) ? swarm.cost_usd : null;
  const passed = items.filter((i: any) => i.pass).length;
  const score = {
    pool: pool.name, pool_sha256: sha256, arm: run.arm, rep: run.rep, head: final.head, final_source: final.source,
    passed, of: items.length, attempted: items.filter((i: any) => i.attempted).length, items,
    suite, conflicts: final.conflicts.length, missing_branches: final.missing,
    cost_usd: cost, cost_estimated: seats.some((s: any) => s.cost_estimated) || (!seats.length && !!swarm && swarm.coverage !== 'complete'),
    cost_per_passing_item: cost !== null && passed > 0 ? cost / passed : null,
    account: run.account ?? null, void: audit.void, audit_hits: audit.hits.length,
  };
  json(join(runDir, 'score.json'), score);
  return score;
}
