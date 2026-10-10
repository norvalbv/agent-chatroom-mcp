import json,sys,glob,collections,re,os
tok=lambda s:set(t for t in re.findall(r'\b[0-9a-f]{7,40}\b',s.lower()) if re.search(r'\d',t) and re.search(r'[a-f]',t))
same=lambda a,b:a.startswith(b) or b.startswith(a)
res=[]
for f in sorted(glob.glob(sys.argv[1]+'/*.jsonl')):
    rv=False; heads=[]; conc=None; pid=None
    for l in open(f):
        try:d=json.loads(l)
        except: continue
        t=d.get('type')
        if t=='room': rv=d['opts'].get('requireVerification')
        if t=='board' and d['key'].startswith('verify/') and d.get('entry'):
            try:
                h=json.loads(d['entry'].get('text','').split('\n',1)[0])
                if isinstance(h,dict) and h.get('exit_code')==0: heads.append(h)
            except Exception: pass
        if t=='state' and d.get('state')=='concluded': conc=d['conclusion']
    if not (rv and conc): continue
    text=conc.get('text',''); cited=tok(text)
    cov=set()
    for h in heads:
        for k in('commit','base_commit'):
            for c in tok(str(h.get(k) or '')): cov.add(c)
    unc=[c for c in cited if not any(same(c,x) for x in cov)]
    res.append((os.path.basename(f)[:28],len(cited),len(unc),unc[:6]))
print('concluded RV rooms',len(res),'citing >=1 commit',sum(1 for r in res if r[1]),'citing >=2',sum(1 for r in res if r[1]>=2))
print('with uncovered cited commits',sum(1 for r in res if r[2]),'total cited',sum(r[1] for r in res),'uncovered',sum(r[2] for r in res))
for r in res:
    if r[2]: print(r)
