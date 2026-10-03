import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
const [buildArg,label,portArg,expectedCommit]=process.argv.slice(2);
const build=resolve(buildArg), port=Number(portArg), source=process.env.BENCH_SOURCE;
assert(port!==7717&&port>1024&&port<65536);
const url=`http://127.0.0.1:${port}`;
const sha=x=>createHash('sha256').update(x).digest('hex');
const files=d=>readdirSync(d,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(join(d,x.name)):[join(d,x.name)]).sort();
const oracle=join(source,'scripts/recruitment-policy-oracle.py');
const brief=spawnSync('python3',[oracle,'--brief'],{encoding:'utf8'}).stdout.trim();
const scratch=mkdtempSync(join(tmpdir(),'recruit-policy-trial-'));
const cwd=join(scratch,'work');mkdirSync(cwd);
const artifact=join(scratch,'result.json'), logFile=join(scratch,'launcher.log');
const env={...process.env,PORT:String(port),CHATROOM_INSECURE_LOCAL:'1',CHATROOM_RECRUIT_AGENT:'codex',CHATROOM_RECRUIT_MODEL:'gpt-6-astra',CHATROOM_MAX_LIVE_AGENTS:'8',CHATROOM_SPAWN_DRY:'1',CHATROOM_DATA_DIR:join(scratch,'data'),CHATROOM_LOG_DIR:join(scratch,'recruits'),DISABLE_PROMPT_CACHING:'1'};
delete env.BENCH_SOURCE;
try{await fetch(url);throw Error('port occupied');}catch(e){if(!(e instanceof TypeError))throw e;}
const hub=spawn(process.execPath,[join(build,'dist/index.js')],{cwd:build,env,stdio:['ignore','ignore','inherit']});
let launcher;
const cleanup=()=>{if(launcher&&launcher.exitCode===null)launcher.kill('SIGTERM');if(hub.exitCode===null)hub.kill('SIGTERM');};
process.on('SIGTERM',cleanup);process.on('SIGINT',cleanup);
try{
 for(let i=0;;i++){try{if((await fetch(url)).ok)break;}catch{}if(i>100||hub.exitCode!==null)throw Error('hub startup failed');await new Promise(r=>setTimeout(r,100));}
 const start=Date.now();
 launcher=spawn(process.execPath,[join(build,'dist/swarm.js'),brief,'--flat','--agents','3','--models','claude-opus-5-5','--verifier-model','claude-opus-5-5','--no-carry','--no-web','--cwd',cwd,'--timeout','3','--port',String(port),'--result-path',artifact],{cwd:build,env,stdio:['ignore','pipe','pipe']});
 console.log(JSON.stringify({label,hub_pid:hub.pid,launcher_pid:launcher.pid,scratch}));
 let log='';launcher.stdout.on('data',d=>{log+=d;process.stdout.write(d);});launcher.stderr.on('data',d=>{log+=d;process.stderr.write(d);});
 const exit=await new Promise(r=>launcher.once('close',r));writeFileSync(logFile,log);
 if(!existsSync(artifact))throw Error('no artifact');
 const a=JSON.parse(readFileSync(artifact,'utf8'));
 const events=join(scratch,'data',a.leadRoom+'.jsonl');
 const scored=spawnSync('python3',[oracle,'--artifact',artifact,'--events',events],{encoding:'utf8'});
 if(!scored.stdout.trim())throw Error(scored.stderr);
 const room=a.rooms.find(r=>r.name===a.leadRoom).payload;
 const result={label,commit:expectedCommit,build,entry_sha256:sha(readFileSync(join(build,'dist/index.js'))),dist_sha256:sha(files(join(build,'dist')).map(f=>f.slice(build.length)+':'+sha(readFileSync(f))).join('\n')),brief,brief_sha256:sha(brief),oracle_sha256:sha(readFileSync(oracle)),cache_regime:'DISABLE_PROMPT_CACHING=1 (uncached throughout; transcript audit pending)',dry_spawn:true,policy:{agent:'codex',model:'gpt-6-astra'},machine_limit:8,scratch,artifact,events,run_dir:dirname(a.reportPath),room:a.leadRoom,exit,wall_seconds:(Date.now()-start)/1000,time_to_conclusion_seconds:room.conclusion?.decidedAt?(Date.parse(room.conclusion.decidedAt)-Date.parse(room.created_at))/1000:null,usage:a.usage,score:JSON.parse(scored.stdout)};
 writeFileSync(`/tmp/astra3-recruit-${label}.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{cleanup();if(hub.exitCode===null)await new Promise(r=>hub.once('close',r));}
