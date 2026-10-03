/** Exercise the actual request_agent tool on a private built hub. Requires only the allowed gpt-6-astra model. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const base=process.argv[2]??'http://127.0.0.1:18737',out=process.argv[3]??'/tmp/astra3-live-recruits';
assert.notEqual(new URL(base).port,'7717');
mkdirSync(out,{recursive:true});
const room='codex-recruit-proof',name='native-recruit-proof';
const client=new Client({name:'launch-proof',version:'1'});
await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp')));
const call=async(tool:string,args:any)=>{const response:any=await client.callTool({name:tool,arguments:args});assert.ok(!response.isError,response.content?.[0]?.text);return response;};
try {
 await call('join_room',{room,name:'pinger',agent:'script',expected_participants:0});
 const requested=await call('request_agent',{room,name,agent:'codex',model:'gpt-6-astra',count:1,can_edit:false,cwd:mkdtempSync(join(tmpdir(),'codex-recruit-proof-')),brief:'Validate this launcher path only. Join the named room, run one local shell command `printf native-recruit-work`, send_message to @pinger saying 125+205+100=430, leave_room with reason="launcher proof complete", then final text NATIVE_RECRUIT_DONE. No files, research, proposals, or further recruits.'});
 writeFileSync(join(out,'request-agent.json'),JSON.stringify(requested,null,2));
 let agent:any;
 for(let i=0;i<600;i++){
  agent=((await(await fetch(base+'/agents')).json()) as any[]).find(a=>a.name===name);
  if(agent?.endedAt)break;
  await new Promise(r=>setTimeout(r,500));
 }
 assert.ok(agent?.endedAt,'recruit must finish');assert.equal(agent.exitCode,0);
 const snapshot:any=await(await fetch(base+'/rooms/'+room)).json();
 const member=snapshot.participants.find((p:any)=>p.name===name);
 assert.ok(member&&!member.active,'recruit joined and left');
 const messages:any[]=await(await fetch(base+'/rooms/'+room+'/messages')).json();
 assert.ok(messages.some(m=>m.from?.name===name&&m.content.includes('430')),'recruit reported its work');
 const usage=JSON.parse(readFileSync(join(out,name+'.usage.json'),'utf8'));
 assert.ok(usage.prompt_tokens>0&&usage.completion_tokens>0);assert.equal(usage.cost,null);
 writeFileSync(join(out,'proof.json'),JSON.stringify({room,agent,usage,snapshot,messages},null,2));
 console.log(JSON.stringify({room,exit:agent.exitCode,joined:true,left:true,usage}));
 const report=messages.filter(m=>m.from?.name===name).at(-1);
 await call('send_message',{room,reply_to:report.id,content:'Launcher proof collected; thank you.',force:true});
 await call('leave_room',{room,reason:'recruit proof collected'});
} finally {await client.close();}
