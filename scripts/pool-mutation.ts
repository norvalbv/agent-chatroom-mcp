/** Flag-only mutation check of hidden tests: StrykerJS 10 (Apache-2.0, command runner) mutates only the lines reference.patch
 * changes. docs/reuse-survey-2026-09-23.md, "Strength of the hidden tests"; CoHarden's lax-test failure. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { copyHiddenTests, type HiddenItem, isolatedRepo, linkNodeModules } from './pool-format.ts';

export type PatchRange = { file: string; start: number; end: number };
export type Survivor = { file: string; line: number; column: number; mutator: string; original: string; replacement: string };
/** A flag for a human look, never a rejection: a survivor may be an equivalent mutant. */
export type MutationResult = {
  flag_only: true; flagged: boolean; ranges: string[]; skipped_files: string[]; mutants: number; killed: number; timed_out: number;
  survived: number; errors: number; survivors: Survivor[]; concurrency: number; duration_s: number; note?: string; error?: string;
};

export const MUTATION_NOTE = 'Flag for a human look, not a rejection: a surviving mutant means the hidden test accepts a changed fix, unless the mutant is equivalent.';
const MUTABLE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const TEST_LIKE = /(?:^|\/)__tests__\/|\.(?:test|spec)\.[^/]+$/;
const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const NEW_PATH_PREFIX = /^b\//;
const MIN_NODE = /^>=\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/;
const V_PREFIX = /^v/;
const unquote = (p: string) => (p.startsWith('"') && p.endsWith('"') ? JSON.parse(p) : p);

/** New-file line ranges of the lines a unified diff adds or changes, merged when adjacent. StrykerJS has no --since, so the
 * patch's own hunks become its `file:start-end` mutate ranges. Test files, hidden tests and non-JS/TS files are left out. */
export function patchRanges(patch: string, exclude: string[] = []): { ranges: PatchRange[]; skipped: string[] } {
  const all: PatchRange[] = [];
  let file: string | null = null, next = 0, oldLeft = 0, newLeft = 0;
  for (const line of patch.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      // Inside a hunk the counts decide, so a removed "-- x" line is never read as a "--- " header.
      if (line.startsWith('\\')) continue;
      if (line.startsWith('+')) {
        const last = all[all.length - 1];
        if (file && last?.file === file && last.end === next - 1) last.end = next;
        else if (file) all.push({ file, start: next, end: next });
        next++; newLeft--;
      } else if (line.startsWith('-')) oldLeft--;
      else { next++; oldLeft--; newLeft--; }
      continue;
    }
    if (line.startsWith('diff --git ')) file = null;
    else if (line.startsWith('+++ ')) { const p = unquote(line.slice(4).trim()); file = p === '/dev/null' ? null : p.replace(NEW_PATH_PREFIX, ''); }
    else {
      const h = HUNK.exec(line);
      if (h) { oldLeft = h[1] === undefined ? 1 : Number(h[1]); next = Number(h[2]); newLeft = h[3] === undefined ? 1 : Number(h[3]); }
    }
  }
  const excluded = new Set(exclude);
  const keep = (f: string) => MUTABLE.test(f) && !TEST_LIKE.test(f) && !excluded.has(f);
  return { ranges: all.filter(r => keep(r.file)), skipped: [...new Set(all.filter(r => !keep(r.file)).map(r => r.file))].sort() };
}

/** @stryker-mutator/core's bin, and the Node range its package.json declares (10.0.0: >=22.0.0; the v10 release dropped Node 20). */
export function strykerInstall(): { bin: string; engines: string } | null {
  try {
    const pkg = createRequire(import.meta.url).resolve('@stryker-mutator/core/package.json');
    return { bin: join(dirname(pkg), 'bin', 'stryker.js'), engines: JSON.parse(readFileSync(pkg, 'utf8')).engines?.node ?? '' };
  } catch { return null; }
}

/** True unless `range` is a plain `>=X[.Y[.Z]]` that `version` falls below; any other form is left to Stryker to judge. */
export function nodeSatisfies(range: string, version: string): boolean {
  const m = MIN_NODE.exec(range.trim());
  if (!m) return true;
  const want = [1, 2, 3].map(i => Number(m[i] ?? 0)), have = version.replace(V_PREFIX, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((have[i] ?? 0) !== want[i]) return (have[i] ?? 0) > want[i];
  return true;
}

/** Leads the new process group and runs argv in it. Its stdin is a lifeline pipe from the runner below: when the runner dies by
 * any means, SIGKILL included, the pipe closes and the keeper kills its own group, so StrykerJS and every mutant run go too. */
const KEEPER = "const{spawn}=require('node:child_process');const die=()=>{try{process.kill(0,'SIGKILL')}catch{}};" +
  "process.stdin.on('end',die);process.stdin.on('close',die);process.stdin.on('error',die);process.stdin.resume();" +
  "const[bin,...args]=process.argv.slice(1);const k=spawn(bin,args,{stdio:['ignore','inherit','inherit']});" +
  "k.on('error',()=>process.exit(127));k.on('exit',s=>process.exit(s??1));";
/** Runs in the caller's process group and puts argv in a group of its own (under KEEPER), which it kills at the deadline, when
 * argv exits (background children included), on SIGINT, SIGTERM or SIGHUP (then dies of the same signal, so the caller sees
 * it), and when its parent goes away (the ppid changes). A caller killed outright takes the runner down in its group, and the
 * keeper's lifeline then ends the rest. So no mutant run outlives the check, however validate is stopped. */
const GROUP_RUNNER = "const{spawn}=require('node:child_process');const[ms,...argv]=process.argv.slice(1);const ppid=process.ppid;let code=null;" +
  `const c=spawn(process.execPath,['-e',${JSON.stringify(KEEPER)},...argv],{stdio:['pipe','inherit','inherit'],detached:true});` +
  "const kill=()=>{try{process.kill(-c.pid,'SIGKILL')}catch{}};const t=setTimeout(()=>{code=124;kill()},Number(ms));" +
  "for(const s of['SIGINT','SIGTERM','SIGHUP'])process.on(s,()=>{kill();process.removeAllListeners(s);process.kill(process.pid,s)});" +
  "setInterval(()=>{if(process.ppid!==ppid){kill();process.exit(1)}},250).unref();" +
  "c.on('error',()=>{kill();process.exit(127)});c.on('exit',s=>{clearTimeout(t);kill();process.exit(code??s??1)});";
const STOP_SIGNALS: readonly string[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
/** `interrupted`: SIGINT, SIGTERM or SIGHUP when that stopped the runner (after it killed the group), else null. validate's own
 * handlers (bench-build-runtime.ts) only run once its synchronous work ends, so the check must stop by itself (MutationInterrupted). */
export function runGrouped(argv: string[], cwd: string, timeoutMs: number, env: NodeJS.ProcessEnv) {
  const r = spawnSync(process.execPath, ['-e', GROUP_RUNNER, String(timeoutMs), ...argv], { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs + 60_000, killSignal: 'SIGKILL' });
  return { exit_code: r.status, timed_out: r.status === 124, signal: r.signal, interrupted: r.signal !== null && STOP_SIGNALS.includes(r.signal) ? r.signal : null,
    output_tail: ((r.stdout ?? '') + (r.stderr ?? '')).slice(-2000) };
}

/** Thrown when validate is being stopped, after the item's scratch copy is removed; validateAll lets it end validate. */
export class MutationInterrupted extends Error {
  constructor(readonly signal: string) { super(`mutation check stopped by ${signal}`); }
}

const snippet = (source: string, loc: any): string => {
  const lines = source.split('\n'), s = loc.start, e = loc.end;
  const text = s.line === e.line ? (lines[s.line - 1] ?? '').slice(s.column - 1, e.column - 1) : [(lines[s.line - 1] ?? '').slice(s.column - 1), ...lines.slice(s.line, e.line - 1), (lines[e.line - 1] ?? '').slice(0, e.column - 1)].join('\n');
  return text.length > 120 ? text.slice(0, 117) + '...' : text;
};

/** One item: a scratch copy at base (its own repository, as a pool run's, so nothing is registered in the pool's repo and a killed
 * validate leaves no worktree behind) with reference.patch applied and the hidden tests copied in, mutated in place (the copy is
 * thrown away) with the hidden command as Stryker's command runner. Config and report stay outside the copy. */
export function mutationCheckItem(o: { repo: string; baseCommit: string; item: HiddenItem; scratch: string; concurrency?: number; timeoutMs?: number; nodeVersion?: string }): MutationResult {
  const concurrency = Math.max(1, o.concurrency ?? 1), timeoutMs = o.timeoutMs ?? 30 * 60_000, t0 = Date.now();
  const result: MutationResult = { flag_only: true, flagged: false, ranges: [], skipped_files: [], mutants: 0, killed: 0, timed_out: 0, survived: 0, errors: 0, survivors: [], concurrency, duration_s: 0 };
  const done = (extra: Partial<MutationResult>): MutationResult => ({ ...result, ...extra, duration_s: Math.round((Date.now() - t0) / 1000) });
  const stryker = strykerInstall();
  if (!stryker) return done({ error: 'StrykerJS is not installed (@stryker-mutator/core devDependency): run npm install' });
  const nodeVersion = o.nodeVersion ?? process.versions.node;
  if (!nodeSatisfies(stryker.engines, nodeVersion)) return done({ error: `StrykerJS needs Node ${stryker.engines}; this is Node ${nodeVersion}` });
  const { ranges, skipped } = patchRanges(readFileSync(o.item.patchPath, 'utf8'), o.item.tests);
  result.ranges = ranges.map(r => `${r.file}:${r.start}-${r.end}`); result.skipped_files = skipped;
  if (!ranges.length) return done({ note: 'reference.patch adds or changes no JS/TS source lines to mutate' });
  mkdirSync(resolve(o.scratch), { recursive: true });
  const dir = mkdtempSync(join(resolve(o.scratch), `mutation-${o.item.id}-`)), wt = join(dir, 'wt');
  const config = join(dir, 'stryker.config.json'), reportPath = join(dir, 'mutation.json');
  try {
    isolatedRepo(o.repo, o.baseCommit, wt);
    linkNodeModules(o.repo, wt);
    const applied = spawnSync('git', ['apply', '--whitespace=nowarn', o.item.patchPath], { cwd: wt, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (applied.status !== 0) return done({ error: ('reference.patch did not apply: ' + applied.stderr).slice(-500) });
    copyHiddenTests(o.item, wt);
    writeFileSync(config, JSON.stringify({
      testRunner: 'command', commandRunner: { command: o.item.cmd }, coverageAnalysis: 'off', mutate: result.ranges, inPlace: true,
      reporters: ['json'], jsonReporter: { fileName: reportPath }, plugins: [], concurrency, logLevel: 'warn', cleanTempDir: 'always',
      dryRunTimeoutMinutes: Math.max(1, Math.ceil(timeoutMs / 60_000)),
    }, null, 2));
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // inherited from an outer node --test, it makes the hidden node --test exit 0 and every mutant survive
    // StrykerJS runs on this Node (the one the engines check above passed), not on whichever node its shebang finds first on PATH.
    const r = runGrouped([process.execPath, stryker.bin, 'run', config], wt, timeoutMs, env);
    if (r.interrupted) throw new MutationInterrupted(r.interrupted);
    if (r.timed_out) return done({ error: `StrykerJS did not finish within ${Math.round(timeoutMs / 60_000)} min` });
    if (r.exit_code !== 0 || !existsSync(reportPath)) return done({ error: `StrykerJS exited ${r.exit_code}: ${r.output_tail.slice(-500)}` });
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const mutants = Object.entries<any>(report.files ?? {}).flatMap(([file, f]) => (f.mutants ?? []).map((m: any) => ({ file, source: String(f.source ?? ''), m })));
    const count = (...statuses: string[]) => mutants.filter(x => statuses.includes(x.m.status)).length;
    const survivors = mutants.filter(x => x.m.status === 'Survived' || x.m.status === 'NoCoverage').map(x => ({
      file: x.file, line: x.m.location.start.line, column: x.m.location.start.column, mutator: String(x.m.mutatorName),
      original: snippet(x.source, x.m.location), replacement: String(x.m.replacement ?? '').slice(0, 120),
    }));
    return done({ mutants: mutants.length, killed: count('Killed'), timed_out: count('Timeout'), survived: survivors.length, errors: count('CompileError', 'RuntimeError'),
      survivors, flagged: survivors.length > 0, ...(mutants.length ? {} : { note: 'StrykerJS placed no mutants in the changed lines' }) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
