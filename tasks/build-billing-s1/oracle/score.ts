/** Private oracle for a generated planted-defect task. Never copied into public/.
 * node --import tsx oracle/score.ts WORKSPACE
 * The workspace runs only in a child process (oracle/run.ts) and comes back as plain data; this parent never imports it.
 * defect/<id>: one per planted defect. regression/<id>: R* behaviours plus the check of every catalogued defect NOT planted here,
 * so reintroducing one is scored as shipped. score is 1 only when every planted defect is fixed and no regression fails.
 * Exit 0 = score 1, 1 = otherwise, 2 = usage.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = process.argv[2];
if (!workspace) { console.error('usage: score.ts WORKSPACE'); process.exit(2); }
const here = dirname(fileURLToPath(import.meta.url));
const inst = JSON.parse(readFileSync(join(here, 'instance.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(here, 'expected.json'), 'utf8'));
const child = spawnSync(process.execPath, ['--import', 'tsx', join(here, 'run.ts'), resolve(workspace)], { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
let got: Record<string, { ok: boolean; value?: unknown }> = {};
try { got = JSON.parse(child.stdout.slice(child.stdout.lastIndexOf('@@RESULT@@') + 10)); } catch { got = {}; }
const run = (id: string) => !!got[id]?.ok && JSON.stringify(got[id].value) === JSON.stringify(expected[id]);
const oracle_results: { name: string; exit_code: number }[] = [];
const caught_ids: string[] = [], missed_ids: string[] = [], regression_failed_ids: string[] = [];
for (const id of inst.defects) { const ok = run(id); oracle_results.push({ name: 'defect/' + id, exit_code: ok ? 0 : 1 }); (ok ? caught_ids : missed_ids).push(id); }
for (const id of Object.keys(expected).filter((k) => k.startsWith('R') || (k.startsWith('D') && !inst.defects.includes(k)))) { const ok = run(id); oracle_results.push({ name: 'regression/' + id, exit_code: ok ? 0 : 1 }); if (!ok) regression_failed_ids.push(id); }
const score = missed_ids.length === 0 && regression_failed_ids.length === 0 ? 1 : 0;
console.log(JSON.stringify({
  score, oracle_results, defects_planted: inst.defects.length, defects_caught: caught_ids.length,
  defects_shipped: missed_ids.length + regression_failed_ids.length, regressions_failed: regression_failed_ids.length,
  caught_ids, missed_ids, regression_failed_ids,
}));
process.exit(score === 1 ? 0 : 1);
