import json,glob,collections,sys,statistics as st
from datetime import datetime
def T(s): return datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
byrole=collections.defaultdict(lambda:[0,0]); runs=[]
for f in sorted(glob.glob(sys.argv[1]+'/swarm-*-room.jsonl')):
    calls=collections.defaultdict(list); names={}; ev=[]
    for l in open(f):
        try:d=json.loads(l)
        except:continue
        ty=d.get('type')
        if ty=='call_completion' and d.get('participant') and d.get('ts'):
            calls[d['participant']].append((T(d['ts']),d['tool'],d['outcome']))
        elif ty=='join':
            p=d.get('p') or d.get('participant') or {}
            if isinstance(p,dict): names[p.get('id')]=(p.get('name'),p.get('role'))
        if ty in('proposal','board','vote','challenge') and d.get('ts'): ev.append((T(d['ts']),ty,d.get('key')))
    for p,cs in calls.items():
        if len(cs)<5: continue
        nm,role=names.get(p,(p,'?'))
        role='verifier' if (role=='verifier' or 'verif' in str(nm)) else ('recruit' if role=='recruit' or 'recruit' in str(nm) else 'worker')
        byrole[role][1]+=cs[-1][0]-cs[0][0]
        start=None
        for (a,ta,_),(b,tb,_) in zip(cs,cs[1:]):
            if tb=='wait_for_messages' and ta=='wait_for_messages' and 50<=b-a<=60:
                byrole[role][0]+=b-a
                if start is None: start=a
                end=b
            else:
                if start is not None and end-start>=300: runs.append((round((end-start)/60,1),f.split('/')[-1][:17],nm,role))
                start=None
        if start is not None and end-start>=300: runs.append((round((end-start)/60,1),f.split('/')[-1][:17],nm,role,'TAIL'))
for r,(i,t) in byrole.items(): print(r,'idle%',round(100*i/t,1),'seat-hours',round(t/3600,1),'idle-hours',round(i/3600,1))
runs.sort(reverse=True); print(len(runs),'runs >=5min; by role',collections.Counter(r[3] for r in runs),'tail',sum(1 for r in runs if len(r)>4))
for r in runs[:25]: print(r)
