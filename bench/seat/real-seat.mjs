/** One provider seat; successful process exit is the runner's artifact-completion barrier.
 * Workspace isolation is NOT a sandbox. The provider may edit task files via shell.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
const args=process.argv.slice(2);
const flag=(name,d)=>{const i=args.indexOf(name);return i>=0?args[i+1]:d;};
const mcpUrl=flag('--mcp-url',process.env.CHATROOM_MCP_URL??'');
if(!mcpUrl){console.error('CHATROOM_MCP_URL is required');process.exit(2);}
try{const url=new URL(mcpUrl);if(!['http:','https:'].includes(url.protocol))throw Error();}catch{console.error('CHATROOM_MCP_URL must be an absolute HTTP(S) URL');process.exit(2);}
const entry=process.env.BENCH_SEAT_ENTRY;
if(!entry||!isAbsolute(entry)||!existsSync(entry)){console.error('BENCH_SEAT_ENTRY must name an existing absolute provider entry');process.exit(2);}
const cwd=resolve(flag('--cwd',process.cwd()));
const started=Date.now();const model=process.env.OPENROUTER_MODEL??'stealth/union-alpha';
const prompt=`You are benchmark-seat, the only seat in the pre-created benchmark room. Join room benchmark as benchmark-seat. Do not recruit additional agents. Complete the task below using the files in this working directory. For a code task, edit the file before proposing; for an answer task, propose exactly the requested answer. Submit your result as the room conclusion, leave the room after it concludes, and finish.\n\n${readFileSync(join(cwd,'brief.txt'),'utf8')}`;
const seatArgs=[entry,'-p',prompt,'--mcp-url',mcpUrl,'--cwd',cwd,'--model',model,'--write','--max-minutes',flag('--max-minutes',process.env.BENCH_MAX_MINUTES??'3'),'--max-steps','60','--retries','1','--rate-limit-patience-min','0','--request-timeout-ms','60000'];
const child=spawn(process.execPath,seatArgs,{cwd,env:process.env,stdio:['ignore','pipe','pipe']});
let logChars=0;let terminating=false;
for(const stream of [child.stdout,child.stderr])stream.on('data',d=>{logChars+=d.length;process.stderr.write(d);});
const terminate=()=>{terminating=true;child.kill('SIGTERM');setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},200).unref();};
process.on('SIGTERM',terminate);process.on('SIGINT',terminate);
const exit=await new Promise(ok=>{child.on('error',error=>ok({code:null,signal:null,error:String(error)}));child.on('exit',(code,signal)=>ok({code,signal}));});
let answer='';const logPath=join(process.env.CHATROOM_DATA_DIR??cwd,'benchmark.jsonl');
if(existsSync(logPath)){
 const events=readFileSync(logPath,'utf8').split('\n').filter(Boolean).flatMap(l=>{try{return [JSON.parse(l)];}catch{return [];}});
 const conclusion=events.reverse().find(e=>e.type==='state'&&e.state==='concluded'&&typeof e.conclusion?.text==='string');
 answer=conclusion?.conclusion.text??'';
}
if(exit.code===0&&!terminating&&answer){writeFileSync(join(cwd,'answer.txt.tmp'),answer);renameSync(join(cwd,'answer.txt.tmp'),join(cwd,'answer.txt'));}
writeFileSync(join(cwd,'seat-report.json'),JSON.stringify({model,mcp_url:mcpUrl,hub_entry:process.env.BENCH_HUB_ENTRY,seat_pid:child.pid,exit_code:exit.code,exit_signal:exit.signal,error:exit.error??null,duration_ms:Date.now()-started,log_chars:logChars,answer_chars:answer.length,finished_at:new Date().toISOString()},null,2));
process.exit(terminating?143:exit.code===0&&answer?0:exit.code||1);
