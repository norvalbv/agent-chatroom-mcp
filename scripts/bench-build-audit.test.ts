/** Non-author integration audit: real build runner, fake model, no paid calls. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const runner = resolve('scripts/bench-build.ts');
const auditDeadline = 60_000;

function fixture(mode = 'normal') {
  const base = mkdtempSync(join(tmpdir(), 'build-audit-'));
  const task = join(base, 'task');
  const bin = join(base, 'bin');
  mkdirSync(join(task, 'public'), { recursive: true });
  mkdirSync(join(task, 'oracle'));
  mkdirSync(bin);
  writeFileSync(join(task, 'task.json'), JSON.stringify({ task_id: 'audit-build' }));
  writeFileSync(join(task, 'oracle', 'oracle.json'), JSON.stringify({ kind: 'private-tests' }));
  writeFileSync(join(task, 'public', 'brief.txt'), 'Make the codebase meet its specification.');
  writeFileSync(join(task, 'public', 'value.txt'), 'broken');
  // Fixed IDs are host-owned metadata, never a candidate-generated denominator.
  writeFileSync(join(task, 'DEFECTS.json'), JSON.stringify({
    defects: Array.from({ length: 8 }, (_, i) => ({ id: `d${i + 1}` })),
    regressions: [{ id: 'ordinary' }],
  }));
  writeFileSync(join(task, 'oracle', 'score.ts'), `
import fs from 'node:fs';
const workspace = process.argv[2];
const fixed = fs.readFileSync(workspace + '/value.txt', 'utf8') === 'fixed';
const oracle_results = Array.from({length:8},(_,i)=>({name:'defect/d'+(i+1),exit_code:fixed?0:1}));
oracle_results.push({name:'regression/ordinary',exit_code:0});
${mode === 'score-tamper' ? `fs.appendFileSync(${JSON.stringify(join(task, 'public', 'brief.txt'))}, ' CHANGED DURING SCORE');` : ''}
console.log(JSON.stringify({score:fixed?1:0,oracle_results}));
process.exit(fixed?0:1);
`);
  const claude = join(bin, 'claude');
  writeFileSync(claude, `#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2);
const isReviewer=args.some(a=>a.includes('reviewing another engineer'));
fs.writeFileSync('value.txt','fixed');
${mode === 'reviewer-tamper' ? "if(isReviewer) fs.writeFileSync('../workspace/value.txt','reviewer edited submitted files');" : ''}
console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:isReviewer?'APPROVE':'done',num_turns:1,total_cost_usd:0.001,usage:{input_tokens:1,output_tokens:1,cache_read_input_tokens:0,cache_creation_input_tokens:0}}));
`);
  chmodSync(claude, 0o755);
  return { base, task, bin, root: join(base, 'run') };
}

function invoke(f: ReturnType<typeof fixture>, arm = 'A') {
  return spawnSync(process.execPath, ['--import', 'tsx', runner, f.task, arm, '1', '--root', f.root,
    '--max-budget-usd', '0.1', '--deadline-ms', '10000'], {
    encoding: 'utf8', timeout: auditDeadline,
    env: { ...process.env, PATH: f.bin + delimiter + process.env.PATH },
  });
}

test('real default runner transports the complete per-defect matrix into build-result', () => {
  const f = fixture();
  try {
    const run = invoke(f);
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const result = JSON.parse(readFileSync(join(f.root, 'build-result.json'), 'utf8'));
    assert.equal(result.scores.defects_total, 8);
    assert.equal(result.scores.defects_caught, 8);
    assert.equal(result.scores.defects_shipped, 0);
    assert.equal(result.scores.regressions_total, 1);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('a fixture mutation during hidden scoring cannot yield an admissible build score', () => {
  const f = fixture('score-tamper');
  try {
    const run = invoke(f);
    assert.match(readFileSync(join(f.task, 'public', 'brief.txt'), 'utf8'), /CHANGED DURING SCORE/,
      'the adversarial scorer must actually run');
    const output = join(f.root, 'build-result.json');
    const result = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : null;
    assert.ok(run.status !== 0 || result?.scores == null, 'post-score tamper must invalidate scoring');
    // Distinguish true tamper protection from an unrelated broken result transport.
    assert.match(run.stderr + JSON.stringify(result), /tamper|changed fixture/i);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('pair reviewer writes through the snapshot boundary invalidate the submitted artifact', () => {
  const f = fixture('reviewer-tamper');
  try {
    const run = invoke(f, 'B');
    assert.equal(readFileSync(join(f.root, 'workspace', 'value.txt'), 'utf8'), 'reviewer edited submitted files',
      'the reviewer attack must reach the scored workspace');
    const output = join(f.root, 'build-result.json');
    const result = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : null;
    assert.ok(run.status !== 0 || result?.scores == null, 'reviewer edits must invalidate scoring');
    assert.match(run.stderr + JSON.stringify(result), /tamper|reviewer.*(write|chang|edit)|snapshot/i);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});
