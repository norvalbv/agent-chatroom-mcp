/** Offline contract tests: node --import tsx scripts/bench-harness.test.ts */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
const runner = resolve('scripts/bench-bench.ts');
const task = resolve('tasks/bench-fact-check');
function invoke(args: string[], env: Record<string,string> = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', runner, ...args], {
    encoding: 'utf8', env: {...process.env, ...env}, timeout: 20000,
  });
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bench-contract-'));
  const stub = join(root, 'hub.mjs');
  writeFileSync(stub, `import http from 'node:http';
import fs from 'node:fs'; import path from 'node:path';
const data=process.env.CHATROOM_DATA_DIR;
const server=http.createServer((req,res)=>{
 res.setHeader('content-type','application/json');
 if(req.method==='POST'&&req.url.endsWith('/create')) {
  let body='';req.on('data',c=>body+=c);req.on('end',()=>{
   const config=JSON.parse(body); const room=req.url.split('/')[2];
   fs.mkdirSync(data,{recursive:true});
   if(process.env.STUB_ANSWER)fs.writeFileSync(path.join(process.env.CHATROOM_DEFAULT_CWD,'answer.txt'), process.env.STUB_ANSWER);
   fs.writeFileSync(path.join(data,room+'.jsonl'),JSON.stringify({type:'state',room,state:'concluded',conclusion:{text:'fluent chat is not the artifact',decidedAt:new Date().toISOString()}})+'\\n');
   fs.writeFileSync(path.join(data,'create.json'),JSON.stringify(config));res.end('{}');
  }); return;
 } res.end(JSON.stringify({rooms:[],version:'stub-v1'}));
});server.listen(Number(process.env.PORT),'127.0.0.1');`);
  return {root, stub, output: join(root,'run')};
}
async function freePair() {
  for(let p=23000;p<24000;p+=2) {
    const servers=[createServer(),createServer()];
    try { await Promise.all(servers.map((s,i)=>new Promise<void>((ok,no)=>{s.once('error',no);s.listen(p+i,'127.0.0.1',ok);}))); return p; }
    catch {} finally {await Promise.all(servers.map(s=>new Promise<void>(ok=>s.close(()=>ok()))));}
  } throw Error('No test ports');
}
const keys=['task_id','arm','hub_entry','hub_revision','passed','reason','oracle','anti_tamper','diagnostics','duration_ms','checked_at'];
test('runner exists',()=>assert.ok(existsSync(runner),'scripts/bench-bench.ts must exist'));
test('refuses unsafe, malformed and out-of-range ports before running a hub',()=>{
 const f=fixture(); try {for(const port of ['8000','0','NaN','65535','8001.5']) {
  const result=invoke([task,f.stub,f.stub,port,'--root',f.output]);
  assert.notEqual(result.status,0); assert.match(result.stderr,/port.*8000|port.*65534|invalid.*port/i);
  assert.equal(existsSync(f.output),false);
 }}finally{rmSync(f.root,{recursive:true,force:true});}
});
test('refuses root reuse without overwriting contents',()=>{
 const f=fixture(); try {mkdirSync(f.output);writeFileSync(join(f.output,'sentinel'),'keep');
 const result=invoke([task,f.stub,f.stub,'23000','--root',f.output]);
 assert.notEqual(result.status,0); assert.match(result.stderr,/refusing.*reuse/i);
 assert.equal(readFileSync(join(f.output,'sentinel'),'utf8'),'keep');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('two stub hubs emit artifact verdicts, separate workspaces and comparable frozen inputs',async()=>{
 const f=fixture(); try {
 const other=join(f.root,'hub-b.mjs');writeFileSync(other,readFileSync(f.stub,'utf8').replace('stub-v1','stub-v2'));
 const result=invoke([task,f.stub,other,String(await freePair()),'--root',f.output,'--timeout-ms','3000'],{STUB_ANSWER:'  Society for Formal Methods, Vienna\n'});
 assert.equal(result.status,0,result.stderr+result.stdout);
 for(const arm of ['A','B']) {
  const dir=join(f.output,arm); const verdict=JSON.parse(readFileSync(join(dir,'bench-result.json'),'utf8'));
  for(const key of keys) assert.ok(Object.hasOwn(verdict,key),key);
  assert.equal(verdict.arm,arm); assert.equal(verdict.passed,true); assert.equal(verdict.reason,'oracle-pass');
  assert.equal(verdict.hub_entry,arm==='A'?f.stub:other); assert.equal(verdict.anti_tamper.unchanged,true);
  assert.equal(verdict.oracle.kind,'exact-answer'); assert.equal(verdict.oracle.exit_code,0);
  assert.ok(verdict.duration_ms>=0); assert.ok(Number.isFinite(Date.parse(verdict.checked_at)));
  assert.equal(existsSync(join(dir,'workspace','hidden')),false,'hidden tests must not be seat-visible');
 }
 const a=JSON.parse(readFileSync(join(f.output,'A','manifest.json'),'utf8'));
 const b=JSON.parse(readFileSync(join(f.output,'B','manifest.json'),'utf8'));
 assert.notEqual(a.port,b.port); assert.deepEqual(a.frozen,b.frozen); assert.ok(a.hub_entry_sha256);
 assert.notEqual(a.hub_entry_sha256,b.hub_entry_sha256);assert.equal(a.hub_version,'stub-v1');assert.equal(b.hub_version,'stub-v2');assert.equal(a.hub_revision,null);assert.match(a.provenance_scope,/entry-only/);
 const comparison=JSON.parse(readFileSync(join(f.output,'bench-compare.json'),'utf8'));
 assert.equal(comparison.delta,0); assert.equal(comparison.comparable,true);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('hub startup failure is infra, not task failure, and excluded from delta',async()=>{
 const f=fixture();try {
 const missing=join(f.root,'missing.mjs');
 const result=invoke([task,missing,missing,String(await freePair()),'--root',f.output,'--timeout-ms','300']);
 assert.equal(result.status,0,result.stderr);
 for(const arm of ['A','B']) {
 const v=JSON.parse(readFileSync(join(f.output,arm,'bench-result.json'),'utf8'));
 assert.equal(v.reason,'infra');assert.equal(v.passed,false);
 }
 const comparison=JSON.parse(readFileSync(join(f.output,'bench-compare.json'),'utf8'));
 assert.equal(comparison.delta,null);assert.equal(comparison.comparable,false);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('frozen scorer identity changes when the executed fact scorer copy changes',async()=>{
 const f=fixture();try{
  const scripts=join(f.root,'scripts');mkdirSync(scripts);
  writeFileSync(join(f.root,'package.json'),JSON.stringify({type:'module'}));
  symlinkSync(resolve('node_modules'),join(f.root,'node_modules'),'dir');
  for(const name of ['bench-bench.ts','bench-oracle.ts','score-fact-check.ts'])cpSync(resolve('scripts',name),join(scripts,name));
  const snapshots=[];
  for(const iteration of [0,1]){
   if(iteration)writeFileSync(join(scripts,'score-fact-check.ts'),readFileSync(join(scripts,'score-fact-check.ts'),'utf8')+'\n// dependency mutation in isolated copy\n');
   const output=join(f.root,'run-'+iteration);
   const result=spawnSync(process.execPath,['--import','tsx',join(scripts,'bench-bench.ts'),task,f.stub,f.stub,String(await freePair()),'--root',output,'--timeout-ms','3000'],{encoding:'utf8',env:{...process.env,STUB_ANSWER:'Society for Formal Methods, Vienna'},timeout:20000});
   assert.equal(result.status,0,result.stderr);
   const a=JSON.parse(readFileSync(join(output,'A','manifest.json'),'utf8'));
   const b=JSON.parse(readFileSync(join(output,'B','manifest.json'),'utf8'));
   assert.deepEqual(a.frozen,b.frozen);
   snapshots.push(a.frozen);
  }
  assert.notDeepEqual(snapshots[0],snapshots[1],'executed scorer dependency must be frozen');
  assert.notEqual(snapshots[0].fact_scorer_sha256,snapshots[1].fact_scorer_sha256);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
