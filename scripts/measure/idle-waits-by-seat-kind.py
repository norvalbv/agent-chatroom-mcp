"""Pure-idle share of seat time by seat kind and by week, from room logs.
usage: python3 scripts/measure/idle-waits-by-seat-kind.py <data dir>
Pure idle = a wait_for_messages completing 50-60 s after the seat's previous wait_for_messages, no hub call between."""
import json,glob,collections,sys,re
from datetime import datetime
def T(s): return datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
def kind(name, agent, role):
    n=str(name).lower()
    if role=='verifier' or n.startswith('verifier'): return 'verifier'
    if 'opus-5-5' in n: return 'claude opus-5-5'
    if 'sonnet-5-5' in n: return 'claude sonnet-5-5'
    for k in ('opus','sonnet','haiku','fable'):
        if n.startswith(k) or n.startswith('claude-'+k): return 'claude '+k+' (earlier)'
    if agent=='codex' or re.match(r'^(\d-)?\d?-?(sol|terra|astra|gpt)',n) or 'codex' in n: return 'codex'
    if agent=='openrouter': return 'openrouter'
    return 'other '+str(agent)
bk=collections.defaultdict(lambda:[0.0,0.0,0]); bw=collections.defaultdict(lambda:[0.0,0.0]); bsize=collections.defaultdict(lambda:[0.0,0.0,0])
for f in sorted(glob.glob(sys.argv[1]+'/swarm-*-room.jsonl')):
    calls=collections.defaultdict(list); who={}
    for l in open(f):
        try:d=json.loads(l)
        except:continue
        if d.get('type')=='call_completion' and d.get('participant') and d.get('ts'): calls[d['participant']].append((T(d['ts']),d['tool']))
        elif d.get('type')=='join': p=d['p']; who[p['id']]=(p.get('name'),p.get('agent'),p.get('role'))
    seats=[cs for cs in calls.values() if len(cs)>=5]
    if not seats: continue
    t0=min(cs[0][0] for cs in seats)
    week=datetime.utcfromtimestamp(t0).strftime('%m-%d')
    size='2-4 seats' if len(seats)<=4 else '5-8 seats' if len(seats)<=8 else '9+ seats'
    for p,cs in calls.items():
        if len(cs)<5: continue
        span=cs[-1][0]-cs[0][0]; idle=sum(b-a for (a,ta),(b,tb) in zip(cs,cs[1:]) if ta==tb=='wait_for_messages' and 50<=b-a<=60)
        k=kind(*who.get(p,(p,'?',None)))
        bk[k][0]+=idle; bk[k][1]+=span; bk[k][2]+=1
        bw[week][0]+=idle; bw[week][1]+=span
        bsize[size][0]+=idle; bsize[size][1]+=span; bsize[size][2]+=1
print('BY SEAT KIND  idle%  seat-hours  seats')
for k,(i,s,n) in sorted(bk.items(),key=lambda x:-x[1][1]):
    if s>1800: print(f'  {k:28s} {100*i/s:5.1f}  {s/3600:6.1f}  {n}')
print('BY ROOM SIZE')
for k,(i,s,n) in sorted(bsize.items()): print(f'  {k:28s} {100*i/s:5.1f}  {s/3600:6.1f}  {n}')
print('BY DAY (room start)')
for k,(i,s) in sorted(bw.items()):
    if s>3600: print(f'  {k}  {100*i/s:5.1f}  {s/3600:6.1f}')
