import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCodexLive } from '../src/codex/live.ts';

async function exercise(rejectSteer = false, failed = false) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-steer-'));
  const binary = join(dir, 'codex'), calls = join(dir, 'calls.jsonl'), output = join(dir, 'final');
  writeFileSync(binary, `#!/usr/bin/env node
const fs=require('node:fs'),rl=require('node:readline');
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
rl.createInterface({input:process.stdin}).on('line',line=>{
 const x=JSON.parse(line);fs.appendFileSync(${JSON.stringify(calls)},line+'\\n');
 if(x.method==='initialize')send({id:x.id,result:{}});
 if(x.method==='thread/start')send({id:x.id,result:{thread:{id:'thread'}}});
 if(x.method==='turn/start'){send({id:x.id,result:{turn:{id:'turn'}}});send({method:'item/started',params:{threadId:'thread',item:{id:'busy',type:'commandExecution',command:'sleep 10',aggregatedOutput:'busy output',exitCode:null,status:'inProgress'}}});}
 if(x.method==='turn/steer'){
  setTimeout(()=>{
   send(${rejectSteer ? "{id:x.id,error:{code:-32600,message:'turn ended'}}" : "{id:x.id,result:{turnId:'turn'}}"});
   send({method:'item/completed',params:{threadId:'thread',item:{id:'answer',type:'agentMessage',text:'FINISHED',phase:'final_answer'}}});
   send({method:'thread/tokenUsage/updated',params:{threadId:'thread',tokenUsage:{total:{inputTokens:100,cachedInputTokens:60,outputTokens:5}}}});
   send({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:${JSON.stringify(failed ? 'failed' : 'completed')}}}});
  },70);
 }
});`);
  chmodSync(binary, 0o755);
  let acknowledgements = 0, peeks = 0;
  const server = createServer((req, res) => {
    let raw='';req.on('data', d=>raw+=d);req.on('end',()=>{
      const body=JSON.parse(raw);
      res.setHeader('content-type','application/json');
      if(req.url==='/heartbeat') { assert.equal(body.tool,'codex');assert.equal(body.detail,'sleep 10');assert.equal(body.peek,undefined,'local activity must heartbeat, not only peek');peeks++;res.end(JSON.stringify({pending:[{id:'mention',room:'room',from:'peer',text:'@busy answer this'}]})); }
      else { acknowledgements++;assert.deepEqual(body.ids,['mention']);if(acknowledgements===1){res.statusCode=503;res.end('{}');}else res.end('{"ok":true}'); }
    });
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const previousKey=process.env.CHATROOM_SEAT_KEY, previousUrl=process.env.CHATROOM_HEARTBEAT_URL;
  process.env.CHATROOM_SEAT_KEY='seat-key';process.env.CHATROOM_HEARTBEAT_URL=`http://127.0.0.1:${(server.address() as any).port}/heartbeat`;
  const events:any[]=[];
  try {
    const run = runCodexLive({cwd:dir,mcpUrl:'http://example.test/mcp',readOnly:true,model:'gpt-6-astra',prompt:'work',binary,pollMs:5,outFile:output,emit:e=>events.push(e)});
    if (failed) await assert.rejects(run, /Codex turn failed/);
    else { assert.equal(await run,'FINISHED'); assert.equal(readFileSync(output,'utf8'),'FINISHED'); }
    const requests=readFileSync(calls,'utf8').trim().split('\n').map(x=>JSON.parse(x));
    assert.equal(requests.filter(x=>x.method==='turn/steer').length,1,'slow RPC must not admit overlapping polls');
    assert.deepEqual(requests.find(x=>x.method==='turn/steer').params,{threadId:'thread',expectedTurnId:'turn',input:[{type:'text',text:'[Chatroom room, from peer, reply_to=mention]\n@busy answer this',text_elements:[]}]});
    assert.equal(requests.find(x=>x.method==='thread/start').params.sandbox,'read-only');
    assert.equal(acknowledgements,rejectSteer?0:2,'ACK only acceptance; accepted ACK retries through completion, without reinjection');
    assert.equal(events.filter(x=>x.type==='steering.accepted').length,rejectSteer?0:1);
    assert.equal(events.find(x=>x.type==='turn.completed').usage.input_tokens,100);
    assert.equal(peeks,1);
    const busy = events.find(x=>x.item?.type==='command_execution').item;
    assert.equal(busy.aggregated_output,'busy output'); assert.equal(busy.exit_code,null);
    assert.equal(busy.status,'in_progress'); assert.ok(!('aggregatedOutput' in busy));
  } finally {
    if(previousKey===undefined)delete process.env.CHATROOM_SEAT_KEY;else process.env.CHATROOM_SEAT_KEY=previousKey;
    if(previousUrl===undefined)delete process.env.CHATROOM_HEARTBEAT_URL;else process.env.CHATROOM_HEARTBEAT_URL=previousUrl;
    await new Promise<void>(r=>server.close(()=>r()));rmSync(dir,{recursive:true,force:true});
  }
}
test('busy Codex gets one steer and accepted ACK survives completion/transport failure',()=>exercise());
test('wrong-turn rejection never acknowledges the pending mention',()=>exercise(true));

test('failed terminal status fails the seat while retaining usage and ACKs',()=>exercise(false,true));

test('initialization refusal reaps the app-server child before failing the seat', async () => {
  const dir=mkdtempSync(join(tmpdir(),'codex-init-')), binary=join(dir,'codex'), pidFile=join(dir,'pid');
  writeFileSync(binary,`#!/usr/bin/env node
require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const x=JSON.parse(line);process.stdout.write(JSON.stringify({id:x.id,error:{code:-32600,message:'initialization refused'}})+'\\n');
});`);
  chmodSync(binary,0o755);
  try {
    await assert.rejects(runCodexLive({cwd:dir,mcpUrl:'http://example.test/mcp',readOnly:true,prompt:'work',binary,emit:()=>{}}),/initialization refused/);
    const pid=Number(readFileSync(pidFile,'utf8'));
    assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  } finally {rmSync(dir,{recursive:true,force:true});}
});
