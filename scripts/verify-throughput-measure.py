import json,sys,glob,collections,statistics as st,os
from datetime import datetime
def T(s): return datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
rows=[]
for f in sorted(glob.glob(sys.argv[1]+'/*.jsonl')):
    rv=False; props={}; verifs=[]; concl=None; names={}; roles={}; created=None; last=None
    for l in open(f):
        try:d=json.loads(l)
        except: continue
        t=d.get('type')
        if t=='room': rv=d['opts'].get('requireVerification'); 
        if t=='join': names[d['p']['id']]=d['p']['name']; roles[d['p']['name']]=d['p'].get('role'); created=created or d['p']['joinedAt']
        if t=='proposal':
            p=d['proposal']; props[p['id']]={'by':p['by']['name'],'ts':p.get('ts') or p.get('createdAt')}
            if not props[p['id']]['ts']: props[p['id']]['keys']=list(p.keys())
        if t=='board' and d.get('key','').startswith('verify/'):
            e=d.get('entry') or {}
            verifs.append((d['key'],e.get('by'),e.get('updatedAt'),e.get('text','')))
        if t=='state' and d.get('state')=='concluded': concl=d
    if not rv: continue
    rows.append((os.path.basename(f),props,verifs,concl,roles,created))
print('RV rooms',len(rows))
nprop=sum(1 for r in rows if r[1]); nconc=sum(1 for r in rows if r[3])
print('with proposal',nprop,'concluded',nconc)
heads=collections.Counter(); who=collections.Counter(); waits=[]; nver=[]; firstvalid=[]
for name,props,verifs,concl,roles,created in rows:
    if not props: continue
    nver.append(len(verifs))
    for k,by,ts,text in verifs:
        if k.endswith('.partial'): heads['partial']+=1; continue
        first=text.split('\n',1)[0]
        try:
            h=json.loads(first); 
            if not isinstance(h,dict): raise ValueError
            kind='json'
            if 'base_exit_code' in h: kind='json+f2p' if h.get('base_exit_code') not in (0,None) else ('json+refactor' if h.get('refactor') else 'json+base0')
            if h.get('exit_code')!=0: kind+=':exit!=0'
            if h.get('proposal') not in props: kind+=':noprop'
        except Exception: kind='prose'
        heads[kind]+=1
        who['verifier' if (by=='verifier' or roles.get(by)=='verifier') else 'peer']+=1
    for pid,p in props.items():
        if not p.get('ts'): heads['propnots']+=1; continue
        named=[v for v in verifs if pid in v[3].split('\n',1)[0] and v[2]]
        after=sorted(T(v[2])-T(p['ts']) for v in named)
        if after: waits.append((after[0],after[-1],len(named),name,pid))
def q(a): 
    a=sorted(a); return [round(a[int(len(a)*x)]/60,1) for x in (0.1,0.5,0.9)] if a else None
print('verify entry heads',heads); print('by',who)
print('verify entries per room w/ proposal: median',st.median(nver),'max',max(nver),'zero',sum(1 for x in nver if x==0))
print('proposals with a named verify',len(waits))
print('first named verify minus proposal (min) p10/50/90',q([w[0] for w in waits]))
print('last named verify minus proposal (min)',q([w[1] for w in waits]))
print('named verifies per proposal',collections.Counter(min(w[2],8) for w in waits))
neg=[w for w in waits if w[0]<0]; print('first verify BEFORE proposal:',len(neg))
