/** Contract checks for the planted-defect build-suite wrapper.  No model is invoked.
 * Run: node --import tsx scripts/bench-build.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const runner = resolve("scripts/bench-build.ts");

function fakeBench(result: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "bench-build-fake-"));
  const path = join(dir, "runner.mjs");
  writeFileSync(path, `import fs from 'node:fs'; const root=process.argv[process.argv.indexOf('--root')+1]; fs.mkdirSync(root,{recursive:true}); fs.writeFileSync(root+'/runner-argv.json',JSON.stringify(process.argv.slice(2))); fs.writeFileSync(root+'/result.json',${JSON.stringify(JSON.stringify(result))});`);
  chmodSync(path, 0o755);
  return { dir, path };
}

function seededTask(checks: unknown, manifest = { defect_ids: ["rounding", "cancel"], regression_ids: ["tax-exempt", "empty-order"] }, hostManifest = false) {
  const dir = mkdtempSync(join(tmpdir(), "bench-build-task-"));
  mkdirSync(join(dir, "oracle"));
  writeFileSync(join(dir, "task.json"), JSON.stringify(hostManifest ? { task_id: "seeded-orders-01" } : { task_id: "seeded-orders-01", build_suite: manifest }));
  if (hostManifest) writeFileSync(join(dir, "DEFECTS.json"), JSON.stringify({ defects: manifest.defect_ids.map((id) => ({ id })), regressions: manifest.regression_ids.map((id) => ({ id })) }));
  writeFileSync(join(dir, "oracle", "oracle.json"), JSON.stringify({ kind: "seeded-build" }));
  writeFileSync(join(dir, "oracle", "score.ts"), `console.log(${JSON.stringify(JSON.stringify({ score: 0, oracle_results: checks }))}); process.exit(1);`);
  return dir;
}

function invoke(task: string, root: string, fake: string, arm = "A") {
  return spawnSync(process.execPath, ["--import", "tsx", runner, task, arm, "7", "--root", root, "--runner", fake, "--grid-fingerprint", "b".repeat(64)], { encoding: "utf8", timeout: 20_000 });
}

const valid = {
  task_id: "seeded-orders-01", arm: "A", seed: 7, outcome: "completed",
  anti_tamper: { unchanged: true }, usage: { cost_usd: 0.4 },
  effort: { level: "medium", settings_path: ".claude/settings.json", settings_sha256: "a".repeat(64), own_git_root: true },
  turns: { summed: 17 }, wall_clock: { duration_ms: 1234 },
  seats: [{ name: "single", usage:{output_tokens:7}, thinking_tokens:3 }],
};

const checks = [
  { name: "defect/rounding", exit_code: 0 },
  { name: "defect/cancel", exit_code: 1 },
  { name: "regression/tax-exempt", exit_code: 0 },
  { name: "regression/empty-order", exit_code: 1 },
];

test("runner exists", () => assert.ok(existsSync(runner), "scripts/bench-build.ts must exist"));

test("reduces named defect and regression checks to independent caught/shipped counts", () => {
  const task = seededTask(checks);
  const root = join(tmpdir(), `bench-build-result-${process.pid}-${Date.now()}`);
  const fake = fakeBench(valid);
  try {
    const run = invoke(task, root, fake.path);
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(readFileSync(join(root, "build-result.json"), "utf8"));
    assert.deepEqual(out.scores, { defects_caught: 1, defects_total: 2, defects_shipped: 2, regression_failures: 1, regressions_total: 2 });
    assert.equal(out.provenance.raw_result, "result.json");
    assert.equal(out.provenance.anti_tamper_unchanged, true);
    assert.equal(out.usage.cost_usd, 0.4);
    assert.equal(out.turns, 17);
    assert.equal(out.outcome,'completed');
    assert.equal(out.oracle_outcome,'task_fail');
    assert.equal(out.protocol_success,true);
    assert.equal(out.protocol_adjusted_catch_fraction,.5);
    assert.equal(out.provenance.grid_fingerprint,'b'.repeat(64));
    assert.match(out.provenance.manifest_sha256,/^[a-f0-9]{64}$/);
    assert.match(out.provenance.runner_sha256,/^[a-f0-9]{64}$/);
    assert.equal(out.usage.output_tokens,7);
    assert.equal(out.usage.thinking_tokens,3);
  } finally { rmSync(task, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); rmSync(fake.dir, { recursive: true, force: true }); }
});

test("accepts the generator's host-owned DEFECTS.json manifest with the same exact matrix rule", () => {
  const task = seededTask(checks, undefined, true);
  const root = join(tmpdir(), `bench-build-host-manifest-${process.pid}-${Date.now()}`);
  const fake = fakeBench(valid);
  try {
    const run = invoke(task, root, fake.path);
    assert.equal(run.status, 0, run.stderr);
  } finally { rmSync(task, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); rmSync(fake.dir, { recursive: true, force: true }); }
});

test("refuses to make a score from an altered fixture or an unnamed hidden check", () => {
  const task = seededTask([...checks, { name: "mystery", exit_code: 0 }]);
  const root = join(tmpdir(), `bench-build-bad-${process.pid}-${Date.now()}`);
  const fake = fakeBench({ ...valid, anti_tamper: { unchanged: false } });
  try {
    const run = invoke(task, root, fake.path);
    assert.notEqual(run.status, 0);
    assert.equal(existsSync(join(root, "build-result.json")), false);
    assert.match(run.stderr, /anti-tamper|named defect|regression/i);
  } finally { rmSync(task, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); rmSync(fake.dir, { recursive: true, force: true }); }
});

test("refuses an incomplete hidden matrix instead of treating an omitted defect as caught", () => {
  const task = seededTask(checks, { defect_ids: ["rounding", "cancel", "authorization"], regression_ids: ["tax-exempt", "empty-order"] });
  const root = join(tmpdir(), `bench-build-incomplete-${process.pid}-${Date.now()}`);
  const fake = fakeBench(valid);
  try {
    const run = invoke(task, root, fake.path);
    assert.notEqual(run.status, 0);
    assert.equal(existsSync(join(root, "build-result.json")), false);
    assert.match(run.stderr, /matrix.*defect\/authorization/i);
  } finally { rmSync(task, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); rmSync(fake.dir, { recursive: true, force: true }); }
});

test("refuses an unpinned effort result rather than treating a CLI default as a measurement setting", () => {
  const task = seededTask(checks);
  const root = join(tmpdir(), `bench-build-effort-${process.pid}-${Date.now()}`);
  const { effort: _ignored, ...withoutEffort } = valid;
  const fake = fakeBench(withoutEffort);
  try {
    const run = invoke(task, root, fake.path);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /effort.*settings/i);
  } finally { rmSync(task, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); rmSync(fake.dir, { recursive: true, force: true }); }
});

test("uses four seats for a room unless the pre-registered invocation overrides it", () => {
  const task = seededTask(checks);
  const root = join(tmpdir(), `bench-build-room-${process.pid}-${Date.now()}`);
  const fake = fakeBench({ ...valid, arm: "C", room_validation: {state:"concluded",proposal_id:"p1",verified:true,verifier_session_distinct:true,distinct_sessions:4} });
  try {
    const run = invoke(task, root, fake.path, "C");
    assert.equal(run.status, 0, run.stderr);
    const argv: string[] = JSON.parse(readFileSync(join(root, "runner-argv.json"), "utf8"));
    assert.equal(argv[argv.indexOf("--seats") + 1], "4");
  } finally { rmSync(task, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); rmSync(fake.dir, { recursive: true, force: true }); }
});

for (const [name, extra] of Object.entries({
  timeout: {outcome:'timeout'},
  budget: {outcome:'budget_exhausted'},
  invalidRoom: {outcome:'invalid_room'},
  unknownCost: {usage:{cost_usd:null}},
})) test(`retains measured caught/shipped for ${name} without inventing cost or protocol success`, () => {
  const task=seededTask(checks), root=join(tmpdir(),`build-terminal-${process.pid}-${Date.now()}`);
  const fake=fakeBench({...valid,...extra});
  try {
    const run=invoke(task,root,fake.path);
    assert.equal(run.status,0,run.stderr);
    const r=JSON.parse(readFileSync(join(root,'build-result.json'),'utf8'));
    assert.equal(r.scores.defects_caught,1);
    assert.equal(r.scores.defects_shipped,2);
    assert.equal(r.execution_outcome,('outcome' in extra ? extra.outcome : 'completed'));
    assert.equal(r.protocol_failure,name!=='unknownCost');
    if(name==='unknownCost') assert.equal(r.usage.cost_usd,null);
  } finally {rmSync(task,{recursive:true,force:true});rmSync(root,{recursive:true,force:true});rmSync(fake.dir,{recursive:true,force:true});}
});
for (const extra of [{usage:{cost_usd:-1}},{outcome:'infrastructure_error'},{outcome:'tamper'}]) test(`refuses corrupted or infrastructure-invalid records ${JSON.stringify(extra)}`, () => {
  const task=seededTask(checks), root=join(tmpdir(),`build-invalid-${process.pid}-${Date.now()}`);
  const fake=fakeBench({...valid,...extra});
  try {
    const run=invoke(task,root,fake.path);
    assert.notEqual(run.status,0);
    assert.equal(existsSync(join(root,'build-result.json')),false);
  } finally {rmSync(task,{recursive:true,force:true});rmSync(root,{recursive:true,force:true});rmSync(fake.dir,{recursive:true,force:true});}
});

test('oracle tamper exit stays distinct from external infrastructure and preserves spend', () => {
  const task=seededTask(checks),root=join(tmpdir(),`build-oracle-tamper-${process.pid}-${Date.now()}`),fake=fakeBench(valid);
  writeFileSync(join(task,'oracle','score.ts'),"console.error('oracle tamper: forbidden private read');process.exit(3);");
  try {
    const run=invoke(task,root,fake.path);
    assert.notEqual(run.status,0);
    const r=JSON.parse(readFileSync(join(root,'build-result.json'),'utf8'));
    assert.equal(r.execution_outcome,'tamper');
    assert.equal(r.native_outcome,'completed');
    assert.equal(r.scores,null);
    assert.equal(r.usage.cost_usd,.4);
  } finally {rmSync(task,{recursive:true,force:true});rmSync(root,{recursive:true,force:true});rmSync(fake.dir,{recursive:true,force:true});}
});
