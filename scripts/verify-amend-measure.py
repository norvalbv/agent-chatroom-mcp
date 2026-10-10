import json,sys,glob,collections,statistics as st,os,re
from datetime import datetime
def T(s): return datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
tot=collections.Counter(); rewait=[]; pend=collections.Counter(); roomsaff=set(); lastamend_to_accept=[]
for f in sorted(glob.glob(sys.argv[1]+'/*.jsonl')):
    rv=False; ev=[]
    for l in open(f):
        try:d=json.loads(l)
        except: continue
        if d.get('type')=='room': rv=d['opts'].get('requireVerification')
        ev.append(d)
    if not rv: continue
    texts=collections.defaultdict(list) # pid -> [(ts,text)]
    ver=[]
    for d in ev:
        t=d['type']
        if t=='proposal': p=d['proposal']; texts[p['id']].append((T(p['ts']) if p.get('ts') else None,p['text']))
        if t=='amend' and d.get('updatedAt'): texts[d['proposalId']].append((T(d['updatedAt']),d['text']))
        if t=='board' and d['key'].startswith('verify/') and d.get('entry'):
            e=d['entry']
            try: h=json.loads(e.get('text','').split('\n',1)[0]); h=h if isinstance(h,dict) else None
            except Exception: h=None
            if h and e.get('updatedAt'): ver.append((T(e['updatedAt']),e.get('by'),h,d['key']))
    finaltext={pid:v[-1][1] for pid,v in texts.items()}
    alltext=' '.join(finaltext.values())
    for (ts,by,h,key) in ver:
        c=str(h.get('commit') or ''); m=re.search(r'[0-9a-f]{7,40}',c); c7=m.group(0)[:7] if m else None
        pid=h.get('proposal')
        if pid in texts and h.get('exit_code')==0:
            tot['valid named']+=1
            later=[a for a in texts[pid] if a[0] and a[0]>ts]
            if later:
                tot['voided by amend']+=1; roomsaff.add(f)
                if c7 and all(c7 in a[1] for a in later): tot['voided, commit still cited in every later text']+=1
                elif c7 and c7 in later[-1][1]: tot['voided, commit cited in final text']+=1
                elif not c7: tot['voided, no commit in head']+=1
                else: tot['voided, commit not cited']+=1
                # was it rewritten after?
                again=[v for v in ver if v[3]==key and v[0]>later[0][0]]
                if again: tot['voided then rewritten']+=1; rewait.append(again[0][0]-later[0][0])
        elif pid not in texts and h.get('exit_code')==0:
            tot['unnamed/pending exit0']+=1
            if c7 and c7 in alltext: tot['pending, commit cited in a final proposal text']+=1
print(tot); print('rooms affected',len(roomsaff))
rewait.sort(); print('amend->rewrite min p50/p90',round(rewait[len(rewait)//2]/60,1),round(rewait[int(len(rewait)*.9)]/60,1),'n',len(rewait))
