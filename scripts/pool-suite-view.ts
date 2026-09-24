/** Secondary suite view, NOT pre-registered: per-command suite results at base_commit against the final head.
 * PASS_TO_PASS semantics from the SWE-bench harness; docs/reuse-survey-2026-09-23.md, "Scoring: the existing-suite check". */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { cmdTimeoutMs, Interrupted, isolatedRepo, letSignalsIn, linkNodeModules, loadPool, type Pool, removeWorktree, runCmd, stoppedBy, worktreeAt } from './pool-format.ts';

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

/** Runs the view command with $SUITE_REPORT naming a scratch file outside the checkout, for a JSON reporter's --outputFile.
 * `signal` is what killed the command, if anything did (SIGKILL at the time limit, or a stop signal). */
export function runSuiteView(cmd: string, cwd: string, timeoutMs = SUITE_TIMEOUT_MS): { view: SuiteView; signal: NodeJS.Signals | null } {
  const dir = mkdtempSync(join(tmpdir(), 'suite-view-')), report = join(dir, 'report.json');
  try {
    const r = runCmd(cmd, cwd, timeoutMs, { env: { SUITE_REPORT: report }, full: true });
    return { view: parseSuiteOutput({ ...r, report: existsSync(report) ? readFileSync(report, 'utf8') : undefined, cwd }), signal: r.signal };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Validate step: suite at base_commit, once per pool, in a run-style isolated repo (as score's head run), written next to pool.json.
 * A run stopped by SIGINT, SIGTERM or SIGHUP (a Ctrl-C reaches the suite too) is not a result: it throws Interrupted and leaves
 * the existing record alone. A stop signal validate itself got ends it through its own handlers: one that came while the copy
 * was made, before the suite runs; one that came while the suite ran, before anything is written. A run cut off at the time
 * limit is a result, recorded with complete: false, as score's head run is cut off at the same limit. The file is replaced by
 * a rename, so it is never left half written. */
export async function recordSuiteBase(poolDir: string, opts: { scratch?: string; viewCmd?: string; timeoutMs?: number } = {}): Promise<SuiteBase> {
  const { pool } = loadPool(poolDir);
  const suiteCmd = pool.suite_cmd ?? 'npm test', viewCmd = opts.viewCmd ?? suiteCmd;
  const parent = resolve(opts.scratch ?? tmpdir());
  mkdirSync(parent, { recursive: true });
  const scratch = mkdtempSync(join(parent, 'suite-base-')), repo = join(scratch, 'repo'), wt = join(scratch, 'wt');
  // validate's stop handlers end it with process.exit, which skips `finally`: this hook removes the copy then. The copy is its
  // own repository (isolatedRepo), so nothing is registered in the pool's repo.
  const removeCopy = () => { try { rmSync(scratch, { recursive: true, force: true }); } catch {} };
  process.on('exit', removeCopy);
  let outcome: { view: SuiteView } | { stop: string };
  try {
    worktreeAt(repo, isolatedRepo(pool.repo, pool.base_commit, repo), wt);
    linkNodeModules(pool.repo, wt);
    await letSignalsIn(); // a stop signal validate got while the copy was made ends it here, before the suite runs
    const run = runSuiteView(viewCmd, wt, opts.timeoutMs ?? cmdTimeoutMs(pool, SUITE_TIMEOUT_MS)), stop = stoppedBy(run.signal);
    outcome = stop ? { stop } : { view: run.view };
  } catch (e) {
    const stop = stoppedBy((e as { signal?: string } | null)?.signal); // git or tar making the base copy
    if (!stop) throw e;
    outcome = { stop };
  } finally {
    process.removeListener('exit', removeCopy);
    if (existsSync(wt)) removeWorktree(repo, wt);
    rmSync(scratch, { recursive: true, force: true });
  }
  await letSignalsIn(); // a stop signal validate got while the suite ran ends it here, before anything is written
  if ('stop' in outcome) throw new Interrupted(outcome.stop, `the suite run at base (${SUITE_BASE_FILE} left as it was)`);
  const record: SuiteBase = { note: SECONDARY_NOTE, pool: pool.name, base_commit: pool.base_commit, suite_cmd: suiteCmd, view_cmd: viewCmd, recorded_at: new Date().toISOString(), view: outcome.view };
  const path = join(resolve(poolDir), SUITE_BASE_FILE), tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n');
    renameSync(tmp, path);
  } finally { rmSync(tmp, { force: true }); }
  return record;
}

const FORMATS: readonly string[] = ['offline-runner', 'vitest-json', 'exit-code'];
const STATUSES: readonly string[] = ['passed', 'failed', 'skipped', 'unknown'];
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** What is wrong with a parsed record's view_cmd and view, or null when compareSuiteViews can use them. */
export function suiteBaseProblem(record: Record<string, unknown>): string | null {
  if (typeof record.view_cmd !== 'string' || !record.view_cmd) return 'no view_cmd';
  const view = record.view;
  if (!isObject(view)) return 'no view';
  if (typeof view.format !== 'string' || !FORMATS.includes(view.format)) return `view.format ${JSON.stringify(view.format)} is not one of ${FORMATS.join(', ')}`;
  if (view.commands !== null && !isObject(view.commands)) return 'view.commands is neither an object nor null';
  if (isObject(view.commands)) {
    const bad = Object.keys(view.commands).find(n => !STATUSES.includes(String((view.commands as Record<string, unknown>)[n])));
    if (bad !== undefined) return `view.commands[${JSON.stringify(bad)}] is not one of ${STATUSES.join(', ')}`;
  }
  if (typeof view.complete !== 'boolean') return 'view.complete is not a boolean';
  if (view.exit_code !== null && typeof view.exit_code !== 'number') return 'view.exit_code is neither a number nor null';
  return null;
}

/** The pool's base record, or why there is none usable: missing, unreadable, not JSON, recorded for another base commit or suite
 * command, or not the shape recordSuiteBase writes (the file sits in the pool dir outside the lock, so a merge conflict or a hand
 * edit can break it). Never throws: the view is secondary and must not stop the pre-registered score. */
export function readSuiteBase(poolDir: string, pool: Pool): { record: SuiteBase } | { reason: string } {
  const path = join(poolDir, SUITE_BASE_FILE);
  if (!existsSync(path)) return { reason: `no ${SUITE_BASE_FILE} next to pool.json: run pool.ts validate --suite-view to record the suite at base` };
  let record: unknown;
  try { record = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { return { reason: `${SUITE_BASE_FILE} is unreadable: ${e instanceof Error ? e.message : String(e)}` }; }
  if (!isObject(record)) return { reason: `${SUITE_BASE_FILE} is not a JSON object` };
  if (record.base_commit !== pool.base_commit) return { reason: `${SUITE_BASE_FILE} was recorded at base ${String(record.base_commit)}, not the pool's ${pool.base_commit}` };
  if (record.suite_cmd !== (pool.suite_cmd ?? 'npm test')) return { reason: `${SUITE_BASE_FILE} was recorded for suite_cmd ${JSON.stringify(record.suite_cmd)}, not the pool's` };
  const problem = suiteBaseProblem(record);
  if (problem) return { reason: `${SUITE_BASE_FILE} is malformed: ${problem}` };
  return { record: record as SuiteBase };
}

export type SuitePassToPass = { available: false; reason: string } | {
  available: true; format: SuiteFormat; view_cmd: string; per_command: boolean; base_complete: boolean; head_complete: boolean;
  base_exit_code: number | null; head_exit_code: number | null; commands_at_base: number; passed_at_base: number;
  passed_at_base_now_failing: string[]; passed_at_base_now_skipped: string[]; passed_at_base_disappeared: string[];
  passed_at_base_not_seen_head_incomplete: string[]; failed_at_base: string[]; new_at_head_failing: string[];
  failing_at_head_no_base_result: string[];
};

/** Commands that passed at base and now fail, are skipped, or are gone. When the head run was cut short, unseen ones are listed
 * apart. A command failing at head is new only when the base run was complete and never ran it; one with no result at base (the
 * base run was cut short before it, or it was the one running then) is listed apart too, never as new or as a regression. */
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
    new_at_head_failing: Object.keys(h).filter(n => !(n in b) && base.complete && h[n] === 'failed').sort(),
    failing_at_head_no_base_result: Object.keys(h).filter(n => h[n] === 'failed' && (n in b ? b[n] === 'unknown' : !base.complete)).sort(),
  };
}
