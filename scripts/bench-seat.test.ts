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
