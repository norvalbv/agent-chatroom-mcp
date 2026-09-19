/** Private oracle for a generated rule-bank task. node --import tsx oracle/score.ts WORKSPACE
 * The workspace runs only in a child process (oracle/run.ts) and comes back as plain data; this parent never imports it.
 * One defect/<id> check per planted rule (its boundary calls), one regression/<id> check per rule (calls that hold in the original code;
 * for an unplanted rule these include its boundary calls, so reintroducing that defect is scored as shipped).
 * Prints {score, oracle_results, defects_planted, defects_caught, defects_shipped, regressions_failed, ...}.
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
let got: Record<string, { defect: any[]; reg: any[] }> = {};
try { got = JSON.parse(child.stdout.slice(child.stdout.lastIndexOf('@@RESULT@@') + 10)); } catch { got = {}; }
function run(id: string, which: 'defect' | 'reg'): boolean {
  const exp = expected[id][which], act = got[id]?.[which];
  if (!act || act.length !== exp.length) return false;
  return exp.every((e: unknown, i: number) => act[i]?.ok === true && JSON.stringify(act[i].value) === JSON.stringify(e));
}
const oracle_results: { name: string; exit_code: number }[] = [];
const caught_ids: string[] = [], missed_ids: string[] = [], regression_failed_ids: string[] = [];
for (const c of inst.checks) {
  if (inst.defects.includes(c.id)) { const ok = run(c.id, 'defect'); oracle_results.push({ name: 'defect/' + c.id, exit_code: ok ? 0 : 1 }); (ok ? caught_ids : missed_ids).push(c.id); }
  const ok = run(c.id, 'reg'); oracle_results.push({ name: 'regression/' + c.id, exit_code: ok ? 0 : 1 }); if (!ok) regression_failed_ids.push(c.id);
}
const score = missed_ids.length === 0 && regression_failed_ids.length === 0 ? 1 : 0;
console.log(JSON.stringify({ score, oracle_results, defects_planted: inst.defects.length, defects_caught: caught_ids.length, defects_shipped: missed_ids.length + regression_failed_ids.length, regressions_failed: regression_failed_ids.length, caught_ids, missed_ids, regression_failed_ids }));
process.exit(score === 1 ? 0 : 1);
