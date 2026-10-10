import json,glob,collections,sys
from datetime import datetime
def T(s): return datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
phase=collections.Counter(); avail=collections.Counter(); detail=[]
for f in sorted(glob.glob(sys.argv[1]+'/swarm-*-room.jsonl')):
    calls=collections.defaultdict(list); names={}; props=[]; concl=None; board=[]; last=None; leaves=[]
    for l in open(f):
        try:d=json.loads(l)
        except:continue
        ty=d.get('type')
        if d.get('ts'): last=T(d['ts'])
        if ty=='call_completion' and d.get('participant') and d.get('ts'):
            calls[d['participant']].append((T(d['ts']),d['tool'],d['outcome']))
        elif ty=='join': names[d['p']['id']]=d['p']['name']
        elif ty=='proposal': props.append(last)
        elif ty=='state' and d.get('state')=='concluded': concl=last
        elif ty=='board': board.append((T(d['entry']['updatedAt']) if d.get('entry') and d['entry'].get('updatedAt') else last, d['key'], (d.get('entry') or {}).get('by'), len((d.get('entry') or {}).get('text') or '')))
    for p,cs in calls.items():
        nm=names.get(p,p); start=None
        def close(s,e):
            if e-s<300: return
            mid=(s+e)/2; m=(e-s)/60
            ph='post-conclusion' if concl and mid>concl else ('proposal-open' if props and mid>props[0] else 'pre-proposal')
            phase[ph]+=m
            st={}
            for t,k,by,n in board:
                if t<=s: st[k]=(by,n)
            claims=[k for k,(by,n) in st.items() if k.startswith('claim/') and n and by!=nm]
            ver=[k for k,(by,n) in st.items() if k.startswith('verify/') and n]
            own=[k for k,(by,n) in st.items() if k.startswith('claim/') and n and by==nm]
            help_=[k for k,(by,n) in st.items() if k.startswith(('help/','join-request/')) and n]
            un=max(0,len(claims)-len(ver))
            avail['idle-min with unverified others\' claims' if un else 'idle-min, nothing unverified']+=m
            if help_: avail['idle-min with open help/ entry']+=m
            if not own: avail['idle-min by a seat owning no claim']+=m
            detail.append((round(m,1),f.split('/')[-1][:17],nm,ph,'claims_other',len(claims),'verify',len(ver),'own',len(own)))
        for (a,ta,_),(b,tb,_) in zip(cs,cs[1:]):
            if tb=='wait_for_messages' and ta=='wait_for_messages' and 50<=b-a<=60:
                if start is None: start=a
                end=b
            else:
                if start is not None: close(start,end)
                start=None
        if start is not None: close(start,end)
tot=sum(phase.values()); print('idle minutes in runs>=5min:',round(tot)); 
for k,v in phase.items(): print(' ',k,round(v),f'{100*v/tot:.0f}%')
for k,v in avail.items(): print(' ',k,round(v),f'{100*v/tot:.0f}%')
detail.sort(reverse=True)
for d in detail[:14]: print(d)
