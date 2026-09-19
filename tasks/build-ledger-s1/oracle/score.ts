/** Private oracle for a generated ledger task. node --import tsx oracle/score.ts WORKSPACE
 * The workspace code runs only in a child process (oracle/run.ts) and is read back as plain data; this parent never imports it,
 * so a workspace cannot monkey-patch the comparison. A check passes when every key of the frozen expected value is deep-equal in the
 * result (extra fields and key order are ignored; the SPEC declares the snapshot shape frozen).
 * defect/<id>: scenario for a planted defect; regression/<id>: R* scenarios and the scenario of every catalogued defect that is NOT planted
 * in this instance (they hold in the original code, so reintroducing one of those defects is scored as shipped).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, lstatSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = process.argv[2];
if (!workspace) { console.error('usage: score.ts WORKSPACE'); process.exit(2); }
const here = dirname(fileURLToPath(import.meta.url));
const inst = JSON.parse(readFileSync(join(here, 'instance.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(here, 'expected.json'), 'utf8'));
// The worker may read its own code and the scenarios, never the expected-answer file.
// Native TypeScript removes resolution of a cwd-relative tsx loader from the child.
const candidate = realpathSync(workspace), runner = realpathSync(join(here, 'run.ts'));
const scenarios = realpathSync(join(here, 'scenarios.ts'));
function rejectLinks(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error('oracle infrastructure: workspace symlink is forbidden');
  if (stat.isDirectory()) for (const name of readdirSync(path)) rejectLinks(join(path, name));
}
try { rejectLinks(candidate); } catch (error) { console.error(String(error)); process.exit(2); }
const child = spawnSync(process.execPath, ['--permission', '--allow-fs-read=' + candidate,
  '--allow-fs-read=' + runner, '--allow-fs-read=' + scenarios, runner, candidate, String(inst.m)],
  { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024, env: {} });
if (child.error || child.status !== 0) {
  console.error('oracle infrastructure: worker failed: ' + (child.error?.message ?? child.stderr)); process.exit(2);
}
const frames = child.stdout.split('@@RESULT@@');
if (frames.length !== 2) { console.error('oracle infrastructure: ambiguous worker result frame'); process.exit(2); }
let got: Record<string, { ok: boolean; value?: unknown }> = {};
try { got = JSON.parse(frames[1]); } catch { console.error('oracle infrastructure: malformed worker result'); process.exit(2); }
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
