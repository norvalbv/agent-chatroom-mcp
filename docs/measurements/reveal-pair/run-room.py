"""One room of decision/reveal-rivals-protocol (item/reveal-lever-pair), adapted from RSI-7's run-arm.py
(swarm-193427-ztnx, 6-1-sol-4) for a code task. Run from the worktree whose dist/ is the build under test:
  python3 -I docs/measurements/reveal-pair/run-room.py <S1|S2|S3|A1|B1|B2|A2|A3|B3|DEV> [--port 7881] [--task bench-printf-format]
B* and DEV start the hub with CHATROOM_REVEAL_RIVALS=1; S* and A* without. Outputs go to swarms/reveal-pair/<slot>/.
outcome is one of pass | fail | timeout | infra, decided only from the run's own artifacts (decision/reveal-rivals-protocol):
infra if any infra_reasons (runner error; no result.json, or only the launcher's crash-time checkpoint; a lead-room payload
error; room missing; fewer than 3 seats joined; a launcher exit other than swarm.ts's 0-iff-concluded / 1-otherwise; a seat
exit before the deadline in a room that did not conclude; a usage or session limit in the launcher or seat logs or
result.json; the scorer's infrastructure_error; a frozen hash changed; a STOP file or the runner's 1080 s guard); else pass
or fail if the room concluded (oracle task_pass or not); else timeout if the launcher's own outcome.timedOut is true; else
no_conclusion (every seat exited cleanly with nothing agreed). Only infra is excluded from the screen's 1-2/3 gate, and it
reruns once as <slot>r only if a physical room remains under the cap; a fail, timeout or no_conclusion is never replaced.
python3 -I docs/measurements/reveal-pair/classify-check.py [ref] runs these statements on fixtures with no hub or seats.
The hub and the launcher are this script's own children, stopped by PID in `finally`; the hub never runs --always."""
import sys,os,json,time,pathlib,tempfile,subprocess,hashlib,shutil,re,urllib.request
args=sys.argv[1:]; slot=args[0]
def opt(name,default):
  return args[args.index(name)+1] if name in args else default
port=int(opt('--port','7881')); task_id=opt('--task','bench-printf-format')
if not re.fullmatch(r'((S[1-3]|[AB][1-3])r?|DEV\d?|DRY\d?)',slot): raise SystemExit('unknown slot')
if slot.startswith('DRY')!=('--dry' in args): raise SystemExit('DRY slots and --dry go together')
if not 7880<=port<=7887: raise SystemExit('port must be 7880-7887')
repo=pathlib.Path.cwd(); task=repo/'tasks'/task_id
root=repo/'swarms/reveal-pair'/slot
if root.exists(): raise SystemExit(f'refusing existing slot dir {root}')
root.mkdir(parents=True)
rivals=slot.startswith('B') or slot.startswith('DEV')
def tree_hash(path,skip=()):
  h=hashlib.sha256()
  for p in sorted(path.rglob('*')):
    if any(part in skip for part in p.relative_to(path).parts): continue
    if p.is_symlink(): raise RuntimeError(f'symlink in frozen tree: {p}')
    if p.is_file(): h.update(str(p.relative_to(path)).encode());h.update(b'\0');h.update(p.read_bytes());h.update(b'\0')
  return h.hexdigest()
def file_hash(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def save(name,obj): (root/name).write_text(json.dumps(obj,indent=2)+'\n')
def now(): return time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
load=os.getloadavg()[0]; mem=subprocess.check_output(['memory_pressure'],text=True)
free=int(re.search(r'System-wide memory free percentage:\s*(\d+)%',mem)[1])
preflight={'at':now(),'load1':load,'memory_free_pct':free,'load_limit':16,'free_min':25}
save('preflight.json',preflight)
if (load>=16 or free<25) and not slot.startswith('DRY'): raise SystemExit(f'machine gate blocked: load1 {load:.2f}, free {free}%')  # a dry run starts no seat
probe=subprocess.run(['lsof','-ti',f':{port}','-sTCP:LISTEN'],capture_output=True,text=True).stdout.strip()
if probe: raise SystemExit(f'port {port} is in use by pid {probe}')
try: os.nice(10)
except OSError as e: preflight['nice']=f'refused: {e}'; save('preflight.json',preflight)
head=subprocess.check_output(['git','rev-parse','--short=8','HEAD'],text=True).strip()
frozen={'task_sha256':tree_hash(task),'scorer_sha256':file_hash(repo/'scripts/bench-oracle.ts'),'hub_entry_sha256':file_hash(repo/'dist/index.js'),'dist_sha256':tree_hash(repo/'dist'),'head':head,'runner_sha256':file_hash(pathlib.Path(__file__).resolve())}
workspace=pathlib.Path(tempfile.mkdtemp(prefix=f'reveal-pair-{slot}-'));shutil.copytree(task/'public',workspace,dirs_exist_ok=True)
common='''This is a fixed-seat benchmark. Work only from the files in your current working directory; do not read files elsewhere except temporary files you create under /tmp. No network or external research. All three seats including the verifier submit an independent sealed opening before reading peers. After the reveal, settle differences by the specification or executable checks. The submission is format.ts in this working directory as it stands when the room concludes: coordinate so that one correct implementation is there. The room's final agreed proposal states that format.ts is complete and how it was checked. Do not modify README.md, brief.txt or package.json. Call wait_for_messages with hold_until_actionable=true. No decision record is needed for this benchmark.'''
brief=(task/'public/brief.txt').read_text().strip()+'\n\n'+common
(root/'brief.txt').write_text(brief)
env={k:v for k,v in os.environ.items() if not k.startswith('CHATROOM_')}
env.update(CHATROOM_INSECURE_LOCAL='1',CHATROOM_NO_RECRUIT='1',CHATROOM_DATA_DIR=str(root/'data'),CHATROOM_DEFAULT_CWD=str(workspace),HOST='127.0.0.1',PORT=str(port))
if rivals: env['CHATROOM_REVEAL_RIVALS']='1'
manifest={'slot':slot,'rivals':rivals,'task':task_id,'workspace':str(workspace),'port':port,'preflight':preflight,'frozen':frozen,'brief_sha256':hashlib.sha256(brief.encode()).hexdigest(),'started_at':now(),'model':'claude-opus-5-5','effort':'xhigh','seats':3,'timeout_min':15,'runner_pid':os.getpid()}
save('manifest.json',manifest)
hub=None; launch=None; start=time.time()
try:
  hublog=(root/'hub.log').open('w')
  hub=subprocess.Popen(['node',str(repo/'dist/index.js')],cwd=workspace,env=env,stdout=hublog,stderr=subprocess.STDOUT)
  manifest['hub_pid']=hub.pid;save('manifest.json',manifest)
  ready=False
  for _ in range(100):
    if hub.poll() is not None: raise RuntimeError('hub exited')
    try:
      with urllib.request.urlopen(f'http://127.0.0.1:{port}/rooms',timeout=1) as r: ready=r.status==200
    except Exception: pass
    if ready: break
    time.sleep(.2)
  if not ready: raise RuntimeError('hub not ready')
  argv=['node',str(repo/'dist/swarm.js'),brief,'--flat','--agents','3','--models','claude-opus-5-5','--verifier-model','claude-opus-5-5','--effort','xhigh','--timeout','15','--port',str(port),'--cwd',str(workspace),'--full-access','--no-carry','--no-seat-targets','--no-web','--named','--result-path',str(root/'result.json')]
  manifest['argv']=argv[:2]+['<brief>']+argv[3:];save('manifest.json',manifest)
  if '--dry' in args: argv=['node','-e','setTimeout(()=>{},1500)']  # runner check only: hub start, scoring, hashes, PID stop; no seats
  with (root/'launcher.log').open('w') as out:
    launch=subprocess.Popen(argv,cwd=repo,env=env,stdout=out,stderr=subprocess.STDOUT);manifest['launcher_pid']=launch.pid;save('manifest.json',manifest)
    while launch.poll() is None:
      if (root/'STOP').exists() or time.time()-start>1080:
        manifest['operator_stopped']='stop_file' if (root/'STOP').exists() else 'runner_guard';launch.terminate();break
      time.sleep(.5)
    code=launch.wait(timeout=30)
  manifest['launcher_exit_code']=code;save('manifest.json',manifest)
  result=json.loads((root/'result.json').read_text()) if (root/'result.json').exists() else {}
  room=result.get('leadRoom'); payload=next((x['payload'] for x in result.get('rooms',[]) if x.get('name')==room),{})
  conclusion=(payload.get('conclusion') or {}).get('text'); timed=bool((result.get('outcome') or {}).get('timedOut',False))  # the launcher's own deadline flag, never inferred from a missing conclusion
  js="import {scoreTask} from './scripts/bench-oracle.ts'; console.log(JSON.stringify(await scoreTask(process.argv[1],process.argv[2])));"
  scored=json.loads(subprocess.check_output(['node','--import','tsx','--input-type=module','-e',js,str(task),str(workspace)],cwd=repo,text=True))
  after={'task_sha256':tree_hash(task),'scorer_sha256':file_hash(repo/'scripts/bench-oracle.ts'),'hub_entry_sha256':file_hash(repo/'dist/index.js'),'dist_sha256':tree_hash(repo/'dist')}
  unchanged=all(after[k]==frozen[k] for k in after)
  failing=[r['name'] for r in scored.get('oracle_results',[]) if r.get('exit_code')!=0]
  log=root/'data'/f'{room}.jsonl' if room else None
  events=[json.loads(l) for l in log.read_text().splitlines() if l.strip()] if log and log.exists() else []
  count=lambda t:[e for e in events if e.get('type')==t]
  board={}
  for e in events:
    if e.get('type')=='board': board[e['key']]=(e.get('entry') or {}).get('text','')
  msgs=[e.get('message') or e.get('msg') or e for e in events if e.get('type') in ('message','post')]
  rival_asks={e['ask'] for e in count('rival_assigned')}
  texts=[t for k,t in board.items() if k.startswith('idea/')]
  for m in msgs:
    c=m.get('content','') if isinstance(m,dict) else ''
    if isinstance(m,dict) and (m.get('tag')=='rival' or m.get('replyTo') in rival_asks): texts.append(c)
  names_error=any(re.search(r'exponent',t,re.I) and re.search(r'(exact|binary|power of (ten|10)|after rounding|1e-0?7|%\.17g|9\.99)',t,re.I) for t in texts)
  names_check=any(re.search(r'(/usr/bin/printf|system printf|real printf|libc|C printf|snprintf|python.{0,20}%)',t,re.I) for t in texts)
  joined={(e.get('p') or {}).get('name') for e in count('join') if (e.get('p') or {}).get('agent')!='human'}
  limit_re=re.compile(r"usage limit|session limit|hit your [^\n]{0,30}limit|rate.limited|overloaded_error",re.I)
  run_dir=repo/'swarms'/room.removesuffix('-room') if room else None  # seat logs: a usage limit can be only in a seat's own output (src/respawn.ts)
  logs=[root/'launcher.log']+(sorted(run_dir.glob('*.log'))+sorted(run_dir.glob('*.out')) if run_dir and run_dir.is_dir() else [])
  launcher_text='\n'.join(f.read_text(errors='replace') for f in logs if f.exists())
  infra=[]
  # only the launcher's final artifact has outcome; the checkpoint it persists while seats run (src/swarm.ts persistIncremental) has none
  final=result.get('outcome') if isinstance(result.get('outcome'),dict) else None
  deadline=bool(final and final.get('timedOut') is True)
  if manifest.get('operator_stopped'): infra.append(str(manifest['operator_stopped']))
  if not (root/'result.json').exists(): infra.append('no_result_json')
  elif final is None: infra.append('partial_result_json')
  if any('incremental checkpoint' in str(x) or 'payload:' in str(x) for x in result.get('collectionErrors') or []): infra.append('collection_error')
  if not room or (final or {}).get('kind')=='room_missing': infra.append('room_missing')
  if room and len(joined)<3: infra.append(f'seats_joined_{len(joined)}_of_3')
  if code not in (0,1) or (code==0)!=(conclusion is not None): infra.append(f'launcher_exit_{code}')  # swarm.ts exits 0 iff the lead room concluded, else 1
  if conclusion is None and not deadline and any(x.get('exitCode')!=0 for x in result.get('scorecard') or [] if 'exitCode' in x): infra.append('seat_exit_before_deadline')
  if limit_re.search(launcher_text) or limit_re.search(json.dumps(result)): infra.append('usage_or_session_limit')
  if scored.get('reason')=='infrastructure_error': infra.append('scorer_infrastructure_error')
  if not unchanged: infra.append('frozen_hash_changed')
  outcome='infra' if infra else ('pass' if scored.get('passed') else 'fail') if conclusion is not None else 'timeout' if deadline else 'no_conclusion'
  framing={}
  for e in count('framing'): framing[f"{e['action']}{'/assigned' if e.get('by_assigned') else ''}"]=framing.get(f"{e['action']}{'/assigned' if e.get('by_assigned') else ''}",0)+1
  summary={'slot':slot,'rivals':rivals,'room':room,'outcome':outcome,'infra_reasons':infra,'counts_toward_gate':outcome!='infra','concluded':conclusion is not None,'timed_out':timed,'primary_pass':outcome=='pass',
    'launcher_exit_code':code,'logs_scanned':[str(f) for f in logs if f.exists()],'seats_joined':sorted(n for n in joined if n),'run_outcome':result.get('outcome'),
    'artifact':scored.get('reason'),'failing_cases':failing[:20],'failing_n':len(failing),'anti_tamper_unchanged':unchanged,'frozen':frozen,'duration_s':round(time.time()-start,2),
    'usage':result.get('usage'),'per_seat':[{'name':x.get('name'),'cost':x.get('cost'),'killed_at_timeout':x.get('killedAtTimeout')} for x in result.get('scorecard',[])],
    'openings':len(count('opening')),'alternatives':sum(len(e.get('alternatives') or []) for e in count('opening')),
    'ideas_seeded':next((e.get('ideas_seeded',[]) for e in count('openings_revealed')),[]),
    'framings_seeded':next((e.get('keys',[]) for e in count('framings_seeded')),[]),
    'rival_assigned':[{k:e.get(k) for k in ('seat','key','source','from','overlap')} for e in count('rival_assigned')],
    'rival_answered':[{k:e.get(k) for k in ('seat','key','via','held_claim','minutes_since_reveal','chars')} for e in count('rival_answered')],
    'framing_events':framing,'names_case458_error':names_error,'names_catching_check':names_check,'framing_texts_n':len(texts),
    'conclusion':conclusion,'room_log':str(log) if log else None}
  save('summary.json',summary);print(json.dumps({k:summary[k] for k in ('slot','room','outcome','infra_reasons','concluded','timed_out','primary_pass','artifact','failing_n','failing_cases','rival_assigned','rival_answered','framing_events','names_case458_error','names_catching_check','duration_s')}),flush=True)
except Exception as e:
  manifest['error']=str(e);save('manifest.json',manifest)
  if not (root/'summary.json').exists(): save('summary.json',{'slot':slot,'rivals':rivals,'outcome':'infra','infra_reasons':[f'runner: {e}'],'counts_toward_gate':False,'primary_pass':False})
  print('ROOM ERROR (infra):',str(e),flush=True);raise
finally:
  for child in [launch,hub]:
    if child and child.poll() is None:
      child.terminate()
      try: child.wait(timeout=15)
      except subprocess.TimeoutExpired: child.kill();child.wait()
  manifest['completed_at']=now();manifest['duration_s']=round(time.time()-start,2);save('manifest.json',manifest)
