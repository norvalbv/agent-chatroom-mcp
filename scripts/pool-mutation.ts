/** Flag-only mutation check of hidden tests: StrykerJS 10 (Apache-2.0, command runner) mutates only the lines reference.patch
 * changes. docs/reuse-survey-2026-09-23.md, "Strength of the hidden tests"; CoHarden's lax-test failure. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { copyHiddenTests, type HiddenItem, Interrupted, isolatedRepo, letSignalsIn, linkNodeModules, stoppedBy } from './pool-format.ts';

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

/** Leads the new process group and runs argv in it. Its stdin is a lifeline pipe from validate: when validate dies by any
 * means, SIGKILL included, the pipe closes and the keeper kills its own group, so StrykerJS and every mutant run go too. */
const KEEPER = "const{spawn}=require('node:child_process');const die=()=>{try{process.kill(0,'SIGKILL')}catch{}};" +
  "process.stdin.on('end',die);process.stdin.on('close',die);process.stdin.on('error',die);process.stdin.resume();" +
  "const[bin,...args]=process.argv.slice(1);const k=spawn(bin,args,{stdio:['ignore','inherit','inherit']});" +
  "k.on('error',()=>process.exit(127));k.on('exit',s=>process.exit(s??1));";
const OUTPUT_TAIL = 2000;
/** How long to wait for the output pipes to close once the group is killed, in case a process left the group and holds them. */
const CLOSE_GRACE_MS = 2000;
export type GroupedResult = { exit_code: number | null; timed_out: boolean; signal: NodeJS.Signals | null; output_tail: string };

/** Runs argv under KEEPER in a process group of its own and awaits it, so validate's event loop keeps running: a SIGINT or
 * SIGTERM reaches validate's stop handlers at once, and their process.exit runs the 'exit' hook below, which kills the group
 * (a Ctrl-C does not reach the group itself, since it is not the terminal's foreground group). The group is also killed at
 * the deadline and when argv exits (background children included). `signal` is what killed the keeper, if anything did. */
export function runGrouped(argv: string[], cwd: string, timeoutMs: number, env: NodeJS.ProcessEnv): Promise<GroupedResult> {
  return new Promise(resolve => {
    const c = spawn(process.execPath, ['-e', KEEPER, ...argv], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    let tail = '', timedOut = false, finished = false, graceTimer: NodeJS.Timeout | undefined;
    const keep = (d: Buffer) => { tail = (tail + d.toString('utf8')).slice(-OUTPUT_TAIL); };
    c.stdout.on('data', keep);
    c.stderr.on('data', keep);
    const kill = () => { if (c.pid) try { process.kill(-c.pid, 'SIGKILL'); } catch {} };
    // Prepended, so the group is dead before an earlier 'exit' hook (mutationCheckItem's removal of its copy) runs.
    process.prependListener('exit', kill);
    const deadline = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    const finish = (code: number | null, signal: NodeJS.Signals | null, note = '') => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline); clearTimeout(graceTimer);
      kill();
      process.removeListener('exit', kill);
      c.stdin.destroy(); c.stdout.destroy(); c.stderr.destroy();
      resolve({ exit_code: code, timed_out: timedOut, signal, output_tail: (tail + note).slice(-OUTPUT_TAIL) });
    };
    c.stdin.on('error', () => {}); // the keeper gone before its lifeline is closed: nothing to report
    c.on('error', e => finish(null, null, `\n${e.message}`));
    c.on('exit', (code, signal) => {
      kill(); // argv has exited: its background children go with the group, which lets the output pipes close
      graceTimer = setTimeout(() => finish(code, signal), CLOSE_GRACE_MS);
    });
    c.on('close', (code, signal) => finish(code, signal));
  });
}

const snippet = (source: string, loc: any): string => {
  const lines = source.split('\n'), s = loc.start, e = loc.end;
  const text = s.line === e.line ? (lines[s.line - 1] ?? '').slice(s.column - 1, e.column - 1) : [(lines[s.line - 1] ?? '').slice(s.column - 1), ...lines.slice(s.line, e.line - 1), (lines[e.line - 1] ?? '').slice(0, e.column - 1)].join('\n');
  return text.length > 120 ? text.slice(0, 117) + '...' : text;
};

/** One item: a scratch copy at base (its own repository, as a pool run's, so nothing is registered in the pool's repo and a killed
 * validate leaves no worktree behind) with reference.patch applied and the hidden tests copied in, mutated in place (the copy is
 * thrown away) with the hidden command as Stryker's command runner. Config and report stay outside the copy. A git, tar or
 * StrykerJS child killed by SIGINT, SIGTERM or SIGHUP means validate is being stopped: that is an Interrupted, not an item error. */
export async function mutationCheckItem(o: { repo: string; baseCommit: string; item: HiddenItem; scratch: string; concurrency?: number; timeoutMs?: number; nodeVersion?: string }): Promise<MutationResult> {
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
  const what = `mutation check of ${o.item.id}`;
  // Retried: a process that was just killed can still be letting go of the copy (ENOTEMPTY). A copy that cannot be removed is
  // left in the scratch dir rather than replacing the item's result.
  const removeCopy = () => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {} };
  // validate's stop handlers end it with process.exit, which skips `finally`: this hook removes the copy then, after
  // runGrouped's own hook has killed StrykerJS's group.
  process.on('exit', removeCopy);
  const stopped = async (signal: string | null | undefined) => {
    const s = stoppedBy(signal);
    if (!s) return;
    await letSignalsIn(); // a stop signal validate got too ends it here, through its own handlers
    throw new Interrupted(s, what);
  };
  try {
    try {
      isolatedRepo(o.repo, o.baseCommit, wt);
      linkNodeModules(o.repo, wt);
    } catch (e) { await stopped((e as { signal?: string } | null)?.signal); throw e; }
    const applied = spawnSync('git', ['apply', '--whitespace=nowarn', o.item.patchPath], { cwd: wt, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    await stopped(applied.signal);
    if (applied.status !== 0) return done({ error: ('reference.patch did not apply: ' + applied.stderr).slice(-500) });
    copyHiddenTests(o.item, wt);
    writeFileSync(config, JSON.stringify({
      testRunner: 'command', commandRunner: { command: o.item.cmd }, coverageAnalysis: 'off', mutate: result.ranges, inPlace: true,
      reporters: ['json'], jsonReporter: { fileName: reportPath }, plugins: [], concurrency, logLevel: 'warn', cleanTempDir: 'always',
      dryRunTimeoutMinutes: Math.max(1, Math.ceil(timeoutMs / 60_000)),
    }, null, 2));
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // inherited from an outer node --test, it makes the hidden node --test exit 0 and every mutant survive
    await letSignalsIn(); // a stop that came while the copy was made ends validate here, before StrykerJS starts
    // StrykerJS runs on this Node (the one the engines check above passed), not on whichever node its shebang finds first on PATH.
    const r = await runGrouped([process.execPath, stryker.bin, 'run', config], wt, timeoutMs, env);
    await stopped(r.signal);
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
    process.removeListener('exit', removeCopy);
    removeCopy();
  }
}
