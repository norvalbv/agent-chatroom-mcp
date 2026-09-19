/** Offline report contract; no provider calls. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildConfirmatoryTable, loadConfirmatoryRuns, renderConfirmatoryMarkdown, exactPower, type ConfirmatoryRun } from './paper-rq1-confirmatory.js';
import { fisherExactTest, holmBonferroni } from './rq1-stats.js';

function run(arm: string, seed: number, pass = true, task = 'stamp-interpreter'): ConfirmatoryRun {
  return { task_id: task, arm, seed, outcome: pass ? 'task_pass' : 'task_fail', cost_usd: 0.1, thinking_tokens: 1200, output_tokens: 1800, wall_ms: 10000, exit_codes: [0] };
}

test('all five arms, Wilson interval and fixed fourteen Fisher comparisons, partial family never shrinks', () => {
  const runs: ConfirmatoryRun[] = [];
  for (let seed = 501; seed <= 520; seed++) for (const arm of ['A', 'AH', 'B', 'K', 'C']) runs.push(run(arm, seed, seed <= (arm === 'C' ? 515 : 510)));
  const table = buildConfirmatoryTable(runs);
  assert.equal(table.comparisons.length, 14);
  const a = table.cells.find(c => c.task === 'stamp-interpreter' && c.arm === 'A' && c.regime === 'calibrated')!;
  assert.equal(a.n, 20); assert.equal(a.pass_rate, 0.5);
  assert.ok(Math.abs(a.wilson![0] - 0.2993) < 0.0001);
  assert.equal(a.cost_per_correct, 0.20000000000000004);
  const bc = table.comparisons.find(c => c.task === 'stamp-interpreter' && c.left === 'B' && c.right === 'C')!;
  assert.equal(bc.p_raw, fisherExactTest(10, 10, 15, 5).p_value);
  const expected = holmBonferroni(table.comparisons.map(c => c.p_raw ?? 1));
  assert.equal(bc.p_holm, expected[table.comparisons.indexOf(bc)]);
  assert.equal(table.missing.length, 100);
});

test('A sentinel splits all five arms by seed; missing thinking and absent A are unknown, never zero', () => {
  const rs = [run('A', 501), run('C', 501), run('A', 502), run('C', 502), run('A', 503), run('C', 503), run('C', 504)];
  rs[2].thinking_tokens = 9000; rs[2].output_tokens = 11000; rs[4].thinking_tokens = null;
  const t = buildConfirmatoryTable(rs);
  assert.deepEqual(t.sentinels.filter(s => s.task === 'stamp-interpreter').slice(0,4).map(s => s.regime), ['calibrated', 'long-thinking', 'unknown', 'unknown']);
  for (const [regime, n] of [['calibrated',1],['long-thinking',1],['unknown',2]] as const) assert.equal(t.cells.find(c => c.task === 'stamp-interpreter' && c.arm === 'C' && c.regime === regime)!.n, n);
  assert.equal(t.comparisons.find(c => c.task === 'stamp-interpreter' && c.left === 'C' && c.right === 'A')!.left_n, 1);
  assert.match(renderConfirmatoryMarkdown(t), /never evidence of equality/i);
});

test('unknown cost poisons totals; non-comparable outcomes remain listed; K null groups count as failures', () => {
  const a = run('A',501), b = run('B',501), k = run('K',501);
  b.cost_usd = null; b.outcome = 'timeout'; k.outcome = 'infrastructure_error'; k.cost_usd = null;
  const t = buildConfirmatoryTable([a,b,k]);
  const bc = t.cells.find(c => c.arm === 'B' && c.regime === 'calibrated' && c.task === a.task_id)!;
  assert.equal(bc.n,1); assert.equal(bc.denominator,1); assert.equal(bc.total_cost_usd,null); assert.equal(bc.cost_per_correct,'unknown');
  const kc = t.cells.find(c => c.arm === 'K' && c.regime === 'calibrated' && c.task === a.task_id)!;
  assert.equal(kc.denominator,1); assert.equal(kc.passes,0);
});

test('4000 is outside calibrated band and AH tokens cannot classify A', () => {
  const a=run('A',501), ah=run('AH',501); a.output_tokens=3999;ah.output_tokens=10000;
  assert.equal(buildConfirmatoryTable([a,ah]).sentinels[0].regime,'calibrated');
  a.output_tokens=4000;assert.equal(buildConfirmatoryTable([a,ah]).sentinels[0].regime,'long-thinking');
  a.thinking_tokens=Number.NaN;assert.equal(buildConfirmatoryTable([a,ah]).sentinels[0].regime,'unknown');
});

test('fresh seeds only; duplicate observations are refused', () => {
  assert.equal(buildConfirmatoryTable([run('A',500)]).cells.every(c => c.n === 0),true);
  assert.throws(() => buildConfirmatoryTable([run('A',501),run('A',501)]), /duplicate/i);
});

test('exact prospective power reproduces prior independent Bernoulli enumeration at n=20', () => {
  assert.ok(Math.abs(exactPower(20,0.8,1,0.05)-0.3704)<0.00005);
  assert.ok(exactPower(20,0.8,1,0.05/14) < exactPower(20,0.8,1,0.05));
});

test('stub executable emits real directory layout; report reads all K attempt provenance and CLI writes artifacts', () => {
  const dir = mkdtempSync(join(tmpdir(),'confirmatory-report-'));
  try {
    const fixture = join(dir,'stub.mjs');
    writeFileSync(fixture, `import {mkdirSync,writeFileSync} from 'node:fs'; import {join} from 'node:path';
const root=process.argv[2]; const base={task_id:'stamp-interpreter',arm:'A',seed:501,outcome:'task_pass',usage:{cost_usd:.1,coverage:'complete',output_tokens:1800},wall_clock:{duration_ms:10000},seats:[{exit_code:0,model_usage:{sonnet:{thinkingTokens:1200}}}]};
function put(p,r){mkdirSync(p,{recursive:true});writeFileSync(join(p,'result.json'),JSON.stringify(r));}
put(join(root,'stamp-interpreter-A-seed501'),base);
const k=join(root,'stamp-interpreter-K-seed501'); put(k,{...base,arm:'K',k:2,usage:{cost_usd:.2},seats:undefined,attempts:[{index:1,cost_usd:.1},{index:2,cost_usd:.1}]});
put(join(k,'attempt-1'),base);put(join(k,'attempt-2'),base);`);
    assert.equal(spawnSync(process.execPath,[fixture,dir]).status,0);
    const loaded=loadConfirmatoryRuns(dir); assert.equal(loaded.runs.length,2);
    const k=loaded.runs.find(r=>r.arm==='K')!; assert.equal(k.thinking_tokens,2400); assert.equal(k.output_tokens,3600);
    const cli=spawnSync(process.execPath,['--import','tsx','scripts/paper-rq1-confirmatory.ts',dir,'--out',join(dir,'table')],{cwd:resolve('.'),encoding:'utf8'});
    assert.equal(cli.status,0,cli.stderr);assert.match(cli.stdout,/Holm.*14/);
    rmSync(join(dir,'stamp-interpreter-K-seed501','attempt-2','result.json'));
    assert.equal(loadConfirmatoryRuns(dir).runs.find(r=>r.arm==='K')!.thinking_tokens,null);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
