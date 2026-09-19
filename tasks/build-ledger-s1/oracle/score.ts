/** Private oracle for a generated ledger task. node --import tsx oracle/score.ts WORKSPACE
 * The workspace code runs only in a child process (oracle/run.ts) and is read back as plain data; this parent never imports it,
 * so a workspace cannot monkey-patch the comparison. A check passes when every key of the frozen expected value is deep-equal in the
 * result (extra fields and key order are ignored; the SPEC declares the snapshot shape frozen).
 * defect/<id>: scenario for a planted defect; regression/<id>: R* scenarios and the scenario of every catalogued defect that is NOT planted
 * in this instance (they hold in the original code, so reintroducing one of those defects is scored as shipped).
 *
 * Two layers against a workspace that tries to forge its own result (fable-review G1/G2; 6-astra-4's oracle-audit hardening):
 * (1) the child is launched under Node's --permission allowlist naming only run.ts, scenarios.ts and the workspace itself as
 * readable, with no inherited env and native TypeScript (no tsx, so no cwd-dependent loader resolution); it can never read
 * expected.json, so even a source-informed forger cannot produce the *correct* values, only guesses. Symlinks under the
 * workspace are rejected before launch. (2) the result itself still travels over a dedicated pipe (fd 3), not shared stdout,
 * written only by run.ts's own captured fs.writeSync reference; an empty or malformed fd 3 is refused outright.
 */
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
function readSingleResult(fd3: string | null | undefined): unknown {
  if (!fd3) return null;
  try { return JSON.parse(fd3); } catch { return null; }
}
function rejectSymlinks(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error('oracle infrastructure: workspace symlink is forbidden');
  if (stat.isDirectory()) for (const name of readdirSync(path)) rejectSymlinks(join(path, name));
}

const workspace = process.argv[2];
if (!workspace) { console.error('usage: score.ts WORKSPACE'); process.exit(2); }
const here = dirname(fileURLToPath(import.meta.url));
const inst = JSON.parse(readFileSync(join(here, 'instance.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(here, 'expected.json'), 'utf8'));
const runner = realpathSync(join(here, 'run.ts'));
const scenarios = realpathSync(join(here, 'scenarios.ts'));
let candidate: string;
try {
  const resolved = resolve(workspace);
  if (lstatSync(resolved).isSymbolicLink()) throw new Error('oracle infrastructure: workspace symlink is forbidden');
  candidate = realpathSync(resolved);
  rejectSymlinks(candidate);
} catch (error) { console.error('oracle infrastructure: ' + String(error)); process.exit(3); }
const child = spawnSync(process.execPath, [
  '--permission', '--allow-fs-read=' + runner, '--allow-fs-read=' + scenarios, '--allow-fs-read=' + candidate,
  runner, candidate, String(inst.m),
], { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024, env: {}, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
const fd3 = child.output?.[3] as string | null;
const stderr = (child.stderr ?? '').trim();
const parsedFd3 = readSingleResult(fd3);
const isValidObject = parsedFd3 !== null && typeof parsedFd3 === 'object' && !Array.isArray(parsedFd3);
// Classification (checked in this order): a permission wall the sandboxed child hit while attempting something
// forbidden is always tamper, regardless of exit status. Otherwise a nonzero exit -- the process itself failed
// or was killed, for any reason, with or without a (possibly partial) fd 3 write -- is infrastructure, never a
// candidate's shipped defects: run.ts's own final write and process.exit(0) are the only path to success, so
// nothing a candidate does can make the *worker itself* fail; only our scorer/harness can. Only once both of
// those are ruled out does an empty, unparseable or non-object fd 3 become tamper: run.ts always writes a
// well-formed object before its own clean process.exit(0), so a clean exit without one means a candidate forged
// or suppressed the write.
const accessDenied = /ERR_ACCESS_DENIED|EACCES/.test(stderr);
if (accessDenied || child.status !== 0 || !isValidObject) {
  const isTamper = accessDenied || (child.status === 0 && !isValidObject);
  console.error((isTamper ? 'oracle infrastructure: tamper (' : 'oracle infrastructure: worker produced no result (') + stderr + ')');
  process.exit(isTamper ? 3 : 2);
}
let got: Record<string, { ok: boolean; value?: unknown }> = parsedFd3 as typeof got;
function subset(exp: unknown, act: unknown): boolean {
  if (Array.isArray(exp)) return Array.isArray(act) && act.length === exp.length && exp.every((e, i) => subset(e, act[i]));
  if (exp && typeof exp === 'object') return !!act && typeof act === 'object' && !Array.isArray(act) && Object.entries(exp).every(([k, v]) => subset(v, (act as any)[k]));
  return Object.is(exp, act);
}
const run = (id: string) => !!got[id]?.ok && subset(expected[id], got[id].value);
const oracle_results: { name: string; exit_code: number }[] = [];
const caught_ids: string[] = [], missed_ids: string[] = [], regression_failed_ids: string[] = [];
for (const id of inst.defects) { const ok = run(id); oracle_results.push({ name: 'defect/' + id, exit_code: ok ? 0 : 1 }); (ok ? caught_ids : missed_ids).push(id); }
for (const id of Object.keys(expected).filter((k) => k.startsWith('R') || (k.startsWith('S') && !inst.defects.includes(k)))) { const ok = run(id); oracle_results.push({ name: 'regression/' + id, exit_code: ok ? 0 : 1 }); if (!ok) regression_failed_ids.push(id); }
const score = missed_ids.length === 0 && regression_failed_ids.length === 0 ? 1 : 0;
console.log(JSON.stringify({ score, oracle_results, defects_planted: inst.defects.length, defects_caught: caught_ids.length, defects_shipped: missed_ids.length + regression_failed_ids.length, regressions_failed: regression_failed_ids.length, caught_ids, missed_ids, regression_failed_ids }));
process.exit(score === 1 ? 0 : 1);
