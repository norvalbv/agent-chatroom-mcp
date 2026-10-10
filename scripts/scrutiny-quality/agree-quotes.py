import json,glob,os,statistics as st,collections
from datetime import datetime
def T(s): return datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
import sys as _s; D=_s.argv[1] if len(_s.argv)>1 else "data"  # pass the checkout's data/ dir
pos=[];dup=0;tot=0;rooms=0;cov=[];firstpara=0;latency=[];per_room_distinct=[]
quoted_cited=0
for f in sorted(glob.glob(D+"/swarm-*-room.jsonl")):
    text={};final={};lastchange={};concl=None;chcites=collections.defaultdict(list)
    for l in open(f):
        try:o=json.loads(l)
        except:continue
        t=o.get('type')
        if t=='proposal':
            p=o['proposal']
            if p['id'] not in text: text[p['id']]=p['text']; lastchange[p['id']]=T(p['createdAt'])
        elif t=='amend' and o.get('updatedAt'): text[o['proposalId']]=o['text']; lastchange[o['proposalId']]=T(o['updatedAt'])
        elif t=='challenge': chcites[o['proposalId']].append(o['challenge'].get('cites') or '')
        elif t=='vote':
            e=o['entry']
            if e['vote']=='agree' and e.get('quote') and e.get('reason')!='proposer':
                final.setdefault(o['proposalId'],{})[o['pid']]=(e['quote'],text.get(o['proposalId'],''),T(e['ts'])-lastchange.get(o['proposalId'],T(e['ts'])))
        elif t=='state' and o.get('state')=='concluded': concl=o['conclusion']
    if not concl: continue
    pid=concl['proposalId']; v=final.get(pid,{})
    if len(v)<2: continue
    rooms+=1; qs=[]
    for q,tx,lat in v.values():
        i=tx.find(q); tot+=1
        if i>=0 and tx: pos.append(i/len(tx)); firstpara+= i<300
        qs.append(q.strip().lower()[:60]); latency.append(lat)
        if any(c and (c in q or q in c) for c in chcites[pid]): quoted_cited+=1
    c=collections.Counter(qs); dup+=sum(n for n in c.values() if n>1)
    per_room_distinct.append(len(c)/len(qs))
    L=len(text[pid]); covered=sum(len(q) for q in set(q for q,_,_ in v.values()))
    cov.append(covered/L if L else 0)
print("concluded rooms w/ >=2 non-proposer agree quotes",rooms,"quotes",tot)
print("quotes sharing first 60 chars with another voter's quote:",dup,f"({dup/tot:.0%})")
print("median distinct-quote ratio per room",round(st.median(per_room_distinct),2))
print("quote starts in first 300 chars of proposal:",firstpara,f"({firstpara/len(pos):.0%})","median rel position",round(st.median(pos),2))
qs=sorted(pos); print("position quartiles",[round(qs[int(len(qs)*k)],2) for k in(.25,.5,.75)])
print("median share of final proposal text covered by all agree quotes together",f"{st.median(cov):.1%}")
print("agree latency after last text change: median s",round(st.median(latency)),"<=30s",sum(1 for x in latency if x<=30),"<=60s",sum(1 for x in latency if x<=60),"of",len(latency))
print("quotes overlapping a challenged clause",quoted_cited)
