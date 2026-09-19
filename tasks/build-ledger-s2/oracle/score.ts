/** Private oracle for a generated ledger task. node --import tsx oracle/score.ts WORKSPACE
 * The workspace code runs only in a child process (oracle/run.ts) and is read back as plain data; this parent never imports it,
 * so a workspace cannot monkey-patch the comparison. A check passes when every key of the frozen expected value is deep-equal in the
 * result (extra fields and key order are ignored; the SPEC declares the snapshot shape frozen).
 * defect/<id>: scenario for a planted defect; regression/<id>: R* scenarios and the scenario of every catalogued defect that is NOT planted
 * in this instance (they hold in the original code, so reintroducing one of those defects is scored as shipped).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
function readSingleResult(stdout: string): unknown {
  // fable-review G1: a workspace module could register a process 'exit' hook (or forge output at
  // import time) that prints a second, fabricated '@@RESULT@@' marker. Taking the last (or first)
  // occurrence lets an attacker pick which one wins. Instead: a legitimate run.ts prints the marker
  // exactly once; two or more occurrences is unambiguous evidence of tampering and is refused outright
  // (scored as no result, never as a pass), so forging a marker can only cost the attacker, never help.
  const marker = '@@RESULT@@';
  let count = 0, at = -1;
  for (let i = stdout.indexOf(marker); i !== -1; i = stdout.indexOf(marker, i + 1)) { count++; at = i; }
  if (count !== 1) return null;
  try { return JSON.parse(stdout.slice(at + marker.length)); } catch { return null; }
}


const workspace = process.argv[2];
if (!workspace) { console.error('usage: score.ts WORKSPACE'); process.exit(2); }
const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = "/Users/benji/Desktop/Personal and learning/agent-chatroom-mcp/.swarm-worktrees/swarm-191133-4hqx/sonnet-1";
const inst = JSON.parse(readFileSync(join(here, 'instance.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(here, 'expected.json'), 'utf8'));
const child = spawnSync(process.execPath, ['--import', 'tsx', join(here, 'run.ts'), resolve(workspace), String(inst.m)], { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024, cwd: REPO_ROOT });
let got: Record<string, { ok: boolean; value?: unknown }> = {};
got = (readSingleResult(child.stdout) as typeof got) ?? {};
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
