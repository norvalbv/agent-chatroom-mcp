/** Private oracle for a generated ledger-scale task. node --import tsx oracle/score.ts WORKSPACE
 * Same anti-tamper design as bench-build-ledger-gen.ts's oracle: the workspace runs only in a permission-
 * restricted child (oracle/run.ts) naming only run.ts, scenarios.ts and the workspace itself as readable, no
 * inherited env, native TypeScript; the result travels over fd 3, never shared stdout. Classification order:
 * a permission wall hit is always tamper; any nonzero exit is infrastructure; only a clean exit with an empty,
 * unparseable or non-object fd 3 is tamper.
 */
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
function readSingleResult(fd3) {
  if (!fd3) return null;
  try { return JSON.parse(fd3); } catch { return null; }
}
function rejectSymlinks(path) {
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
let candidate;
try {
  const resolved = resolve(workspace);
  if (lstatSync(resolved).isSymbolicLink()) throw new Error('oracle infrastructure: workspace symlink is forbidden');
  candidate = realpathSync(resolved);
  rejectSymlinks(candidate);
} catch (error) { console.error('oracle infrastructure: ' + String(error)); process.exit(3); }
const shardIds = inst.perShard.map((s) => s.shard);
const mByShard = Object.fromEntries(inst.perShard.map((s) => [s.shard, s.m]));
const child = spawnSync(process.execPath, [
  '--permission', '--allow-fs-read=' + runner, '--allow-fs-read=' + scenarios, '--allow-fs-read=' + candidate,
  runner, candidate, JSON.stringify(shardIds), JSON.stringify(mByShard),
], { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024, env: {}, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
const fd3 = child.output?.[3];
const stderr = (child.stderr ?? '').trim();
const parsedFd3 = readSingleResult(fd3);
const isValidObject = parsedFd3 !== null && typeof parsedFd3 === 'object' && !Array.isArray(parsedFd3);
const accessDenied = /ERR_ACCESS_DENIED|EACCES/.test(stderr);
if (accessDenied || child.status !== 0 || !isValidObject) {
  const isTamper = accessDenied || (child.status === 0 && !isValidObject);
  console.error((isTamper ? 'oracle infrastructure: tamper (' : 'oracle infrastructure: worker produced no result (') + stderr + ')');
  process.exit(isTamper ? 3 : 2);
}
const got = parsedFd3;
function subset(exp, act) {
  if (Array.isArray(exp)) return Array.isArray(act) && act.length === exp.length && exp.every((e, i) => subset(e, act[i]));
  if (exp && typeof exp === 'object') return !!act && typeof act === 'object' && !Array.isArray(act) && Object.entries(exp).every(([k, v]) => subset(v, act[k]));
  return Object.is(exp, act);
}
const run = (shard, id) => !!got[shard]?.[id]?.ok && subset(expected[shard]?.[id], got[shard]?.[id]?.value);
const oracle_results = [];
const caught_ids = [], missed_ids = [], regression_failed_ids = [];
for (const s of inst.perShard) {
  for (const id of s.defects) { const ok = run(s.shard, id); oracle_results.push({ name: 'defect/' + s.shard + '-' + id, exit_code: ok ? 0 : 1 }); (ok ? caught_ids : missed_ids).push(s.shard + '-' + id); }
  const nonPlanted = Object.keys(expected[s.shard] ?? {}).filter((k) => (k.startsWith('S') && !s.defects.includes(k)) || k.startsWith('R'));
  for (const id of nonPlanted) { const ok = run(s.shard, id); oracle_results.push({ name: 'regression/' + s.shard + '-' + id, exit_code: ok ? 0 : 1 }); if (!ok) regression_failed_ids.push(s.shard + '-' + id); }
}
const score = missed_ids.length === 0 && regression_failed_ids.length === 0 ? 1 : 0;
console.log(JSON.stringify({ score, oracle_results, defects_planted: caught_ids.length + missed_ids.length, defects_caught: caught_ids.length, defects_shipped: missed_ids.length + regression_failed_ids.length, regressions_failed: regression_failed_ids.length, caught_ids, missed_ids, regression_failed_ids }));
process.exit(score === 1 ? 0 : 1);
