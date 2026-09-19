import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { Hub } from '../src/hub.js';
import { hashTree, hashWorkspace, WORKSPACE_HASH_SCRIPT } from './bench-build-runtime.ts';
import { validateBuildRoom } from './bench-build-runner.ts';

const runner = resolve('scripts/bench-build-runner.ts');
test('reviewer artifact helper matches host hashing and detects source changes', () => {
  const workspace=mkdtempSync(join(tmpdir(),'build-hash-parity-'));
  try {
    mkdirSync(join(workspace,'.git'));
    writeFileSync(join(workspace,'.git','ignored'),'git metadata');
    writeFileSync(join(workspace,'source.txt'),'verified');
    writeFileSync(join(workspace,'.bench-hash.mjs'),WORKSPACE_HASH_SCRIPT);
    const before=hashWorkspace(workspace);
    const helper=spawnSync(process.execPath,['.bench-hash.mjs'],{cwd:workspace,encoding:'utf8'});
    assert.equal(helper.status,0,helper.stderr);
    assert.equal(helper.stdout.trim(),before);
    writeFileSync(join(workspace,'source.txt'),'changed');
    assert.notEqual(hashWorkspace(workspace),before);
  } finally {rmSync(workspace,{recursive:true,force:true});}
});
async function run(arm: string, mode = 'normal') {
  const base = mkdtempSync(join(tmpdir(), 'build-executor-test-'));
  const root = join(base, 'run');
  const bin = join(base, 'bin'); mkdirSync(bin);
  const task = join(base, 'task'); mkdirSync(join(task, 'public'), { recursive: true });
  writeFileSync(join(task, 'task.json'), JSON.stringify({ task_id: 'stub-build' }));
  writeFileSync(join(task, 'public', 'brief.txt'), 'Meet the specification.');
  writeFileSync(join(task, 'public', 'value.txt'), 'broken');
  const stub = join(bin, 'claude');
  writeFileSync(stub, `#!/usr/bin/env node
const fs=require('node:fs');
const a=process.argv.slice(2); const reviewer=a.some(x=>x.includes('reviewing another engineer'));
if(${JSON.stringify(mode)}==='review-tamper'&&reviewer)fs.writeFileSync('../workspace/value.txt','tampered');
console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:reviewer?'REVISE: check again':'done',num_turns:1,total_cost_usd:0.001,modelUsage:{stub:{thinkingTokens:9}},usage:{input_tokens:1,output_tokens:2,cache_read_input_tokens:0,cache_creation_input_tokens:0}}));
`); chmodSync(stub, 0o755);
  const server = createServer();
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(ok => server.close(() => ok()));
  try {
    const child = spawnSync(process.execPath, ['--import','tsx',runner,task,arm,'1','--root',root,
      '--expected-task-sha256',hashTree(task),'--max-budget-usd','1','--effort','medium','--port',String(port),'--deadline-ms','10000'],
      { encoding:'utf8', timeout:30_000, env:{...process.env,PATH:bin+delimiter+process.env.PATH} });
    assert.equal(child.status,0,child.stderr);
    return JSON.parse(readFileSync(join(root,'result.json'),'utf8'));
  } finally { rmSync(base,{recursive:true,force:true}); }
}

test('A pins project effort and sends the entire cap to its sole seat', async () => {
  const r=await run('A');
  assert.equal(r.seats.length,1);
  assert.equal(r.seats[0].budget_usd,1);
  assert.equal(r.effort.level,'medium');
  assert.equal(r.effort.own_git_root,true);
  assert.match(r.effort.settings_sha256,/^[a-f0-9]{64}$/);
  assert.equal(r.seats[0].thinking_tokens,9);
  assert.equal(r.usage.cost_usd,.001);
  assert.match(r.run_fingerprint,/^[a-f0-9]{64}$/);
});
test('a real four-session verified conclusion survives replay validation', () => {
  const dir=mkdtempSync(join(tmpdir(),'build-room-valid-'));
  const h=new Hub({dataDir:dir});
  const seats=Array.from({length:4},(_,i)=>h.join('build','seat-'+i,'test',{requireVerification:true,requireChallenge:true,quorum:'supermajority',expectedParticipants:4},undefined,'session-'+i).participant);
  const room=h.getRoom('build');
  const workspace=join(dir,'artifact');mkdirSync(workspace);writeFileSync(join(workspace,'source.txt'),'verified');
  try {
    h.setBoard('build',seats[0].id,'claim/fix',JSON.stringify({owner:'seat-0'}));
    h.setBoard('build',seats[0].id,'verify/placeholder','pending');
    const proposal=h.propose('build',seats[0].id,'Ship verified fixes.');
    h.challenge('build',seats[2].id,proposal.id,'"Ship verified fixes" needs test coverage of all branches.',true);
    h.setBoard('build',seats[1].id,'verify/fix',JSON.stringify({proposal:proposal.id,command:'node --test',cwd:workspace,exit_code:0,output_tail:'pass',workspace_sha256:hashWorkspace(workspace)}));
    for(const p of seats) {
      if(room.state==='concluded') break;
      h.vote('build',p.id,proposal.id,'agree','Reviewed the artifact and independently checked coverage.',undefined,'Ship verified fixes');
    }
    const verdict=validateBuildRoom(dir,4,workspace);
    assert.equal(verdict.verified,true,JSON.stringify(verdict));
    assert.equal(verdict.distinct_sessions,4);
    assert.equal(verdict.verifier_session_distinct,true);
    writeFileSync(join(workspace,'source.txt'),'edited after verification');
    assert.equal(validateBuildRoom(dir,4,workspace).verified,false);
  } finally { clearTimeout(room.nudgeTimer);clearTimeout(room.openingsTimer);rmSync(dir,{recursive:true,force:true}); }
});
test('B allocates .5/.25/.25 and verifies the scored workspace around review', async () => {
  const r=await run('B');
  assert.deepEqual(r.seats.map((s:any)=>s.budget_usd),[.5,.25,.25]);
  assert.equal(r.usage.cost_usd,.003);
  assert.equal(r.review_integrity.unchanged,true);
  assert.equal(r.review_integrity.workspace_sha256_before,r.review_integrity.workspace_sha256_after);
  for(const s of r.seats)assert.ok(s.argv.includes('--max-budget-usd'));
});
test('B invalidates reviewer writes outside its snapshot before revision', async () => {
  const r=await run('B','review-tamper');
  assert.equal(r.outcome,'tamper');
  assert.equal(r.review_integrity.unchanged,false);
  assert.equal(r.seats.length,2);
});
test('C allocates a quarter to four seats but rejects code without a verified conclusion', async () => {
  const r=await run('C');
  assert.deepEqual(r.seats.map((s:any)=>s.budget_usd),[.25,.25,.25,.25]);
  assert.equal(r.room_validation.verified,false);
  assert.equal(r.outcome,'invalid_room');
  assert.match(r.build.hub_build_sha256,/^[a-f0-9]{64}$/);
});
