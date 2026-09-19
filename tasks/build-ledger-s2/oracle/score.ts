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
if (!fd3 && (child.status !== 0 || (child.stderr ?? '').trim())) {
  // A legitimate run (correct, broken or adversarial candidate) always writes SOMETHING to fd 3: run.ts's own
  // import is wrapped so even a candidate that fails to import still produces an all-false result before exiting.
  // An empty fd 3 alongside a nonzero exit or stderr means run.ts itself never reached that write -- our own
  // scorer/harness broke, not the candidate -- so this is infrastructure, never a candidate's shipped defects.
  console.error('oracle infrastructure: worker produced no result (' + (child.stderr ?? '').trim() + ')');
  process.exit(2);
}
let got: Record<string, { ok: boolean; value?: unknown }> = (readSingleResult(fd3) as typeof got) ?? {};
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
