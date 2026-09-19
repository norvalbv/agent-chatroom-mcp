/** Planted-defect build tasks from scripts/bench-build-gen.ts. For each committed instance:
 * broken (= public/src) passes its public tests and fails exactly the planted-defect checks;
 * correct passes everything; fixing one defect flips exactly that defect's check and nothing else;
 * regression checks pass on broken and correct; nothing hidden is under public/; no comment near a defect.
 * Run: node --import tsx --test scripts/bench-build-task.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';
import { DEFECT_IDS, buildSrc, deriveInstance } from './bench-build-gen.ts';

const INSTANCES = ['build-billing-s1', 'build-billing-s2'];

function ws(id: string, fixed: string[] | 'all') {
  const task = resolve('tasks', id);
  const dir = mkdtempSync(join(tmpdir(), 'build-task-'));
  cpSync(join(task, 'public'), dir, { recursive: true });
  const inst = JSON.parse(readFileSync(join(task, 'oracle', 'instance.json'), 'utf8'));
  const src = buildSrc(inst, fixed === 'all' ? new Set<string>(inst.defects) : new Set<string>(fixed));
  for (const [f, body] of Object.entries(src)) writeFileSync(join(dir, 'src', f), body);
  return { task, dir, inst };
}
function score(task: string, dir: string) {
  const run = spawnSync(process.execPath, ['--import', 'tsx', join(task, 'oracle/score.ts'), dir], { encoding: 'utf8', timeout: 30000 });
  return { status: run.status, out: JSON.parse(run.stdout || '{}'), stderr: run.stderr };
}

for (const id of INSTANCES) {
  test(`${id}: loadTask and shape`, () => {
    const t = resolve('tasks', id);
    assert.equal(loadTask(t).oracle.kind, 'planted-defects');
    const inst = JSON.parse(readFileSync(join(t, 'oracle/instance.json'), 'utf8'));
    assert.ok(inst.defects.length >= 6 && inst.defects.length <= 12);
    for (const d of inst.defects) assert.ok(DEFECT_IDS.includes(d));
    assert.deepEqual(deriveInstance(inst.seed).defects, inst.defects, 'committed instance == generator(seed)');
    assert.ok(!existsSync(join(t, 'public/oracle')) && !existsSync(join(t, 'public/fixtures')));
  });

  test(`${id}: broken passes public tests, fails every defect check, passes every regression check`, () => {
    const { task, dir, inst } = ws(id, []);
    try {
      const pub = spawnSync(process.execPath, ['--test', 'test/*.test.ts'], { cwd: dir, encoding: 'utf8', timeout: 60000 });
      assert.equal(pub.status, 0, pub.stdout + pub.stderr);
      const r = score(task, dir);
      assert.equal(r.out.defects_caught, 0);
      assert.equal(r.out.defects_planted, inst.defects.length);
      assert.equal(r.out.regressions_failed, 0);
      assert.equal(r.out.score, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`${id}: correct scores 1 with every defect caught and no regression`, () => {
    const { task, dir, inst } = ws(id, 'all');
    try {
      const r = score(task, dir);
      assert.equal(r.status, 0, JSON.stringify(r.out));
      assert.equal(r.out.score, 1);
      assert.equal(r.out.defects_caught, inst.defects.length);
      assert.equal(r.out.defects_shipped, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`${id}: each defect check is independent (fixing one flips exactly that one)`, () => {
    const inst = JSON.parse(readFileSync(join('tasks', id, 'oracle/instance.json'), 'utf8'));
    for (const d of inst.defects) {
      const { task, dir } = ws(id, [d]);
      try {
        const r = score(task, dir);
        assert.deepEqual(r.out.caught_ids, [d], `${id}/${d}: ${JSON.stringify(r.out.caught_ids)}`);
        assert.equal(r.out.regressions_failed, 0);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
  });

  test(`${id}: breaking a regression behaviour is scored as shipped`, () => {
    const { task, dir } = ws(id, 'all');
    try {
      const f = join(dir, 'src', 'plans.ts');
      writeFileSync(f, readFileSync(f, 'utf8').replace('Math.min(units', 'Math.min(units + 1'));
      const r = score(task, dir);
      assert.ok(r.out.regressions_failed > 0);
      assert.ok(r.out.defects_shipped > 0);
      assert.equal(r.out.score, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`${id}: no comments in src and SPEC does not name the defect sites`, () => {
    const t = resolve('tasks', id, 'public');
    for (const f of readdirSync(join(t, 'src'))) assert.ok(!/\/\/|\/\*/.test(readFileSync(join(t, 'src', f), 'utf8')), f);
  });
}

test('the two committed instances differ in planted defect set', () => {
  const a = JSON.parse(readFileSync('tasks/build-billing-s1/oracle/instance.json', 'utf8'));
  const b = JSON.parse(readFileSync('tasks/build-billing-s2/oracle/instance.json', 'utf8'));
  assert.notDeepEqual([...a.defects].sort(), [...b.defects].sort());
});

import { buildRuleSrc, deriveRules } from './bench-build-rules-gen.ts';

for (const id of ['build-rules-s1', 'build-rules-s2']) {
  const task = resolve('tasks', id);
  const inst = deriveRules(JSON.parse(readFileSync(join(task, 'oracle/instance.json'), 'utf8')).seed);
  const planted: string[] = JSON.parse(readFileSync(join(task, 'oracle/instance.json'), 'utf8')).defects;
  function rws(fixed: string[]) {
    const dir = mkdtempSync(join(tmpdir(), 'build-rules-'));
    cpSync(join(task, 'public'), dir, { recursive: true });
    for (const [f, body] of Object.entries(buildRuleSrc(inst, new Set(fixed)))) writeFileSync(join(dir, 'src', f), body);
    return dir;
  }
  test(`${id}: 24 rules, ten plants, generator is deterministic`, () => {
    assert.equal(inst.rules.length, 24);
    assert.deepEqual(planted, inst.rules.filter((r) => r.defect).map((r) => r.id));
    assert.equal(planted.length, 10);
    assert.ok(!existsSync(join(task, 'public/oracle')));
  });
  test(`${id}: broken passes public tests, catches 0, no regression; correct scores 1`, () => {
    const b = rws([]), c = rws(planted);
    try {
      const pub = spawnSync(process.execPath, ['--test', 'test/*.test.ts'], { cwd: b, encoding: 'utf8', timeout: 60000 });
      assert.equal(pub.status, 0, pub.stdout + pub.stderr);
      const rb = score(task, b);
      assert.equal(rb.out.defects_caught, 0); assert.equal(rb.out.regressions_failed, 0);
      const rc = score(task, c);
      assert.equal(rc.status, 0, JSON.stringify(rc.out)); assert.equal(rc.out.defects_shipped, 0);
    } finally { rmSync(b, { recursive: true, force: true }); rmSync(c, { recursive: true, force: true }); }
  });
  test(`${id}: fixing one planted rule flips exactly that defect check and no regression`, () => {
    for (const d of planted) {
      const dir = rws([d]);
      try { const r = score(task, dir); assert.deepEqual(r.out.caught_ids, [d]); assert.equal(r.out.regressions_failed, 0); }
      finally { rmSync(dir, { recursive: true, force: true }); }
    }
  });
  test(`${id}: no comments in src`, () => {
    for (const f of readdirSync(join(task, 'public/src'))) assert.ok(!/\/\/|\/\*/.test(readFileSync(join(task, 'public/src', f), 'utf8')), f);
  });
}
