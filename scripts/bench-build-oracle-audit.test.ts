/** Non-author oracle contract audit. Billing-v1 failures are preserved at 6d8be83 and
 * bench/build-suite-evidence/billing-v1; this active suite targets its ledger replacement. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildLedgerSrc, LEDGER_DEFECTS, writeLedgerTask } from './bench-build-ledger-gen.ts';

function score(task: string, workspace: string, allowRejection = false) {
  const run = spawnSync(process.execPath, ['--import', 'tsx', join(task, 'oracle', 'score.ts'), workspace],
    { encoding: 'utf8', timeout: 30_000 });
  if (allowRejection && Number.isInteger(run.status) && run.status! >= 2 && run.stderr.trim()) return null;
  assert.ok(run.status === 0 || run.status === 1, run.stderr);
  assert.ok(run.stdout.trim(), run.stderr || 'oracle emitted no JSON');
  return JSON.parse(run.stdout);
}

test('generated baseline counts each plant once and has no failing regression', async () => {
  const root = mkdtempSync(join(tmpdir(), 'build-oracle-baseline-'));
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    const task = join(root, 'task');
    const inst = await writeLedgerTask(3, task);
    const scored = score(task, join(task, 'public'));
    assert.equal(scored.defects_caught, 0);
    assert.equal(scored.regressions_failed, 0, JSON.stringify(scored));
    assert.equal(scored.defects_shipped, inst.defects.length);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('breaking a known but unplanted catalogue behaviour is a shipped regression', () => {
  const task = resolve('tasks/build-ledger-s1');
  const workspace = mkdtempSync(join(tmpdir(), 'build-oracle-new-defect-'));
  try {
    cpSync(join(task, 'public'), workspace, { recursive: true });
    const inst = JSON.parse(readFileSync(join(task, 'oracle', 'instance.json'), 'utf8'));
    const unplanted = LEDGER_DEFECTS.find(id => !inst.defects.includes(id))!;
    assert.ok(unplanted);
    for (const [file, source] of Object.entries(buildLedgerSrc(inst, new Set<string>(inst.defects)))) writeFileSync(join(workspace, 'src', file), source);
    assert.equal(score(task, workspace).defects_shipped, 0, 'reference must be clean before the attack');
    for (const [file, source] of Object.entries(buildLedgerSrc({...inst,defects:[...inst.defects,unplanted]}, new Set<string>(inst.defects)))) writeFileSync(join(workspace, 'src', file), source);
    const scored = score(task, workspace);
    assert.equal(scored.defects_caught, inst.defects.length, 'original plants remain repaired');
    assert.ok(scored.regression_failed_ids.includes(unplanted));
    assert.ok(scored.defects_shipped > 0, JSON.stringify(scored));
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

for (const attack of ['stringify', 'stdout-exit']) test(`candidate ${attack} changes cannot forge all hidden checks passing`, () => {
  const task = resolve('tasks/build-ledger-s1');
  const workspace = mkdtempSync(join(tmpdir(), 'build-oracle-forgery-'));
  try {
    cpSync(join(task, 'public'), workspace, { recursive: true });
    const source = join(workspace, 'src', 'warehouse.ts');
    const mutation = attack === 'stringify' ? `
const originalStringify = JSON.stringify;
JSON.stringify = function(value, ...args) {
  if (value && typeof value === 'object' && 'oracle_results' in value) return originalStringify(value, ...args);
  return 'null';
};
` : `
import {readFileSync as attackRead} from 'node:fs';
import {dirname as attackDir,join as attackJoin} from 'node:path';
process.on('exit', () => {
  const expected=JSON.parse(attackRead(attackJoin(attackDir(process.argv[1]),'expected.json'),'utf8'));
  const forged=Object.fromEntries(Object.entries(expected).map(([id,value])=>[id,{ok:true,value}]));
  process.stdout.write('\\n@@RESULT@@'+JSON.stringify(forged)+'\\n');
});
`;
    writeFileSync(source, readFileSync(source, 'utf8') + mutation);
    const scored = score(task, workspace, true);
    if (scored === null) return; // Explicit rejection is safe; counterfeit success is not.
    assert.equal(scored.defects_caught, 0, 'no planted function was repaired by this mutation');
    assert.equal(scored.score, 0);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test('scorer from an unrelated cwd never charges loader failure as shipped defects', () => {
  const task=resolve('tasks/build-ledger-s1');
  const run=spawnSync(process.execPath,['--import',import.meta.resolve('tsx'),join(task,'oracle','score.ts'),join(task,'fixtures','correct')],
    {cwd:tmpdir(),encoding:'utf8',timeout:30_000});
  assert.equal(run.error,undefined);
  if(run.status!==0 && run.status!==1) {
    assert.ok(run.stderr.trim(),'infrastructure rejection needs a diagnostic');
    return;
  }
  const scored=JSON.parse(run.stdout);
  assert.equal(scored.score,1,'a runner/import failure must not become false defect misses');
  assert.equal(scored.defects_shipped,0);
});
