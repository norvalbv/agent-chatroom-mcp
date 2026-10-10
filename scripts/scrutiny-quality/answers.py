import json,glob,os,difflib,statistics as st,collections
from datetime import datetime
def T(s): return datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
import sys as _s; D=_s.argv[1] if len(_s.argv)>1 else "data"  # pass the checkout's data/ dir
res=[];ex=[]
for f in sorted(glob.glob(D+"/swarm-*-room.jsonl")):
    text={};state={};  # proposal text, challenge status
    for l in open(f):
        try:o=json.loads(l)
        except:continue
        t=o.get('type')
        if t=='proposal':
            p=o['proposal']; text.setdefault(p['id'],p['text'])
        elif t=='challenge':
            c=o['challenge']; state[c['id']]=('open',c,T(c['ts']))
        elif t=='amend' and o.get('updatedAt'):
            pid=o['proposalId']; old=text.get(pid,''); new=o['text']
            for cc in o.get('challenges',[]):
                s=state.get(cc['id'])
                if s and s[0]=='open' and cc['status']=='answered':
                    sm=difflib.SequenceMatcher(None,old,new,autojunk=False)
                    added=sum(j2-j1 for tag,i1,i2,j1,j2 in sm.get_opcodes() if tag in('insert','replace'))
                    removed=sum(i2-i1 for tag,i1,i2,j1,j2 in sm.get_opcodes() if tag in('delete','replace'))
                    d=dict(room=os.path.basename(f)[6:17],added=added,removed=removed,secs=T(o['updatedAt'])-s[2],plen=len(old),obj=s[1]['objection'][:230],cite=(s[1].get('cites') or '')[:90])
                    res.append(d); state[cc['id']]=('answered',)
            text[pid]=new
def med(x): return round(st.median(x),1)
print("answered-by-amend",len(res))
print("median chars added",med([r['added'] for r in res]),"removed",med([r['removed'] for r in res]),"proposal len",med([r['plen'] for r in res]),"secs",med([r['secs'] for r in res]))
print("net-deletion answers (added<removed):",sum(1 for r in res if r['added']<r['removed']))
print("pure deletion (added<20):",sum(1 for r in res if r['added']<20))
print("answered <=60s:",sum(1 for r in res if r['secs']<=60),"<=120s",sum(1 for r in res if r['secs']<=120),"<=300",sum(1 for r in res if r['secs']<=300))
print("edit <=200 chars added:",sum(1 for r in res if r['added']<=200),"<=400:",sum(1 for r in res if r['added']<=400))
import random; random.seed(4)
for r in random.sample(res,14): print(f"\n[{r['room']}] +{r['added']} -{r['removed']} in {r['secs']:.0f}s\n  OBJ: {r['obj']}")
json.dump(res,open(os.devnull,'w'))
