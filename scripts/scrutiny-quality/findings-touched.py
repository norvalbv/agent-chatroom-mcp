import json,glob,os,re,statistics as st,collections
from datetime import datetime
import sys as _s; D=_s.argv[1] if len(_s.argv)>1 else "data"  # pass the checkout's data/ dir
RES=('claim/','verify/','hold/','inbox/','handoff/','help/','join-request/','draft/')
tot=ref=0;per=[];bt=0;nch=0;cmdlike=0;prefix=collections.Counter()
for f in sorted(glob.glob(D+"/swarm-*-room.jsonl")):
    ents={};firstprop=None;msgs=[];boardtexts=[]
    for l in open(f):
        try:o=json.loads(l)
        except:continue
        t=o.get('type')
        if t=='proposal' and firstprop is None: firstprop=o['proposal']['createdAt']
        elif t=='board':
            k=o['key']; e=o.get('entry') or {}
            if e.get('text') and not k.startswith(RES) and not k.endswith('.ack'):
                if firstprop is None: ents.setdefault(k,(e['by'],e['updatedAt']))
            if e.get('text'): boardtexts.append((e.get('by'),e.get('updatedAt',''),k,e['text']))
        elif t=='message':
            m=o['msg']
            if m.get('kind')!='system' and not m['content'].startswith('[BOARD]'): msgs.append((m['from']['name'],m['ts'],m['content']))
        elif t=='challenge':
            c=o['challenge']
            if c['ts']>='2026-09-24':
                nch+=1
                snips=re.findall(r'`([^`]{6,})`',c['objection'])
                if snips: bt+=1
                if any(re.match(r'\s*(git|npm|npx|node|grep|rg|curl|python3?|PORT=|ls|cat|tsx|jq|diff|wc|test)\b',s) for s in snips) or re.search(r'\b(git (merge-base|show|log|diff|grep)|npm (test|run)|npx tsx|grep -|exit (code )?[0-9])',c['objection']): cmdlike+=1
    if firstprop is None or not ents: continue
    r=0
    for k,(by,ts) in ents.items():
        prefix[k.split('/')[0] if '/' in k else '(flat)']+=1
        hit=any(n!=by and ts<=mt<=firstprop and k in c for n,mt,c in msgs) or any(b!=by and ts<=bts<=firstprop and k in tx and kk!=k for b,bts,kk,tx in boardtexts)
        r+=hit
    tot+=len(ents); ref+=r; per.append(r/len(ents))
print("rooms",len(per),"pre-proposal non-reserved board entries",tot,"named by a non-author (chat or another board entry) before the first proposal:",ref,f"({ref/tot:.0%})")
print("median per-room share referenced",round(st.median(per),2),"rooms with zero referenced",sum(1 for p in per if p==0))
print("top prefixes",prefix.most_common(12))
print("challenges since 09-24:",nch,"with a backticked snippet:",bt,"naming a runnable command/check:",cmdlike)
