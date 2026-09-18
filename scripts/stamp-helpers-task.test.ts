/** stamp-helpers: the byte-identical STAMP spec with a new program whose corner is helper procedures DEFined inside the procedure that uses them.
 * Run: node --import tsx --test scripts/stamp-helpers-task.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';

const dir = resolve('tasks/stamp-helpers');
const program = resolve(dir, 'public/program.stamp');
const expected = JSON.parse(readFileSync(resolve(dir, 'oracle/oracle.json'), 'utf8')).expected as string;
const reference = readFileSync(resolve(dir, 'oracle/reference.mjs'), 'utf8');

const STAMP_SPEC_SHA256 = 'db4bbc4114ddb8ebf32bd22a6fb3c28c63903a5aa609f25436ba13add3cfffc6';

function runMutant(kind: 'read' | 'write'): string {
  let src = reference
    .replace('function lookup(fr, v) { if (fr && fr.locals.has(v) && !fr.globalNames.has(v)) return fr.locals.get(v); return globals.get(v) ?? 0n; }',
      'function lookup(fr, v) { for (let f = fr; f; f = f.parent) { if (f.globalNames.has(v)) break; if (f.locals.has(v)) return f.locals.get(v); } return globals.get(v) ?? 0n; }')
    .replace('const frame = { locals: new Map(), globalNames: new Set() };', 'const frame = { locals: new Map(), globalNames: new Set(), parent: def.closure };')
    .replace('procs.set(t[1], { params: t.slice(2), start: s, end: e });', 'procs.set(t[1], { params: t.slice(2), start: s, end: e, closure: fr });');
  if (kind === 'write') {
    src = src.replace('function assign(fr, v, x) { if (!fr || fr.globalNames.has(v)) globals.set(v, x); else fr.locals.set(v, x); }',
      'function assign(fr, v, x) { if (!fr || fr.globalNames.has(v)) { globals.set(v, x); return; } for (let f = fr; f; f = f.parent) { if (f.locals.has(v)) { f.locals.set(v, x); return; } } fr.locals.set(v, x); }');
  }
  assert.notEqual(src, reference);
  const tmp = mkTmp();
  try {
    const p = join(tmp, 'mutant.mjs');
    writeFileSync(p, src);
    return execFileSync(process.execPath, [p, program], { encoding: 'utf8' }).trim();
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
const mkTmp = () => mkdtempSync(join(tmpdir(), 'stamp-helpers-'));

test('stamp-helpers: spec.txt is byte-identical to stamp-interpreter\'s', () => {
  assert.equal(createHash('sha256').update(readFileSync(resolve(dir, 'public/spec.txt'))).digest('hex'), STAMP_SPEC_SHA256);
});

test('stamp-helpers: JS reference and independent Python interpreter agree with the frozen oracle', () => {
  assert.equal(loadTask(dir).oracle.kind, 'exact-answer');
  assert.equal(execFileSync(process.execPath, [resolve(dir, 'oracle/reference.mjs'), program], { encoding: 'utf8' }).trim(), expected);
  assert.equal(execFileSync('python3', [resolve(dir, 'oracle/independent-check.py'), program], { encoding: 'utf8' }).trim(), expected);
});

test('stamp-helpers: closure readings (read-only and write-through) change many tokens', () => {
  const want = expected.split(' ');
  for (const kind of ['read', 'write'] as const) {
    const got = runMutant(kind).split(' ');
    assert.equal(got.length, want.length);
    assert.ok(got.filter((g, i) => g !== want[i]).length >= 6, `${kind}: fewer than 6 tokens differ`);
  }
});

test('stamp-helpers: scoreTask outcome vocabulary and no leak in public/', async () => {
  for (const f of ['spec.txt', 'program.stamp', 'brief.txt']) assert.ok(!readFileSync(resolve(dir, 'public', f), 'utf8').includes(expected), f);
  const d = mkTmp();
  try {
    writeFileSync(join(d, 'answer.txt'), expected + '\n');
    assert.equal((await scoreTask(dir, d)).reason, 'task_pass');
    writeFileSync(join(d, 'answer.txt'), runMutant('read'));
    assert.equal((await scoreTask(dir, d)).reason, 'task_fail');
    rmSync(join(d, 'answer.txt'));
    assert.equal((await scoreTask(dir, d)).reason, 'parse_failure');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
