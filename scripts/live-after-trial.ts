/** Isolated real-seat feasibility trial; orchestration only, never generates agent answers. */
import { spawn, execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { seatChildEnv } from '../src/env.js';
const cwd = process.cwd();
const root = resolve(process.argv[2] ?? '/tmp/swarm-200839-live-after-trial');
const port = Number(process.argv[3] ?? 18839);
if (port <= 8000) throw new Error('Use an isolated port >8000');
if (existsSync(root)) throw new Error(`Refusing to reuse ${root}`);
const check = createServer(); await new Promise<void>((ok, fail) => { check.once('error', fail); check.listen(port, '127.0.0.1', () => check.close(() => ok())); });
mkdirSync(root, {recursive:true}); mkdirSync(resolve(root,'data'));
const room = 'addressing-live-after-6';
const names = ['capacity','intake','safety','access','budget','operations'].map(n => `trial-${n}`);
const topic = 'Design one workable Saturday community repair cafe: choose booking versus walk-in mix, volunteer assignment, intake triage, stop rules, and a fallback for a busy morning. Six colleagues hold complementary constraints. Agree a concrete plan, test it against each constraint, and identify the one unresolved tradeoff. No implementation or external research is needed.';
const lenses = [
'Capacity facts: four repair volunteers can each handle one item at a time; median repair takes 35 minutes with a 15-70 minute spread. Doors open 09:00-13:00; last intake must leave time to close. You care about queues and how to buffer uncertainty.',
'Intake facts: forecast 24 arrivals, but plausible range is 12-40; approximately half are small electronics, a quarter bicycles, a quarter clothing. Two volunteers know electronics, one bicycles, one clothing. You care about eligibility and fair routing.',
'Safety facts: no mains-powered devices can be energized on site; no gas appliances, lithium-battery repair, or safety-critical bicycle brake work. Volunteers may diagnose visually and refer out. You care about clear stop rules without over-rejecting useful repairs.',
'Access facts: online booking alone excludes some neighbours; six visitors are likely to arrive without appointments and two visitors may need language assistance. The space seats only eight waiting visitors. You care about a fair mixed-access scheme.',
'Budget facts: there is $120 for consumables; no paid technicians and no on-site sales. Parts requiring purchase must be referred or scheduled for another day. Donated parts are not guaranteed. You care about scope and cost guardrails.',
'Operations facts: one host can greet and triage, but cannot also continuously manage a long queue. Volunteers need staggered 15-minute breaks. The building closes promptly at 13:00. You care about roles, escalation, and a fallback under overload.'
];
const prompts = names.map((name,i) => `You are ${name}, one of six autonomous colleagues in room ${room}. Join that room with name ${name}, agent openrouter. Your colleagues are ${names.filter(n=>n!==name).join(', ')}. Goal: ${topic}\nYour private planning constraint: ${lenses[i]}\nRead the room and use its board as needed. In the initial discussion, identify three substantive uncertainties where another colleague's constraints affect your recommendation, and ask the relevant colleagues directly; do not invent their answers. Aim to get the main cross-checks onto the table during the first five minutes, then work toward a scrutinised plan. This is a discussion only: do not recruit, edit files, run commands, or join any other room. The hub carries coordination. When the room concludes, leave.`);
const revision = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const manifest:any = {root,cwd,port,room,revision,branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),created_at:new Date().toISOString(),names,model:'stealth/union-alpha',topic,prompts,cohort:'All deduplicated accepted nonopening agent chat/target pairs among these fixed six agents; includes @-backs; no scripted messages.',window_minutes:15,first_five_minutes:'Traffic target only, not a denominator restriction.',children:[]};
const save = () => writeFileSync(resolve(root,'manifest.json'),JSON.stringify(manifest,null,2)); save();
const env = {...process.env}; for(const key of Object.keys(env)) if(key.startsWith('CHATROOM_')) delete env[key];
Object.assign(env,{PORT:String(port),HOST:'127.0.0.1',CHATROOM_DATA_DIR:resolve(root,'data'),CHATROOM_DEFAULT_CWD:cwd,CHATROOM_LOG_DIR:resolve(root,'spawned'),CHATROOM_MAX_LIVE_AGENTS:'8',CHATROOM_MAX_LIVE_PER_ROOM:'6'});
const hubFd = openSync(resolve(root,'hub.log'),'w');
const hubEntry = process.env.TRIAL_HUB_ENTRY ?? 'dist/index.js'; manifest.hub_entry = hubEntry; // BEFORE/AFTER: point at another build's hub, same seats and analyzer
const hub = spawn(process.execPath,[hubEntry],{cwd,env,stdio:['ignore',hubFd,hubFd]}); manifest.hub_pid=hub.pid; save();
const seats:ReturnType<typeof spawn>[]=[]; const seatFds:number[]=[];
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
try {
  let ready=false; for(let i=0;i<100;i++){ try { if((await fetch(`http://127.0.0.1:${port}/rooms`)).ok){ready=true;break;} }catch{} await delay(100); }
  if(!ready) throw new Error('Isolated hub did not become ready');
  const response=await fetch(`http://127.0.0.1:${port}/rooms/${room}/create`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({topic,expected_participants:6,quorum:'unanimous',require_verification:false,require_challenge:true,anonymous:false,max_message_chars:2000})});
  writeFileSync(resolve(root,'create-room.json'),await response.text()); if(!response.ok) throw new Error(`create room HTTP ${response.status}`);
  manifest.launch_at=new Date().toISOString();save();
  for(let i=0;i<6;i++){
    const args=['dist/openrouter.js','-p',prompts[i],'--model',manifest.model,'--mcp-url',`http://127.0.0.1:${port}/mcp`,'--cwd',cwd,'--no-shell','--max-minutes','12'];
    const outFd=openSync(resolve(root,`${names[i]}.log`),'w');
    const child=spawn(process.execPath,args,{cwd,env:seatChildEnv(env),stdio:['ignore',outFd,outFd]}); seats.push(child); seatFds.push(outFd);
    const record:any={name:names[i],pid:child.pid,args,started_at:new Date().toISOString()};manifest.children.push(record);save();
    child.on('exit',(code,signal)=>{record.exit_code=code;record.exit_signal=signal;record.exit_at=new Date().toISOString();save();});
  }
  const log=resolve(root,'data',`${room}.jsonl`); const started=Date.now();
  while(true){
    const events=existsSync(log)?readFileSync(log,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
    const messages=events.filter(e=>e.type==='message').map(e=>e.msg);
    const asks=messages.filter(m=>m.kind==='chat'&&m.tag!=='opening'&&m.from.agent==='openrouter'&&(m.mentions?.length??0)>0);
    const last=asks.length?Math.max(...asks.map(m=>Date.parse(m.ts))):started;
    manifest.last_eligible_ask_at=asks.length?new Date(last).toISOString():null;
    manifest.observation_status={at:new Date().toISOString(),asks_messages:asks.length,all_seats_exited:seats.every(s=>s.exitCode!==null||s.signalCode!==null),earliest_completion:new Date(last+15*60000).toISOString()};save();
    if(seats.every(s=>s.exitCode!==null||s.signalCode!==null)&&Date.now()>=last+15*60000)break;
    if(Date.now()-started>35*60000)throw new Error('35min observation limit reached');
    await delay(10000);
  }
  manifest.observation_end=new Date().toISOString();save();
  const args=['--import','tsx','scripts/reply-metrics.ts',log,'--reply-window-minutes','15','--observation-end',manifest.observation_end];
  manifest.analyzer_command=[process.execPath,...args];
  writeFileSync(resolve(root,'reply-metrics.json'),execFileSync(process.execPath,args,{cwd,encoding:'utf8'}));
  const statsText=await (await fetch(`http://127.0.0.1:${port}/rooms/${room}/stats?reply_window_minutes=15`)).text();
  writeFileSync(resolve(root,'http-stats.json'),statsText);
  const apiEnd=JSON.parse(statsText).reply_metrics?.observation_end;
  if(apiEnd) writeFileSync(resolve(root,'reply-metrics-api-cutoff.json'),execFileSync(process.execPath,['--import','tsx','scripts/reply-metrics.ts',log,'--reply-window-minutes','15','--observation-end',apiEnd],{cwd,encoding:'utf8'}));
  manifest.completed_at=new Date().toISOString();save();
}catch(error){manifest.error=String(error);save();process.exitCode=1;}
finally {for(const seat of seats)if(seat.exitCode===null&&seat.signalCode===null)seat.kill('SIGTERM'); if(hub.exitCode===null)hub.kill('SIGTERM'); try{closeSync(hubFd);}catch{} for(const fd of seatFds){try{closeSync(fd);}catch{}} manifest.stopped_own_hub_at=new Date().toISOString();save();}
