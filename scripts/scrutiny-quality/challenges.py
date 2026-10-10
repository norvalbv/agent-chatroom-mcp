import json,sys,glob,os,re,statistics as st
from datetime import datetime
def T(s): return datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
import sys as _s; D=_s.argv[1] if len(_s.argv)>1 else "data"  # pass the checkout's data/ dir
rows=[]
for f in sorted(glob.glob(D+"/swarm-*-room.jsonl")):
    props={};chs=[];votes=[];amends=[];concl=None;joins=0;created=None;msgs=0;firstmsg=None;names={}
    for l in open(f):
        try:o=json.loads(l)
        except:continue
        t=o.get('type')
        if t=='room': created=o.get('createdAt')
        elif t=='join':
            joins+=1; names[o['p']['id']]=o['p'].get('role')
        elif t=='message':
            m=o['msg']
            if firstmsg is None: firstmsg=m['ts']
            if m.get('kind')!='system': msgs+=1
        elif t=='proposal':
            p=o['proposal']; props.setdefault(p['id'],p)
        elif t=='challenge': chs.append((o['proposalId'],o['challenge']))
        elif t=='vote': votes.append((o['proposalId'],o['pid'],o['entry']))
        elif t=='amend' and o.get('updatedAt'): amends.append(o)
        elif t=='state' and o.get('state')=='concluded': concl=o['conclusion']
    if not props: continue
    start=T(created) if created else (T(firstmsg) if firstmsg else None)
    first=min(props.values(),key=lambda p:p['createdAt'])
    tp=T(first['createdAt'])
    r=dict(room=os.path.basename(f)[:-6],seats=joins,props=len(props),ch=len(chs),amends=len(amends),
           agree=sum(1 for v in votes if v[2]['vote']=='agree'),dis=sum(1 for v in votes if v[2]['vote']=='disagree'),
           concluded=bool(concl),t_to_prop=(tp-start)/60 if start else None)
    if concl: r['prop_to_concl']=(T(concl['decidedAt'])-tp)/60; r['unres']=len(concl.get('unresolved_objections',[]))
    # challenge detail
    cd=[]
    for pid,c in chs:
        tc=T(c['ts']); who=c['by']['id']
        # challenger's next vote
        nv=[ (T(e['ts'])-tc,e['vote']) for (pp,w,e) in votes if w==who and pp==pid and T(e['ts'])>=tc]
        nv.sort()
        # next amend after the challenge
        na=[T(a['updatedAt'])-tc for a in amends if a['proposalId']==pid and T(a['updatedAt'])>=tc]
        # final status
        status=None
        for a in amends:
            for cc in a.get('challenges',[]):
                if cc['id']==c['id']: status=cc['status']
        cd.append(dict(delay=(tc-T(props[pid]['createdAt']))/60, to_own_vote=nv[0] if nv else None, to_amend=min(na)/60 if na else None,
                       status=status,cmd=bool(c.get('command')),blocking=c.get('blocking'),len=len(c['objection']),role=names.get(who),cites=bool(c.get('cites'))))
    r['cd']=cd
    # first challenge order
    r['first_ch_delay']=min([c['delay'] for c in cd]) if cd else None
    rows.append(r)
json.dump(rows,open(os.devnull,'w'))
n=len(rows); con=[r for r in rows if r['concluded']]
print("rooms with a proposal",n,"concluded",len(con))
def med(x): 
    x=[v for v in x if v is not None]; return (round(st.median(x),1),len(x)) if x else None
print("median min start->first proposal",med([r['t_to_prop'] for r in rows]))
print("median min first proposal->conclusion",med([r.get('prop_to_concl') for r in con]))
import collections
print("challenges per concluded room",sorted(collections.Counter(r['ch'] for r in con).items()))
print("amends per concluded room",sorted(collections.Counter(min(r['amends'],6) for r in con).items()))
print("concluded rooms with any disagree",sum(1 for r in con if r['dis']),"/",len(con))
print("concluded rooms: 0 amends",sum(1 for r in con if r['amends']==0))
allc=[c for r in rows for c in r['cd']]
print("challenges total",len(allc),"with command",sum(c['cmd'] for c in allc),"nonblocking",sum(1 for c in allc if c['blocking'] is False))
print("first-challenge delay after proposal (min) median",med([r['first_ch_delay'] for r in rows]))
fast=[c for c in allc if c['to_own_vote'] and c['to_own_vote'][1]=='agree']
print("challenger later agreed:",len(fast),"median s",med([c['to_own_vote'][0] for c in fast]))
for th in (30,60,120,300): print("  challenger agreed within",th,"s:",sum(1 for c in fast if c['to_own_vote'][0]<=th))
print("challenger agreed with NO amend between:",sum(1 for c in fast if c['to_amend'] is None or c['to_amend']*60>c['to_own_vote'][0]))
print("challenges followed by any amend:",sum(1 for c in allc if c['to_amend'] is not None),"median min",med([c['to_amend'] for c in allc]))
print("by role",collections.Counter(c['role'] for c in allc))
print("status",collections.Counter(c['status'] for c in allc))
print("unresolved at conclusion",collections.Counter(r.get('unres') for r in con))
