/** Scaled variant of the ledger family (scripts/bench-build-ledger-gen.ts): N independently-seeded warehouse
 * instances (src/wh01/ .. src/whNN/, five files each: types, inventory, orders, backorder, warehouse), each
 * drawing its own 9-of-14 catalogued S01-S14 defects via the SAME deriveLedger/buildLedgerSrc mechanism, unchanged.
 * No new defect kind and no coupling between shards: this isolates the module-count/total-size axis (does a
 * single agent's read budget run out before every shard is checked) from the cross-module-invariant axis, which
 * the unscaled family already exercises within a shard. Known limitation (see room swarm-212551-3vhd): because
 * only 14 possible single-line variants exist per shard, a positional diff across shards can shortcut the search;
 * this is a replication-volume axis, reported as such, and the screen transcripts are checked for that shortcut.
 *   node --import tsx scripts/bench-build-ledger-scale-gen.ts <seed> <shards> [--out dir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BRIEF, LEDGER_DEFECTS, LEDGER_KIND, PUBLIC_TESTS, SCENARIOS, SPEC, buildLedgerSrc, deriveLedger } from './bench-build-ledger-gen.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const R_IDS = Object.keys(SCENARIOS).filter((k) => k.startsWith('R'));

export type ShardInstance = { shard: string; seed: number; m: number; defects: string[] };
export type LedgerScaleInstance = { seed: number; shards: number; perShard: ShardInstance[] };

function pad(n: number): string { return String(n).padStart(2, '0'); }

export function deriveLedgerScale(seed: number, shards: number): LedgerScaleInstance {
  const perShard: ShardInstance[] = [];
  for (let i = 1; i <= shards; i++) {
    const shardSeed = seed * 100000 + i;
    const inst = deriveLedger(shardSeed);
    perShard.push({ shard: `wh${pad(i)}`, seed: shardSeed, m: inst.m, defects: inst.defects });
  }
  return { seed, shards, perShard };
}

const specBody = SPEC.slice(SPEC.indexOf('## Stock and expiry'));
function specScale(n: number): string {
  return `# Warehouse fulfilment specification (${n} independent warehouses)

There are ${n} independent warehouses, one per subdirectory \`src/wh01\` through \`src/wh${pad(n)}\`, each with its
own \`Warehouse\` class at \`src/whNN/warehouse.ts\`. Every warehouse must independently meet the specification
below; nothing about one warehouse's stock, orders or backorders affects any other warehouse. All quantities are
whole units; days are integers.

${specBody}`;
}

function briefScale(n: number): string {
  return BRIEF
    .replace('The warehouse library in src/', `Each of the ${n} independent warehouse libraries under src/wh01/ .. src/wh${pad(n)}/`)
    .replace('the code meets', 'that code meets')
    .replace('Make the codebase conform', 'Make every warehouse codebase conform');
}

function testsForShard(shard: string, m: number): string {
  return PUBLIC_TESTS(m).replace("from '../src/warehouse.ts';", `from '../src/${shard}/warehouse.ts';`);
}

export async function writeLedgerScaleTask(seed: number, shards: number, out: string) {
  const inst = deriveLedgerScale(seed, shards);
  const id = out.split('/').pop()!;
  const w = (rel: string, body: string) => { const f = join(out, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body); };
  for (const s of inst.perShard) {
    const all = new Set(s.defects);
    const ledgerInst = { seed: s.seed, m: s.m, defects: s.defects };
    const bad = buildLedgerSrc(ledgerInst, new Set());
    const good = buildLedgerSrc(ledgerInst, all);
    for (const [f, b] of Object.entries(bad)) { w(`public/src/${s.shard}/${f}`, b); w(`fixtures/broken/src/${s.shard}/${f}`, b); }
    for (const [f, b] of Object.entries(good)) w(`fixtures/correct/src/${s.shard}/${f}`, b);
    w(`public/test/${s.shard}.test.ts`, testsForShard(s.shard, s.m));
  }
  w('public/SPEC.md', specScale(shards));
  w('public/brief.txt', briefScale(shards) + '\n');

  const defect_ids = inst.perShard.flatMap((s) => s.defects.map((d) => `${s.shard}-${d}`));
  const regression_ids = inst.perShard.flatMap((s) => [...LEDGER_DEFECTS.filter((d) => !s.defects.includes(d)), ...R_IDS].map((d) => `${s.shard}-${d}`));
  w('task.json', JSON.stringify({ task_id: id, build_suite: { defect_ids, regression_ids } }) + '\n');
  w('oracle/oracle.json', JSON.stringify({ kind: 'planted-defects' }) + '\n');
  w('oracle/instance.json', JSON.stringify({ seed, shards, family: 'ledger-scale', perShard: inst.perShard }, null, 2) + '\n');
  w('oracle/DEFECTS.json', JSON.stringify(
    inst.perShard.flatMap((s) => s.defects.map((d) => ({ id: `${s.shard}-${d}`, module: s.shard, kind: LEDGER_KIND[d] }))),
    null, 2,
  ) + '\n');

  const expected: Record<string, Record<string, unknown>> = {};
  for (const s of inst.perShard) {
    const modUrl = pathToFileURL(resolve(out, `fixtures/correct/src/${s.shard}/warehouse.ts`)).href + '?t=' + Math.random();
    const { Warehouse } = await import(modUrl);
    const shardExpected: Record<string, unknown> = {};
    for (const [k, fn] of Object.entries(SCENARIOS)) shardExpected[k] = JSON.parse(JSON.stringify(fn(Warehouse, s.m)));
    expected[s.shard] = shardExpected;
  }
  w('oracle/expected.json', JSON.stringify(expected, null, 2) + '\n');
  w('oracle/scenarios.ts', `export const SCENARIOS: Record<string, (W: any, m: number) => unknown> = {\n${Object.entries(SCENARIOS).map(([k, f]) => `  ${k}: ${f.toString()},`).join('\n')}\n};\n`);
  w('oracle/score.ts', LEDGER_SCALE_SCORE);
  w('oracle/run.ts', LEDGER_SCALE_RUN);
  w('README.md', `# ${id}\n\nGenerated by scripts/bench-build-ledger-scale-gen.ts (seed ${seed}, ${shards} shards). Only public/ reaches a seat.\nPlanted (by shard): ${inst.perShard.map((s) => `${s.shard}: ${s.defects.join(',')}`).join('; ')}\n`);
  return inst;
}

const LEDGER_SCALE_RUN = `/** Child of oracle/score.ts: runs every scenario against every shard's workspace warehouse and prints the
 * results as data. It never sees expected.json. Result travels over fd 3 (a pipe score.ts owns), not shared
 * stdout, written only by this file's own writeSync reference captured before any workspace import runs.
 */
import { writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SCENARIOS } from './scenarios.ts';

const writeSyncFd3 = writeSync;
const stringify = JSON.stringify.bind(JSON);
const [workspace, shardsArg, mArg] = process.argv.slice(2);
const shardIds: string[] = JSON.parse(shardsArg);
const mByShard: Record<string, number> = JSON.parse(mArg);
const out: Record<string, Record<string, { ok: boolean; value?: unknown }>> = {};
for (const shard of shardIds) {
  let W: any = null;
  try { W = (await import(pathToFileURL(resolve(workspace, 'src', shard, 'warehouse.ts')).href)).Warehouse; } catch { W = null; }
  const shardOut: Record<string, { ok: boolean; value?: unknown }> = {};
  for (const id of Object.keys(SCENARIOS)) {
    try { shardOut[id] = W ? { ok: true, value: JSON.parse(stringify(SCENARIOS[id](W, Number(mByShard[shard])))) } : { ok: false }; } catch { shardOut[id] = { ok: false }; }
  }
  out[shard] = shardOut;
}
writeSyncFd3(3, stringify(out));
process.exit(0);
`;

const LEDGER_SCALE_SCORE = `/** Private oracle for a generated ledger-scale task. node --import tsx oracle/score.ts WORKSPACE
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
`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const seed = Number(process.argv[2]);
  const shards = Number(process.argv[3]);
  if (!Number.isInteger(seed) || !Number.isInteger(shards) || shards < 1) { console.error('usage: bench-build-ledger-scale-gen.ts <seed> <shards> [--out dir]'); process.exit(2); }
  const oi = process.argv.indexOf('--out');
  writeLedgerScaleTask(seed, shards, resolve(oi > 0 ? process.argv[oi + 1] : `tasks/build-ledger-scale${shards}-s${seed}`)).then((i) => console.log(i.perShard.map((s) => `${s.shard}:${s.defects.join(',')}`).join(' ')));
}
