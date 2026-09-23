/** Pool format, manifest lock, hidden side and `validate` for the pool-throughput study
 * (docs/experiments/2026-09-23-pool-throughput.md). A pool is <poolDir>/pool.json plus <poolDir>/pool.sha256,
 * the sha256 of pool.json's bytes. Its hidden side lives outside every repository and worktree, at
 * <hidden parent>/<pool>/<item-id>/{cmd, reference.patch, tests/<repo-relative files>}. Builders never see it:
 * nothing here writes the hidden path into a worktree, and reference.patch is only ever applied in validate's
 * own throwaway worktrees. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { hashTree } from './bench-build-runtime.ts';

export type PoolItem = { id: string; title: string; brief: string };
/** suite_cmd (optional, default "npm test") is the project's existing test suite, run by score from the repo root. */
export type Pool = { name: string; repo: string; base_commit: string; deadline_min: number; items: PoolItem[]; split: string[][]; suite_cmd?: string };
export type HiddenItem = { id: string; dir: string; cmd: string; patchPath: string; testsDir: string; tests: string[] };

export const LOCK_FILE = 'pool.sha256';
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

export function checkPool(p: any): Pool {
  const need = (ok: boolean, what: string) => { if (!ok) throw new Error(`pool.json: ${what}`); };
  need(!!p && typeof p === 'object', 'not an object');
  need(typeof p.name === 'string' && ID_RE.test(p.name), 'name must be a slug');
  need(typeof p.repo === 'string' && isAbsolute(p.repo), 'repo must be an absolute path');
  need(typeof p.base_commit === 'string' && /^[0-9a-f]{7,64}$/.test(p.base_commit), 'base_commit must be a commit sha');
  need(typeof p.deadline_min === 'number' && p.deadline_min > 0 && Number.isFinite(p.deadline_min), 'deadline_min must be a positive number');
  need(p.suite_cmd === undefined || (typeof p.suite_cmd === 'string' && p.suite_cmd.trim() !== ''), 'suite_cmd must be a non-empty string');
  need(Array.isArray(p.items) && p.items.length > 0, 'items must be a non-empty array');
  const ids = new Set<string>();
  for (const item of p.items) {
    need(typeof item?.id === 'string' && ID_RE.test(item.id), `item id ${JSON.stringify(item?.id)} must be a slug`);
    need(!ids.has(item.id), `duplicate item id ${item.id}`);
    ids.add(item.id);
    need(typeof item.title === 'string' && item.title.trim() !== '', `item ${item.id}: title required`);
    need(typeof item.brief === 'string' && item.brief.trim() !== '', `item ${item.id}: brief required`);
  }
  need(Array.isArray(p.split) && p.split.length === 3 && p.split.every((s: unknown) => Array.isArray(s)), 'split must be three arrays of item ids');
  const seen = new Set<string>();
  for (const id of p.split.flat()) {
    need(ids.has(id), `split names unknown item ${id}`);
    need(!seen.has(id), `split names ${id} twice`);
    seen.add(id);
  }
  need(seen.size === ids.size, `split must cover every item (missing ${[...ids].filter(id => !seen.has(id)).join(', ')})`);
  return p as Pool;
}

export function lockPool(poolDir: string): string {
  const digest = sha256(readFileSync(join(poolDir, 'pool.json')));
  writeFileSync(join(poolDir, LOCK_FILE), digest + '\n');
  return digest;
}

/** Reads a pool and refuses it unless pool.json still matches its lock and its schema. */
export function loadPool(poolDir: string): { pool: Pool; dir: string; sha256: string } {
  const dir = resolve(poolDir);
  const bytes = readFileSync(join(dir, 'pool.json'));
  const digest = sha256(bytes);
  const lockPath = join(dir, LOCK_FILE);
  if (!existsSync(lockPath)) throw new Error(`pool ${dir}: no ${LOCK_FILE} lock`);
  const locked = readFileSync(lockPath, 'utf8').trim();
  if (locked !== digest) throw new Error(`pool ${dir}: pool.json sha256 ${digest} does not match its lock ${locked}`);
  return { pool: checkPool(JSON.parse(bytes.toString('utf8'))), dir, sha256: digest };
}

/** <parent>/<pool>; parent defaults to $POOL_HIDDEN_ROOT, else ~/.agent-chatroom-hidden. */
export function hiddenRoot(poolName: string, parent?: string): string {
  return join(parent ?? process.env.POOL_HIDDEN_ROOT ?? join(homedir(), '.agent-chatroom-hidden'), poolName);
}

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name), st = lstatSync(p);
    if (st.isSymbolicLink()) throw new Error(`hidden tests: symlink not permitted: ${p}`);
    if (st.isDirectory()) out.push(...listFiles(p, base));
    else if (st.isFile()) out.push(relative(base, p));
  }
  return out;
}

export function loadHiddenItem(hiddenPoolRoot: string, id: string): HiddenItem {
  const dir = join(hiddenPoolRoot, id);
  if (!existsSync(dir)) throw new Error(`item ${id}: no hidden side at its hidden root`);
  const cmdPath = join(dir, 'cmd'), patchPath = join(dir, 'reference.patch'), testsDir = join(dir, 'tests');
  for (const [p, what] of [[cmdPath, 'cmd'], [patchPath, 'reference.patch'], [testsDir, 'tests/']] as const)
    if (!existsSync(p)) throw new Error(`item ${id}: hidden side has no ${what}`);
  const cmd = readFileSync(cmdPath, 'utf8').trim();
  if (!cmd) throw new Error(`item ${id}: hidden cmd is empty`);
  const tests = listFiles(testsDir);
  if (!tests.length) throw new Error(`item ${id}: hidden side has no test files`);
  return { id, dir, cmd, patchPath, testsDir, tests };
}

/** Copies an item's hidden test files into a worktree at their repo-relative paths. Never the patch. */
export function copyHiddenTests(item: HiddenItem, worktree: string) {
  for (const rel of item.tests) {
    const dest = join(worktree, rel);
    mkdirSync(join(dest, '..'), { recursive: true });
    cpSync(join(item.testsDir, rel), dest);
  }
}

/** Runs a hidden or suite command. NODE_TEST_CONTEXT is dropped: inherited from an outer `node --test`, it makes a
 * nested `node --test` report to the parent and exit 0 even when its tests fail. */
export function runCmd(cmd: string, cwd: string, timeoutMs = 300_000): { exit_code: number | null; timed_out: boolean; output_tail: string } {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync('sh', ['-c', cmd], { cwd, env, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
  return { exit_code: r.status, timed_out: r.error?.message.includes('ETIMEDOUT') ?? false, output_tail: ((r.stdout ?? '') + (r.stderr ?? '')).slice(-2000) };
}

const inside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const real = (p: string) => { let q = resolve(p); while (!existsSync(q)) q = resolve(q, '..'); return join(realpathSync(q), relative(q, resolve(p))); };

/** A fresh worktree of repo at commit: on a new branch when one is named, else detached. The main checkout is untouched.
 * linkNodeModules symlinks the repo's (untracked) node_modules in, as swarm.ts does for workers, so tests that need
 * dependencies run; the result says whether the repo's ignore rules cover the link ('linked-unignored' means a
 * builder's `git add -A` could commit it). */
export function worktreeAt(repo: string, commit: string, dir: string, branch?: string, opts: { linkNodeModules?: boolean } = {}): 'linked' | 'linked-unignored' | 'absent' | 'not-requested' {
  if (inside(real(dir), real(repo))) throw new Error(`worktree ${dir} must be outside the repository ${repo}`);
  mkdirSync(join(dir, '..'), { recursive: true });
  const args = branch ? ['worktree', 'add', '--quiet', '-b', branch, dir, commit] : ['worktree', 'add', '--quiet', '--detach', dir, commit];
  execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  return opts.linkNodeModules ? linkNodeModules(repo, dir) : 'not-requested';
}

/** A worktree has no node_modules: link the repo checkout's (as swarm.ts workerCwd does) so builds, suites and tests
 * that need dependencies run. 'absent' when the repo has none or the worktree already has one. */
export function linkNodeModules(repo: string, worktree: string): 'linked' | 'linked-unignored' | 'absent' {
  const mods = join(repo, 'node_modules'), dest = join(worktree, 'node_modules');
  if (!existsSync(mods) || existsSync(dest)) return 'absent';
  symlinkSync(mods, dest, 'dir');
  return spawnSync('git', ['-C', worktree, 'check-ignore', '-q', 'node_modules']).status === 0 ? 'linked' : 'linked-unignored';
}

export function removeWorktree(repo: string, dir: string) {
  try { execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', dir], { stdio: 'pipe' }); } catch {}
  rmSync(dir, { recursive: true, force: true });
  execFileSync('git', ['-C', repo, 'worktree', 'prune'], { stdio: 'pipe' });
}

export type ValidateItem = { id: string; ok: boolean; fails_at_base: boolean | null; passes_with_reference: boolean | null; hidden_sha256: string | null;
  /** Hidden test file names that already occur in the repo at base or in any brief: the leakage audit searches
   * transcripts for these names, so an item may only enter the pool when both lists are empty. */
  names_in_repo: string[]; names_in_briefs: string[];
  base_exit: number | null; reference_exit: number | null; base_tail: string; reference_tail: string; error?: string };

/** Each item in its own fresh worktree at base_commit: its hidden test must fail, then pass once reference.patch is applied. */
export function validatePool(poolDir: string, opts: { hiddenParent?: string; scratch?: string; timeoutMs?: number } = {}) {
  const { pool, sha256: poolSha } = loadPool(poolDir);
  const hidden = hiddenRoot(pool.name, opts.hiddenParent);
  const scratch = opts.scratch ? resolve(opts.scratch) : mkdtempSync(join(tmpdir(), 'pool-validate-'));
  mkdirSync(scratch, { recursive: true });
  const items: ValidateItem[] = [];
  for (const { id } of pool.items) {
    const r: ValidateItem = { id, ok: false, fails_at_base: null, passes_with_reference: null, hidden_sha256: null, names_in_repo: [], names_in_briefs: [], base_exit: null, reference_exit: null, base_tail: '', reference_tail: '' };
    const wt = join(scratch, `validate-${id}`);
    try {
      const item = loadHiddenItem(hidden, id);
      r.hidden_sha256 = hashTree(item.dir);
      worktreeAt(pool.repo, pool.base_commit, wt, undefined, { linkNodeModules: true });
      const names = [...new Set(item.tests.map(t => basename(t)))].sort();
      const repoNames = new Set(execFileSync('git', ['-C', wt, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean).map(f => basename(f)));
      r.names_in_repo = names.filter(n => repoNames.has(n));
      r.names_in_briefs = names.filter(n => pool.items.some(i => i.brief.includes(n) || i.title.includes(n)));
      copyHiddenTests(item, wt);
      const atBase = runCmd(item.cmd, wt, opts.timeoutMs);
      r.base_exit = atBase.exit_code; r.base_tail = atBase.output_tail; r.fails_at_base = atBase.exit_code !== 0;
      const applied = spawnSync('git', ['apply', '--whitespace=nowarn', item.patchPath], { cwd: wt, encoding: 'utf8' });
      if (applied.status !== 0) {
        r.passes_with_reference = false;
        r.reference_tail = ('reference.patch did not apply: ' + applied.stderr).slice(-2000);
      } else {
        copyHiddenTests(item, wt); // the hidden tests are authoritative even if the patch touched them
        const withRef = runCmd(item.cmd, wt, opts.timeoutMs);
        r.reference_exit = withRef.exit_code; r.reference_tail = withRef.output_tail; r.passes_with_reference = withRef.exit_code === 0;
      }
      r.ok = r.fails_at_base === true && r.passes_with_reference === true && !r.names_in_repo.length && !r.names_in_briefs.length;
    } catch (e) {
      r.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (existsSync(wt)) removeWorktree(pool.repo, wt);
    }
    items.push(r);
  }
  return { pool: pool.name, pool_sha256: poolSha, repo: pool.repo, base_commit: pool.base_commit, ok: items.every(i => i.ok), items };
}
