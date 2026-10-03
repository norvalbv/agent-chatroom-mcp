/** Same busy-seat brief on an exec build and a native-steering build. Private hubs only; one live seat per repetition. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const arg=(k:string,d:string)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const build=resolve(arg('build','.')),out=resolve(arg('out','/tmp/codex-steer-bench')),port=Number(arg('port','18734'));
assert.notEqual(port,7717);
const {mkdirSync}=await import('node:fs');mkdirSync(out,{recursive:true});
const {codexArgs,codexSeatCommand}=await import(join(build,'dist/codex-seat.js'));
const {seatBeat,seatChildEnv}=await import(join(build,'dist/env.js'));
const url=`http://127.0.0.1:${port}`;
const hub=spawn(process.execPath,[join(build,'dist/index.js')],{cwd:build,env:{...process.env,PORT:String(port),CHATROOM_INSECURE_LOCAL:'1',CHATROOM_DATA_DIR:join(out,'data'),CHATROOM_SPAWN_DRY:'1'},stdio:'ignore'});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const results:any[]=[];
const hash=createHash('sha256');
const scan=(dir:string)=>{for(const f of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=join(dir,f.name);if(f.isDirectory())scan(p);else{hash.update(p.slice(build.length));hash.update(readFileSync(p));}}};scan(join(build,'dist'));
try {
 for(let i=0;;i++){try{if((await fetch(url+'/rooms')).ok)break;}catch{}if(i>100)throw Error('hub did not start');await sleep(100);}
 for(let rep=1;rep<=Number(arg('reps','3'));rep++){
  const room=`codex-busy-${rep}`,peer=new Client({name:'pinger',version:'1'});
  await peer.connect(new StreamableHTTPClientTransport(new URL(url+'/mcp')));
  const call=async(name:string,args:any)=>{const r:any=await peer.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return JSON.parse(r.content[0].text);};
  await call('join_room',{room,name:'pinger',agent:'script',expected_participants:0});
  const cwd=mkdtempSync(join(tmpdir(),'codex-busy-')),beat=seatBeat(url+'/mcp',`codex-bench-${Date.now()}`);
  const outFile=join(out,`rep${rep}.out`);
  const opts={cwd,mcpUrl:beat.mcpUrl,model:'gpt-6-astra',readOnly:true,outFile,json:true};
  const command=codexSeatCommand?codexSeatCommand(opts):{cmd:'codex',args:codexArgs(opts)};
  let brief=`You are worker in chatroom ${room}. Join with join_room(room="${room}",name="worker",agent="codex"). Then perform exactly eight separate local shell tool calls, sequentially: sleep 3; echo BUSY_STEP_N for N=1..8. Do not combine steps into one tool call. Do not read/wait chat during the loop. If an addressed message enters your context, answer it immediately using send_message reply_to, then continue the remaining steps. After all eight steps, wait_for_messages(room="${room}",timeout_ms=1000,hold_until_actionable=true), answer any pending ask, leave_room with reason="benchmark done", and output exactly TOTAL_CENTS=430 (125+205+100). Do not propose, recruit, or do unrelated work.`;
  if (process.argv.includes('--strict-format')) brief=brief.replace('output exactly TOTAL_CENTS=430 (125+205+100)', 'compute 125+205+100 and output only the exact line TOTAL_CENTS=430 with no expression, punctuation, Markdown, or other text');
  const seat=spawn(command.cmd,command.args,{cwd,env:{...seatChildEnv(process.env),...beat.env},stdio:['pipe','pipe','pipe']});
  seat.stdin.end(brief);
  let stdout='',stderr='',partial='',busyStep=0,mention:any=null,reply:any=null,mentionAt=0;
  const events:any[]=[];
  seat.stdout.on('data',d=>{stdout+=d;partial+=d;for(;;){const nl=partial.indexOf('\n');if(nl<0)break;const line=partial.slice(0,nl);partial=partial.slice(nl+1);try{const e=JSON.parse(line);events.push(e);if(e.type==='item.started'&&e.item?.type==='command_execution'){const n=/BUSY_STEP_(\d+)/.exec(e.item.command??'');if(n)busyStep=Number(n[1]);}}catch{}}});
  seat.stderr.on('data',d=>stderr+=d);
  const exited=new Promise<number|null>(r=>seat.on('close',r));
  const watchdog=setTimeout(()=>seat.kill('SIGTERM'),300_000);
  try {
   for(let i=0;i<1200&&seat.exitCode===null;i++){if(busyStep>=2)break;await sleep(100);}
   assert.ok(busyStep>=2,'must observe active local step before mention');
   mentionAt=Date.now();mention=await call('send_message',{room,force:true,content:'@worker quick question while you work: what is 17*3? Reply with 51 now if you see this.'});
   const stepAtMention=busyStep;
   for(let i=0;i<1200&&seat.exitCode===null;i++){
    const msgs:any=await(await fetch(`${url}/rooms/${room}/messages?since=${mention.seq}`)).json();
    reply=(Array.isArray(msgs)?msgs:msgs.messages??[]).find((m:any)=>m.from?.name==='worker'&&m.kind==='chat'&&/51/.test(m.content));
    if(reply)break;await sleep(100);
   }
   const stepAtReply=busyStep,code=await exited;
   const calls=events.filter(e=>e.type==='item.completed'&&e.item?.type==='mcp_tool_call'&&e.item.server==='chatroom');
   const bytes=calls.reduce((n,e)=>n+(e.item.result?.content??[]).reduce((s:number,c:any)=>s+Buffer.byteLength(c.text??''),0),0);
   const result={rep,room,exit:code,oracle:readFileSync(outFile,'utf8').trim()==='TOTAL_CENTS=430',step_at_mention:stepAtMention,step_at_reply:stepAtReply,mention_to_reply_ms:reply?Date.parse(reply.ts)-mentionAt:null,replied:!!reply,tool_calls:calls.length,tool_response_bytes:bytes,usage:events.filter(e=>e.type==='turn.completed').at(-1)?.usage??null,stats:await(await fetch(`${url}/rooms/${room}/stats`)).json()};
   results.push(result);console.log(JSON.stringify({...result,stats:undefined}));
  } finally {clearTimeout(watchdog);if(seat.exitCode===null)seat.kill('SIGTERM');writeFileSync(join(out,`rep${rep}.events.jsonl`),stdout);writeFileSync(join(out,`rep${rep}.err`),stderr);await peer.close();}
 }
} finally {hub.kill('SIGTERM');writeFileSync(join(out,'results.json'),JSON.stringify({build,build_label:arg('label','working tree'),strict_format:process.argv.includes('--strict-format'),entry_sha256:createHash('sha256').update(readFileSync(join(build,'dist/index.js'))).digest('hex'),dist_sha256:hash.digest('hex'),results},null,2));}
