/** Private oracle for a generated rule-bank task. node --import tsx oracle/score.ts WORKSPACE
 * One defect/<id> check per planted rule (its boundary calls), one regression/<id> check per rule (calls that hold in the
 * original code). Prints {score, oracle_results, defects_planted, defects_caught, defects_shipped, regressions_failed, ...}.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspace = process.argv[2];
if (!workspace) { console.error('usage: score.ts WORKSPACE'); process.exit(2); }
const here = dirname(fileURLToPath(import.meta.url));
const inst = JSON.parse(readFileSync(join(here, 'instance.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(here, 'expected.json'), 'utf8'));
const mods: Record<string, any> = {};
const broken = new Set<string>();
for (const n of new Set<string>(inst.checks.map((c: any) => c.module))) {
  try { mods[n] = await import(pathToFileURL(resolve(workspace, 'src', n + '.ts')).href + '?t=' + Date.now()); }
  catch { broken.add(n); }
}
const J = (x: unknown) => JSON.stringify(x === undefined ? null : x);
function run(c: any, which: 'defect' | 'reg'): boolean {
  if (broken.has(c.module)) return false;
  try { return c[which].every((args: unknown[], i: number) => J(mods[c.module][c.fn](...args)) === J(expected[c.id][which][i])); }
  catch { return false; }
}
const oracle_results: { name: string; exit_code: number }[] = [];
const caught_ids: string[] = [], missed_ids: string[] = [], regression_failed_ids: string[] = [];
for (const c of inst.checks) {
  if (inst.defects.includes(c.id)) { const ok = run(c, 'defect'); oracle_results.push({ name: 'defect/' + c.id, exit_code: ok ? 0 : 1 }); (ok ? caught_ids : missed_ids).push(c.id); }
  const ok = run(c, 'reg'); oracle_results.push({ name: 'regression/' + c.id, exit_code: ok ? 0 : 1 }); if (!ok) regression_failed_ids.push(c.id);
}
const score = missed_ids.length === 0 && regression_failed_ids.length === 0 ? 1 : 0;
console.log(JSON.stringify({ score, oracle_results, defects_planted: inst.defects.length, defects_caught: caught_ids.length, defects_shipped: missed_ids.length + regression_failed_ids.length, regressions_failed: regression_failed_ids.length, caught_ids, missed_ids, regression_failed_ids }));
process.exit(score === 1 ? 0 : 1);
