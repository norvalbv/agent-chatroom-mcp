/** Non-author oracle contract audit. Billing-v1 failures are preserved at 6d8be83 and
 * bench/build-suite-evidence/billing-v1; this active suite targets its ledger replacement. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildLedgerSrc, LEDGER_DEFECTS, writeLedgerTask } from './bench-build-ledger-gen.ts';

function score(task: string, workspace: string) {
  const run = spawnSync(process.execPath, ['--import', 'tsx', join(task, 'oracle', 'score.ts'), workspace],
    { encoding: 'utf8', timeout: 30_000 });
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
    const scored = score(task, workspace);
    assert.equal(scored.defects_caught, 0, 'no planted function was repaired by this mutation');
    assert.equal(scored.score, 0);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test('DOCUMENTED RESIDUAL: a workspace that knows the private oracle forges its own dedicated fd and exits before the real write, defeating fd-isolation too — this requires reading oracle/run.ts, which no arm run through bench-rq1.ts ever sees (only public/ is copied into a workspace, and anti-tamper hashing checks the task tree is unchanged after scoring); it is not closeable without real OS-level process sandboxing, which this suite does not implement (same acknowledged limit as tasks/complementary-fix/oracle/score.ts\'s own comment: "Path separation is not a sandbox. Run untrusted code in a restricted process."). Recorded so nobody re-discovers this as a surprise.', () => {
  const task = resolve('tasks/build-ledger-s1');
  const workspace = mkdtempSync(join(tmpdir(), 'build-oracle-fd3-'));
  try {
    cpSync(join(task, 'public'), workspace, { recursive: true });
    const meta = JSON.parse(readFileSync(join(task, 'oracle/instance.json'), 'utf8'));
    const file = join(workspace, 'src', 'warehouse.ts');
    writeFileSync(file, readFileSync(file, 'utf8') + `
{
  const fs = require('node:fs');
  const path = require('node:path');
  try {
    const here = path.dirname(process.argv[1]);
    const expected = JSON.parse(fs.readFileSync(path.join(here, 'expected.json'), 'utf8'));
    const forged = {};
    for (const k of Object.keys(expected)) forged[k] = { ok: true, value: expected[k] };
    fs.writeSync(3, JSON.stringify(forged));
  } catch (e) {}
  process.exit(0);
}
`);
    const run = spawnSync(process.execPath, ['--import', 'tsx', join(task, 'oracle', 'score.ts'), workspace], { encoding: 'utf8', timeout: 30_000 });
    const scored = JSON.parse(run.stdout);
    // Documents, does not defend against: this succeeds (score 1) given source knowledge no real arm has.
    assert.equal(scored.score, 1, 'if this ever fails, the residual limitation above is now fixed and this test/comment should be updated');
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});
