/** Offline test: real-seat orchestration spawns seat processes via --seat-entry (no network). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const runner = resolve('scripts/bench-bench.ts');
const task = resolve('tasks/bench-fact-check');
function invoke(args: string[], env: Record<string,string> = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', runner, ...args], { encoding: 'utf8', env: {...process.env, ...env}, timeout: 20000 });
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bench-seat-'));
  const stub = join(root, 'hub.mjs');
  const seat = join(root, 'seat.mjs');
  writeFileSync(stub, `import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
const data=process.env.CHATROOM_DATA_DIR;const seen=[];
const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');
 if(req.method==='POST'&&req.url.endsWith('/create')){let b='';req.on('data',c=>b+=c);req.on('end',()=>{
  const room=req.url.split('/')[2];fs.mkdirSync(data,{recursive:true});
  fs.writeFileSync(path.join(data,room+'.jsonl'),JSON.stringify({type:'state',room,state:'concluded',conclusion:{text:'x',decidedAt:new Date().toISOString()}})+'\\n');
  res.end('{}');});return;}
 if(req.url==='/rooms'){res.end(JSON.stringify({rooms:[],version:'stub-v1'}));return;}
 if(req.url==='/seats'){seen.push(1);fs.appendFileSync(path.join(data,'seats.log'),JSON.stringify({seats:seen.length})+'\\n');res.end('{}');return;}
 res.end('{}');});server.listen(Number(process.env.PORT),'127.0.0.1');`);
  writeFileSync(seat, `console.log('seat ok');`);
  return {root, stub, seat, output: join(root,'run')};
}
async function freePair() {
  for(let p=23000;p<24000;p+=2){const s=[createServer(),createServer()];try{await Promise.all(s.map((x,i)=>new Promise<void>((ok,no)=>{x.once('error',no);x.listen(p+i,'127.0.0.1',ok);})));return p;}catch{}finally{await Promise.all(s.map(x=>new Promise<void>(ok=>x.close(()=>ok()))));}}
  throw Error('no ports');
}
import { createServer } from 'node:net';
test('real-seat mode spawns one seat per arm and records seat provenance',async()=>{
  const f=fixture();try{
  const result=invoke([task,f.stub,f.stub,String(await freePair()),'--root',f.output,'--timeout-ms','4000','--seat-entry',f.seat],{SEAT_MARKER:'offline-seat'});
  assert.equal(result.status,0,result.stderr+result.stdout);
  for(const arm of ['A','B']){
    const dir=join(f.output,arm);
    const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
    assert.ok(manifest.seat_entry===f.seat,'seat entry recorded');
    assert.ok(manifest.seat_pid>0,'seat pid recorded');
    assert.ok(manifest.seat_exit_code!==undefined,'seat exit recorded');
  }
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('refuses seat mode when the seat entry is missing',async()=>{
  const f=fixture();try{
  const result=invoke([task,f.stub,f.stub,String(await freePair()),'--root',f.output,'--timeout-ms','2000','--seat-entry',join(f.root,'nope.mjs')]);
  assert.notEqual(result.status,0);assert.match(result.stderr,/seat/i);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

const wrapper=resolve('bench/seat/real-seat.mjs');
function wrapperFixture(){
 const f=fixture();
 writeFileSync(f.stub,`import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
 const data=process.env.CHATROOM_DATA_DIR;let created=false;let registered=false;
 http.createServer((req,res)=>{res.setHeader('content-type','application/json');
 if(req.url==='/rooms'){res.end('{"rooms":[],"version":"wrapper-test"}');return;}
 if(req.url.endsWith('/create')){let b='';req.on('data',c=>b+=c);req.on('end',()=>{fs.writeFileSync(path.join(data,'create.json'),b);});created=true;fs.writeFileSync(path.join(data,'hub-env.json'),JSON.stringify({credential:process.env.OPENROUTER_API_KEY??null}));res.end('{}');return;}
 if(req.url==='/register'){if(!created){res.statusCode=409;res.end('{}');return;}registered=true;fs.writeFileSync(path.join(data,'registered'),'yes');res.end('{}');return;}
 if(req.url==='/conclude'&&registered){fs.writeFileSync(path.join(data,'benchmark.jsonl'),JSON.stringify({type:'state',state:'concluded',conclusion:{text:'Society for Formal Methods, Vienna'}})+'\\n');res.end('{}');return;}
 res.statusCode=404;res.end('{}');}).listen(Number(process.env.PORT),'127.0.0.1');`);
 writeFileSync(f.seat,`import fs from 'node:fs';import path from 'node:path';
 const args=process.argv.slice(2);const url=args[args.indexOf('--mcp-url')+1];
 if(process.env.OPENROUTER_API_KEY!=='mock-provider-key')throw Error('missing provider credential');
 if(!path.isAbsolute(process.env.BENCH_SEAT_ENTRY))throw Error('provider entry not absolute');
 const registered=await fetch(new URL('/register',url),{method:'POST'});if(!registered.ok)throw Error('room not created before registration');
 fs.writeFileSync('provider-env.json',JSON.stringify({url,entry:process.env.BENCH_SEAT_ENTRY,credential_present:true}));
 if(process.env.MOCK_FAIL==='1')process.exit(23);
 await fetch(new URL('/conclude',url),{method:'POST'});
 await new Promise(r=>setTimeout(r,Number(process.env.MOCK_DELAY??500)));
 fs.writeFileSync('provider-finished','yes');`);
 return f;
}
test('real wrapper fails fast with an explicit missing MCP URL diagnostic',()=>{
 const env={...process.env};delete env.CHATROOM_MCP_URL;
 const result=spawnSync(process.execPath,[wrapper],{env,encoding:'utf8',timeout:2000});
 assert.notEqual(result.status,0);assert.match(result.stderr,/CHATROOM_MCP_URL.*required/);
});
test('actual wrapper registers after room creation, receives seat-only credentials, and completes answer before scoring',async()=>{
 const f=wrapperFixture();try{
 const result=invoke([task,f.stub,f.stub,String(await freePair()),'--root',f.output,'--timeout-ms','4000','--seat-entry',wrapper],{BENCH_SEAT_ENTRY:f.seat,OPENROUTER_API_KEY:'mock-provider-key',CHATROOM_MCP_URL:'http://invalid-parent:1/mcp'});
 assert.equal(result.status,0,result.stderr);
 for(const arm of ['A','B']){
 const dir=join(f.output,arm),manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
 const verdict=JSON.parse(readFileSync(join(dir,'bench-result.json'),'utf8'));
 assert.equal(verdict.passed,true,JSON.stringify({manifest,verdict}));
 assert.equal(manifest.seat_exit_code,0);
 const policy=JSON.parse(readFileSync(join(dir,'data','create.json'),'utf8'));
 assert.equal(policy.expected_participants,1);assert.equal(policy.require_challenge,false,'a solo seat cannot obtain independent challenge');
 assert.equal(readFileSync(join(dir,'data','registered'),'utf8'),'yes');
 assert.equal(JSON.parse(readFileSync(join(dir,'data','hub-env.json'),'utf8')).credential,null);
 assert.equal(readFileSync(join(dir,'workspace','provider-finished'),'utf8'),'yes');
 assert.equal(readFileSync(join(dir,'workspace','answer.txt'),'utf8'),'Society for Formal Methods, Vienna');
 const receipt=JSON.parse(readFileSync(join(dir,'workspace','provider-env.json'),'utf8'));
 assert.equal(receipt.url,`http://127.0.0.1:${manifest.port}/mcp`);assert.equal(receipt.entry,f.seat);
 }
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('provider failure is infrastructure, not an empty answer task failure',async()=>{
 const f=wrapperFixture();try{
 const result=invoke([task,f.stub,f.stub,String(await freePair()),'--root',f.output,'--timeout-ms','1800','--seat-entry',wrapper],{BENCH_SEAT_ENTRY:f.seat,OPENROUTER_API_KEY:'mock-provider-key',MOCK_FAIL:'1'});
 assert.equal(result.status,0,result.stderr);
 for(const arm of ['A','B'])assert.equal(JSON.parse(readFileSync(join(f.output,arm,'bench-result.json'),'utf8')).reason,'infra');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('conclusion cannot bypass the bounded seat completion barrier',async()=>{
 const f=wrapperFixture();try{
 const result=invoke([task,f.stub,f.stub,String(await freePair()),'--root',f.output,'--timeout-ms','1200','--seat-entry',wrapper],{BENCH_SEAT_ENTRY:f.seat,OPENROUTER_API_KEY:'mock-provider-key',MOCK_DELAY:'5000'});
 assert.equal(result.status,0,result.stderr);
 for(const arm of ['A','B']){
 assert.equal(readFileSync(join(f.output,arm,'data','registered'),'utf8'),'yes');
 assert.ok(existsSync(join(f.output,arm,'data','benchmark.jsonl')),'conclusion happened before barrier timeout');
 const verdict=JSON.parse(readFileSync(join(f.output,arm,'bench-result.json'),'utf8'));assert.equal(verdict.reason,'timeout');assert.equal(verdict.passed,false);
 }
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
