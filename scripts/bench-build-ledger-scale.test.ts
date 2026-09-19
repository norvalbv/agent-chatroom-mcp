/** Scaled ledger family (scripts/bench-build-ledger-scale-gen.ts): N independent warehouse shards, same
 * S01-S14 defect mechanism and oracle design as build-ledger-s1/s2, unchanged per shard. For a freshly
 * generated instance (not a committed task; nothing here touches tasks/build-ledger-s1 or s2):
 * broken (= public/src) passes its public tests and catches 0; correct scores 1 with every shard's defects
 * caught and no regression; fixing one shard's one defect flips exactly that shard's check; module count and
 * file layout match N*5; no comment in src.
 * Run: node --import tsx --test scripts/bench-build-ledger-scale.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deriveLedgerScale, writeLedgerScaleTask } from './bench-build-ledger-scale-gen.ts';

function score(taskDir: string, dir: string) {
  const run = spawnSync(process.execPath, ['--import', 'tsx', join(taskDir, 'oracle/score.ts'), dir], { encoding: 'utf8', timeout: 60000 });
  return { status: run.status, out: JSON.parse(run.stdout || '{}'), stderr: run.stderr };
}

test('deriveLedgerScale is deterministic and draws an independent instance per shard', () => {
  const a = deriveLedgerScale(1, 4);
  const b = deriveLedgerScale(1, 4);
  assert.deepEqual(a, b);
  assert.equal(a.perShard.length, 4);
  assert.deepEqual(a.perShard.map((s) => s.shard), ['wh01', 'wh02', 'wh03', 'wh04']);
  for (const s of a.perShard) assert.equal(s.defects.length, 9);
  const seeds = new Set(a.perShard.map((s) => s.seed));
  assert.equal(seeds.size, 4, 'each shard must draw from a distinct sub-seed');
});

for (const [seed, shards] of [[1, 3], [2, 4]] as const) {
  test(`ledger-scale seed=${seed} shards=${shards}: generated tree has ${shards * 5} src modules`, async () => {
    const out = mkdtempSync(join(tmpdir(), 'ledger-scale-gen-'));
    try {
      await writeLedgerScaleTask(seed, shards, out);
      const files = readdirSync(join(out, 'public/src')).flatMap((shard) => readdirSync(join(out, 'public/src', shard)).map((f) => join(shard, f)));
      assert.equal(files.length, shards * 5);
      for (const f of readdirSync(join(out, 'public/src'))) {
        for (const file of readdirSync(join(out, 'public/src', f))) {
          assert.ok(!/\/\/|\/\*/.test(readFileSync(join(out, 'public/src', f, file), 'utf8')), `${f}/${file} has a comment`);
        }
      }
    } finally { rmSync(out, { recursive: true, force: true }); }
  });

  test(`ledger-scale seed=${seed} shards=${shards}: broken passes public tests and catches 0; correct scores 1 with every planted defect caught, none shipped`, async () => {
    const out = mkdtempSync(join(tmpdir(), 'ledger-scale-gen-'));
    const brokenWs = mkdtempSync(join(tmpdir(), 'ledger-scale-broken-'));
    const correctWs = mkdtempSync(join(tmpdir(), 'ledger-scale-correct-'));
    try {
      const inst = await writeLedgerScaleTask(seed, shards, out);
      cpSync(join(out, 'public'), brokenWs, { recursive: true });
      const pub = spawnSync(process.execPath, ['--test', 'test/*.test.ts'], { cwd: brokenWs, encoding: 'utf8', timeout: 60000 });
      assert.equal(pub.status, 0, pub.stdout + pub.stderr);
      const rb = score(out, brokenWs);
      assert.equal(rb.status, 1, JSON.stringify(rb.out));
      assert.equal(rb.out.defects_caught, 0);
      assert.equal(rb.out.regressions_failed, 0);
      assert.equal(rb.out.defects_planted, shards * 9);

      cpSync(join(out, 'fixtures/correct'), correctWs, { recursive: true });
      const rc = score(out, correctWs);
      assert.equal(rc.status, 0, JSON.stringify(rc.out));
      assert.equal(rc.out.score, 1);
      assert.equal(rc.out.defects_caught, shards * 9);
      assert.equal(rc.out.defects_shipped, 0);
      assert.equal(inst.perShard.length, shards);
    } finally { rmSync(out, { recursive: true, force: true }); rmSync(brokenWs, { recursive: true, force: true }); rmSync(correctWs, { recursive: true, force: true }); }
  });

  test(`ledger-scale seed=${seed} shards=${shards}: fixing one shard's one defect flips exactly that shard's check`, async () => {
    const out = mkdtempSync(join(tmpdir(), 'ledger-scale-gen-'));
    try {
      const inst = await writeLedgerScaleTask(seed, shards, out);
      const target = inst.perShard[0];
      const defectId = target.defects[0];
      const ws = mkdtempSync(join(tmpdir(), 'ledger-scale-fix-'));
      try {
        cpSync(join(out, 'public'), ws, { recursive: true });
        const { buildLedgerSrc } = await import('./bench-build-ledger-gen.ts');
        const fixed = buildLedgerSrc({ seed: target.seed, m: target.m, defects: target.defects }, new Set([defectId]));
        for (const [f, body] of Object.entries(fixed)) writeFileSync(join(ws, 'src', target.shard, f), body as string);
        const r = score(out, ws);
        assert.deepEqual(r.out.caught_ids, [`${target.shard}-${defectId}`], JSON.stringify(r.out));
        assert.equal(r.out.regressions_failed, 0);
      } finally { rmSync(ws, { recursive: true, force: true }); }
    } finally { rmSync(out, { recursive: true, force: true }); }
  });
}

test('ledger-scale: two different seeds produce different per-shard defect sets (not a stamped copy)', async () => {
  const a = mkdtempSync(join(tmpdir(), 'ledger-scale-a-'));
  const b = mkdtempSync(join(tmpdir(), 'ledger-scale-b-'));
  try {
    const ia = await writeLedgerScaleTask(1, 3, a);
    const ib = await writeLedgerScaleTask(2, 3, b);
    assert.notDeepEqual(ia.perShard.map((s) => s.defects), ib.perShard.map((s) => s.defects));
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

test('ledger-scale: task.json build_suite matrix equals the oracle defect/ and regression/ names exactly', async () => {
  const out = mkdtempSync(join(tmpdir(), 'ledger-scale-gen-'));
  try {
    await writeLedgerScaleTask(3, 3, out);
    const meta = JSON.parse(readFileSync(join(out, 'task.json'), 'utf8'));
    const r = score(out, resolve(out, 'fixtures/correct'));
    const names: string[] = r.out.oracle_results.map((x: { name: string }) => x.name);
    assert.deepEqual(names.filter((n) => n.startsWith('defect/')).map((n) => n.slice(7)).sort(), [...meta.build_suite.defect_ids].sort());
    assert.deepEqual(names.filter((n) => n.startsWith('regression/')).map((n) => n.slice(11)).sort(), [...meta.build_suite.regression_ids].sort());
  } finally { rmSync(out, { recursive: true, force: true }); }
});
