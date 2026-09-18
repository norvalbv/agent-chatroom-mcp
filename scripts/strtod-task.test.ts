/** tasks/bench-strtod: the reference passes every hidden case, the stub and two plausible naive implementations fail,
 * shelling out to another program fails, a missing artifact is a parse_failure, and public/ hides the answers.
 * Run: node --import tsx --test scripts/strtod-task.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';
const task = resolve('tasks/bench-strtod');
const workspace = () => { const d = mkdtempSync(join(tmpdir(), 'strtod-task-')); cpSync(join(task, 'public'), d, { recursive: true }); return d; };
const NAIVE_NUMBER_ARITHMETIC = `
export function strtod(s: string) {
  const m = s.match(/^[ \\t\\n\\v\\f\\r]*([+-]?)(?:(0[xX])([0-9a-fA-F]*)(?:\\.([0-9a-fA-F]*))?(?:[pP]([+-]?\\d+))?|(\\d*\\.?\\d*(?:[eE][+-]?\\d+)?))/);
  let v = 0, end = 0;
  if (m && m[2]) { let mant = 0; for (const c of (m[3] ?? '') + (m[4] ?? '')) mant = mant * 16 + parseInt(c, 16); v = mant * Math.pow(2, Number(m[5] ?? 0) - 4 * (m[4] ?? '').length); end = m[0].length; }
  else if (m && m[6]) { v = Number(m[6]); end = m[0].length; }
  if (m && m[1] === '-') v = -v;
  const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, v);
  return { bits: dv.getBigUint64(0).toString(16).padStart(16, '0'), end };
}`;
const SHELLS_OUT = `
import { execFileSync } from 'node:child_process';
export function strtod(s: string) {
  return JSON.parse(execFileSync('python3', ['-c', 'import sys,struct,json;print(json.dumps({"bits":struct.pack(">d",float(sys.argv[1])).hex(),"end":len(sys.argv[1])}))', s], { encoding: 'utf8' }));
}`;
test('kind dispatches to the generic private-test scorer', () => assert.equal(loadTask(task).oracle.kind, 'strtod'));
test('stub fails, reference passes, missing artifact is parse_failure', async () => {
  const d = workspace();
  try {
    assert.equal((await scoreTask(task, d)).reason, 'task_fail');
    cpSync(join(task, 'fixtures/correct/strtod.ts'), join(d, 'strtod.ts'));
    assert.equal((await scoreTask(task, d)).reason, 'task_pass');
    rmSync(join(d, 'strtod.ts'));
    assert.equal((await scoreTask(task, d)).reason, 'parse_failure');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
test('naive Number arithmetic for hex floats fails; shelling out to python fails', async () => {
  for (const src of [NAIVE_NUMBER_ARITHMETIC, SHELLS_OUT]) {
    const d = workspace();
    try { writeFileSync(join(d, 'strtod.ts'), src); const r = await scoreTask(task, d); assert.equal(r.passed, false); assert.equal(r.reason, 'task_fail'); }
    finally { rmSync(d, { recursive: true, force: true }); }
  }
});
test('the hidden cases cover the edges the README names', () => {
  const cases = JSON.parse(readFileSync(join(task, 'oracle/cases.json'), 'utf8')) as string[];
  const expected = JSON.parse(readFileSync(join(task, 'oracle/expected.json'), 'utf8')) as { bits: string; end: number }[];
  assert.equal(cases.length, expected.length);
  assert.ok(cases.length >= 400);
  for (const probe of ['0x', '0x1p', '0x.p1', '-0', 'inf', 'infinityx', 'nan(abc)', '5e', '0x1p-1075', '0x1.fffffffffffff8p1023']) assert.ok(cases.includes(probe), probe);
  assert.ok(expected.some((e) => e.bits === 'nan') && expected.some((e) => e.bits === '8000000000000000') && expected.some((e) => e.bits === '7ff0000000000000'));
});
test('public/ holds only the README, stub, package.json and brief', () => {
  assert.deepEqual(readdirSync(join(task, 'public')).sort(), ['README.md', 'brief.txt', 'package.json', 'strtod.ts']);
});
