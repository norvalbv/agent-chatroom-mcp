import json,glob,collections,sys,statistics as st
from datetime import datetime
def T(s): return datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
PROD={'send_message','board_set','propose','amend','challenge','vote','request_agent','post_to_room','kick_vote','replace_participant','submit_opening'}
rows=[]
for f in sorted(glob.glob(sys.argv[1]+'/swarm-*-room.jsonl')):
    calls=collections.defaultdict(list); names={}; joins={}; leaves={}; t0=None; tend=None; concl=None
    for l in open(f):
        try:d=json.loads(l)
        except:continue
        ty=d.get('type')
        if ty=='call_completion' and d.get('participant') and d.get('ts'):
            t=T(d['ts']); calls[d['participant']].append((t,d['tool'],d['outcome'])); t0=t0 or t; tend=t
        elif ty=='join':
            p=d.get('p') or {}
            if isinstance(p,dict): names[p.get('id')]=(p.get('name'),p.get('role'))
        elif ty=='state' and 'conclu' in json.dumps(d): concl=tend
    if not calls or tend-t0<180: continue
    dur=tend-t0; seat_time=0; idle=0; tail=[]; longest=[]; waits=0; tot=0
    for p,cs in calls.items():
        if len(cs)<5: continue
        seat_time+=cs[-1][0]-cs[0][0]
        run=0;best=0
        for (a,ta,_),(b,tb,_) in zip(cs,cs[1:]):
            if tb=='wait_for_messages' and ta=='wait_for_messages' and 50<=b-a<=60: idle+=b-a; run+=b-a; best=max(best,run)
            else: run=0
        longest.append(best)
        lp=[t for t,tool,o in cs if tool in PROD and o=='success']
        if lp: tail.append(cs[-1][0]-lp[-1])
        waits+=sum(1 for c in cs if c[1]=='wait_for_messages'); tot+=len(cs)
    if not seat_time: continue
    rows.append((f.split('/')[-1][:17],len(calls),round(dur/60),round(100*idle/seat_time),round(max(longest)/60,1),round(100*waits/tot)))
print('room seats min idle% longest_idle_run_min wait_call%')
for r in rows[-45:]: print(*r)
print('n',len(rows),'median idle%',st.median(r[3] for r in rows),'mean',round(st.mean(r[3] for r in rows),1),'median longest run',st.median(r[4] for r in rows), 'rooms with a >=10min pure-idle run', sum(1 for r in rows if r[4]>=10))
