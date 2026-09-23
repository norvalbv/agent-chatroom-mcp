/** Secondary suite view, NOT pre-registered: per-command suite results at base_commit against the final head.
 * PASS_TO_PASS semantics from the SWE-bench harness; docs/reuse-survey-2026-09-23.md, "Scoring: the existing-suite check". */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { isolatedRepo, linkNodeModules, loadPool, type Pool, removeWorktree, runCmd, worktreeAt } from './pool-format.ts';

export type CommandStatus = 'passed' | 'failed' | 'skipped' | 'unknown';
export type SuiteFormat = 'offline-runner' | 'vitest-json' | 'exit-code';
/** commands is null when the output has no per-command results (exit-code fallback); complete is false when the run was cut short. */
export type SuiteView = { format: SuiteFormat; exit_code: number | null; timed_out: boolean; complete: boolean; commands: Record<string, CommandStatus> | null };
export type SuiteBase = { note: string; pool: string; base_commit: string; suite_cmd: string; view_cmd: string; recorded_at: string; view: SuiteView };

export const SUITE_BASE_FILE = 'suite-base.json';
export const SECONDARY_NOTE = 'Secondary view, not pre-registered (added after pool 1, from SWE-bench PASS_TO_PASS). The pre-registered suite measure is suite.pass: suite_cmd exits 0 at the final head. This view never changes it.';
/** The limit score gives the pre-registered suite run (ITEM_TIMEOUT_MS), so base and head views are cut off alike. */
export const SUITE_TIMEOUT_MS = 10 * 60_000;

const OFFLINE_MARK = /^\[offline\] (.+)$/;
const OFFLINE_OK = /^\[offline\] OK \(\d+ commands\)$/;
const OFFLINE_SUMMARY = /^\[offline\] FAILED \d+ of \d+ commands:$/;
const NEWLINE = /\r?\n/;
const JSON_START = /^\{/m;

/** scripts/offline-runner.mjs prints `[offline] <name>` before each command and `[offline] FAILED <name>: <reason>` for a failure.
 * A nested runner (its own self-test) adds markers too; they are identical at base and head, so the comparison is unaffected. */
export function parseOfflineRunner(stdout: string, stderr: string, exitCode: number | null): { complete: boolean; commands: Record<string, CommandStatus> } | null {
  const started: string[] = [];
  for (const line of stdout.split(NEWLINE)) {
    const m = OFFLINE_MARK.exec(line);
    if (m && !OFFLINE_OK.test(line) && !m[1].startsWith('FAILED ')) started.push(m[1]);
  }
  if (!started.length) return null;
  const names = [...new Set(started)], commands: Record<string, CommandStatus> = {};
  const errLines = stderr.split(NEWLINE);
  if (exitCode === 0 && stdout.split(NEWLINE).some(l => OFFLINE_OK.test(l))) {
    for (const n of names) commands[n] = 'passed';
    return { complete: true, commands };
  }
  let summary = -1;
  for (let i = errLines.length - 1; i >= 0 && summary < 0; i--) if (OFFLINE_SUMMARY.test(errLines[i])) summary = i;
  if (exitCode !== null && exitCode !== 0 && summary >= 0) {
    // The runner exited itself, so its last summary is its own: every failed top-level command as "  - <name>: <reason>".
    const listed = errLines.slice(summary + 1).filter(l => l.startsWith('  - ')).map(l => l.slice(4));
    for (const n of names) commands[n] = listed.some(l => l.startsWith(n + ': ')) ? 'failed' : 'passed';
    return { complete: true, commands };
  }
  // Killed (no exit code) or no summary: cut off, and any summary seen is a nested runner's. Its commands count as passed,
  // as in a complete run where the top-level summary never lists them; the last command started has no result.
  const nested = new Set<string>();
  errLines.forEach((l, i) => { if (OFFLINE_SUMMARY.test(l)) for (const x of errLines.slice(i + 1)) { if (!x.startsWith('  - ')) break; nested.add(x.slice(4)); } });
  const failed = (n: string) => errLines.some(l => l.startsWith(`[offline] FAILED ${n}: `)) && ![...nested].some(x => x.startsWith(n + ': '));
  const last = started[started.length - 1];
  for (const n of names) commands[n] = failed(n) ? 'failed' : n === last ? 'unknown' : 'passed';
  return { complete: false, commands };
}

function jsonObject(text: string): any {
  try { return JSON.parse(text.trim()); } catch {}
  const start = text.search(JSON_START), end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

/** Test file paths relative to the checkout; never an absolute local path (the base record is committed with the pool). */
function relName(name: string, cwd: string): string {
  const roots = [resolve(cwd)];
  try { roots.push(realpathSync(cwd)); } catch {}
  for (const root of roots) {
    const rel = relative(root, name);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel;
  }
  return isAbsolute(name) ? `<outside>/${basename(name)}` : name;
}

/** vitest --reporter=json (the Jest-compatible report): one result per test file. A file whose tests were all skipped counts as
 * skipped, not passed, since PASS_TO_PASS treats a skipped test as not passing. */
export function parseVitestJson(text: string, cwd: string): { complete: boolean; commands: Record<string, CommandStatus> } | null {
  const report = jsonObject(text);
  if (!report || !Array.isArray(report.testResults)) return null;
  const rank: Record<CommandStatus, number> = { passed: 0, skipped: 1, unknown: 2, failed: 3 };
  const commands: Record<string, CommandStatus> = {};
  for (const file of report.testResults) {
    const tests: any[] = Array.isArray(file?.assertionResults) ? file.assertionResults : [];
    const status: CommandStatus = file?.status === 'failed' ? 'failed'
      : file?.status !== 'passed' ? (['skipped', 'pending', 'todo', 'disabled'].includes(file?.status) ? 'skipped' : 'unknown')
      : tests.length && !tests.some(t => t?.status === 'passed' || t?.status === 'failed') ? 'skipped' : 'passed';
    const name = relName(String(file?.name ?? ''), cwd);
    if (!(name in commands) || rank[status] > rank[commands[name]]) commands[name] = status;
  }
  return { complete: true, commands };
}

/** Per-command results from one suite run: vitest JSON (from $SUITE_REPORT or stdout), then offline-runner lines, else exit code only. */
export function parseSuiteOutput(r: { stdout?: string; stderr?: string; exit_code: number | null; timed_out: boolean; report?: string; cwd: string }): SuiteView {
  const stdout = r.stdout ?? '', stderr = r.stderr ?? '';
  const base = { exit_code: r.exit_code, timed_out: r.timed_out };
  const vitest = (r.report ? parseVitestJson(r.report, r.cwd) : null) ?? parseVitestJson(stdout, r.cwd);
  if (vitest) return { format: 'vitest-json', ...base, complete: vitest.complete && !r.timed_out, commands: vitest.commands };
  const offline = parseOfflineRunner(stdout, stderr, r.exit_code);
  if (offline) return { format: 'offline-runner', ...base, complete: offline.complete && !r.timed_out, commands: offline.commands };
  return { format: 'exit-code', ...base, complete: !r.timed_out, commands: null };
}

/** Runs the view command with $SUITE_REPORT naming a scratch file outside the checkout, for a JSON reporter's --outputFile. */
export function runSuiteView(cmd: string, cwd: string, timeoutMs = SUITE_TIMEOUT_MS): SuiteView {
  const dir = mkdtempSync(join(tmpdir(), 'suite-view-')), report = join(dir, 'report.json');
  try {
    const r = runCmd(cmd, cwd, timeoutMs, { env: { SUITE_REPORT: report }, full: true });
    return parseSuiteOutput({ ...r, report: existsSync(report) ? readFileSync(report, 'utf8') : undefined, cwd });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Validate step: suite at base_commit, once per pool, in a run-style isolated repo (as score's head run), written next to pool.json. */
export function recordSuiteBase(poolDir: string, opts: { scratch?: string; viewCmd?: string; timeoutMs?: number } = {}): SuiteBase {
  const { pool } = loadPool(poolDir);
  const suiteCmd = pool.suite_cmd ?? 'npm test', viewCmd = opts.viewCmd ?? suiteCmd;
  const parent = resolve(opts.scratch ?? tmpdir());
  mkdirSync(parent, { recursive: true });
  const scratch = mkdtempSync(join(parent, 'suite-base-')), repo = join(scratch, 'repo'), wt = join(scratch, 'wt');
  try {
    worktreeAt(repo, isolatedRepo(pool.repo, pool.base_commit, repo), wt);
    linkNodeModules(pool.repo, wt);
    const view = runSuiteView(viewCmd, wt, opts.timeoutMs);
    const record: SuiteBase = { note: SECONDARY_NOTE, pool: pool.name, base_commit: pool.base_commit, suite_cmd: suiteCmd, view_cmd: viewCmd, recorded_at: new Date().toISOString(), view };
    writeFileSync(join(resolve(poolDir), SUITE_BASE_FILE), JSON.stringify(record, null, 2) + '\n');
    return record;
  } finally {
    if (existsSync(wt)) removeWorktree(repo, wt);
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The pool's base record, or why there is none usable (missing, or recorded for another base commit or suite command). */
export function readSuiteBase(poolDir: string, pool: Pool): { record: SuiteBase } | { reason: string } {
  const path = join(poolDir, SUITE_BASE_FILE);
  if (!existsSync(path)) return { reason: `no ${SUITE_BASE_FILE} next to pool.json: run pool.ts validate --suite-view to record the suite at base` };
  const record: SuiteBase = JSON.parse(readFileSync(path, 'utf8'));
  if (record.base_commit !== pool.base_commit) return { reason: `${SUITE_BASE_FILE} was recorded at base ${record.base_commit}, not the pool's ${pool.base_commit}` };
  if (record.suite_cmd !== (pool.suite_cmd ?? 'npm test')) return { reason: `${SUITE_BASE_FILE} was recorded for suite_cmd ${JSON.stringify(record.suite_cmd)}, not the pool's` };
  return { record };
}

export type SuitePassToPass = { available: false; reason: string } | {
  available: true; format: SuiteFormat; view_cmd: string; per_command: boolean; base_complete: boolean; head_complete: boolean;
  base_exit_code: number | null; head_exit_code: number | null; commands_at_base: number; passed_at_base: number;
  passed_at_base_now_failing: string[]; passed_at_base_now_skipped: string[]; passed_at_base_disappeared: string[];
  passed_at_base_not_seen_head_incomplete: string[]; failed_at_base: string[]; new_at_head_failing: string[];
};

/** Commands that passed at base and now fail, are skipped, or are gone. When the head run was cut short, unseen ones are listed apart. */
export function compareSuiteViews(base: SuiteView, head: SuiteView, viewCmd: string): SuitePassToPass {
  if (base.format !== head.format) return { available: false, reason: `suite output format differs: ${base.format} at base, ${head.format} at head` };
  const b = base.commands ?? {}, h = head.commands ?? {};
  const passed = Object.keys(b).filter(n => b[n] === 'passed').sort();
  const gone = passed.filter(n => !(n in h) || h[n] === 'unknown');
  return {
    available: true, format: base.format, view_cmd: viewCmd, per_command: base.commands !== null,
    base_complete: base.complete, head_complete: head.complete, base_exit_code: base.exit_code, head_exit_code: head.exit_code,
    commands_at_base: Object.keys(b).length, passed_at_base: passed.length,
    passed_at_base_now_failing: passed.filter(n => h[n] === 'failed'),
    passed_at_base_now_skipped: passed.filter(n => h[n] === 'skipped'),
    passed_at_base_disappeared: head.complete ? gone : [],
    passed_at_base_not_seen_head_incomplete: head.complete ? [] : gone,
    failed_at_base: Object.keys(b).filter(n => b[n] === 'failed').sort(),
    new_at_head_failing: Object.keys(h).filter(n => !(n in b) && h[n] === 'failed').sort(),
  };
}
