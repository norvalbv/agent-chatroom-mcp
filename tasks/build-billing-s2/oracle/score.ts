/** Private oracle for a generated planted-defect task. Never copied into public/.
 * node --import tsx oracle/score.ts WORKSPACE
 * Output: {score, oracle_results, defects_planted, defects_caught, defects_shipped, regressions_failed, caught_ids, missed_ids, regression_failed_ids}.
 * score is 1 only when every planted defect is fixed and no regression check fails. Exit 0 = score 1, 1 = otherwise, 2 = usage.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHECKS } from './checks.ts';

const workspace = process.argv[2];
if (!workspace) { console.error('usage: score.ts WORKSPACE'); process.exit(2); }
const here = dirname(fileURLToPath(import.meta.url));
const inst = JSON.parse(readFileSync(join(here, 'instance.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(here, 'expected.json'), 'utf8'));
const names = ['money', 'types', 'calendar', 'plans', 'proration', 'coupons', 'tax', 'invoice', 'dunning', 'report'];

const mods: Record<string, any> = {};
let loadError = '';
for (const n of names) {
  try { mods[n] = await import(pathToFileURL(resolve(workspace, 'src', n + '.ts')).href + '?t=' + Date.now()); }
  catch (e) { loadError = String(e); }
}
function run(id: string): boolean {
  if (loadError) return false;
  try { return JSON.stringify(CHECKS[id](mods, inst.params)) === JSON.stringify(expected[id]); }
  catch { return false; }
}
const oracle_results: { name: string; exit_code: number }[] = [];
const caught_ids: string[] = [], missed_ids: string[] = [], regression_failed_ids: string[] = [];
for (const id of inst.defects) { const ok = run(id); oracle_results.push({ name: id, exit_code: ok ? 0 : 1 }); (ok ? caught_ids : missed_ids).push(id); }
for (const id of Object.keys(CHECKS).filter((k) => k.startsWith('R'))) { const ok = run(id); oracle_results.push({ name: id, exit_code: ok ? 0 : 1 }); if (!ok) regression_failed_ids.push(id); }
const score = missed_ids.length === 0 && regression_failed_ids.length === 0 ? 1 : 0;
console.log(JSON.stringify({
  score, oracle_results, defects_planted: inst.defects.length, defects_caught: caught_ids.length,
  defects_shipped: missed_ids.length + regression_failed_ids.length, regressions_failed: regression_failed_ids.length,
  caught_ids, missed_ids, regression_failed_ids,
}));
process.exit(score === 1 ? 0 : 1);
