import sys
sys.setrecursionlimit(100000)
lines=[l.strip() for l in open(sys.argv[1]) if l.strip() and not l.strip().startswith('#')]
layers={};order=[];cur=None;rules=[];show=[]
for n,l in enumerate(lines):
    t=l.split()
    if t[0]=='LAYER':
        if t[1] not in layers: layers[t[1]]=(int(t[2]),len(order));order.append(t[1])
        cur=t[1]
    elif t[0]=='SHOW': show+=t[1:]
    elif t[0]=='SEAL': rules.append(('SEAL',t[1],cur,n,None,None))
    else:
        # parse expression(s)
        ARITY={'+':2,'-':2,'*':2,'/':2,'%':2,'<':2,'=':2,'AND':2,'OR':2,'MIN':2,'MAX':2,'NOT':1,'ABS':1,'IF':3}
        def parse(i):
            k=t[i]
            if k.startswith('$'): return ('ref',k[1:]),i+1
            if k.lstrip('-').isdigit(): return ('num',int(k)),i+1
            args=[];i+=1
            for _ in range(ARITY[k]):
                a,i=parse(i);args.append(a)
            return (k,args),i
        i=2;e=None;g=None
        if t[0]=='SET': e,i=parse(i)
        if i<len(t) and t[i]=='WHEN': g,i=parse(i+1)
        rules.append((t[0],t[1],cur,n,e,g))
def strength(l): return layers[l]
memo={}
top=min(layers,key=strength)
def ev(e,M):
    k=e[0]
    if k=='num': return e[1]
    if k=='ref': return val(e[1],M)
    a=[ev(x,M) for x in e[1]]
    if k=='+':return a[0]+a[1]
    if k=='-':return a[0]-a[1]
    if k=='*':return a[0]*a[1]
    if k=='/':return a[0]//a[1] if a[1] else 0
    if k=='%':return a[0]%a[1] if a[1] else 0
    if k=='<':return int(a[0]<a[1])
    if k=='=':return int(a[0]==a[1])
    if k=='AND':return int(a[0]!=0 and a[1]!=0)
    if k=='OR':return int(a[0]!=0 or a[1]!=0)
    if k=='NOT':return int(a[0]==0)
    if k=='MIN':return min(a)
    if k=='MAX':return max(a)
    if k=='ABS':return abs(a[0])
    if k=='IF':return a[1] if a[0]!=0 else a[2]
def val(k,L):
    if (k,L) in memo:return memo[(k,L)]
    inview=lambda l: strength(l)>=strength(L)
    seals=[r[2] for r in rules if r[0]=='SEAL' and r[1]==k and inview(r[2])]
    sl=min(seals,key=strength) if seals else None
    cands=[r for r in rules if r[0]!='SEAL' and r[1]==k and inview(r[2]) and (r[5] is None or ev(r[5],r[2])!=0)]
    if sl is not None: cands=[r for r in cands if strength(r[2])<=strength(sl)]
    if not cands: memo[(k,L)]=0;return 0
    best=min(cands,key=lambda r:(strength(r[2]),-r[3]))
    v=0 if best[0]=='UNSET' else ev(best[4],best[2]);memo[(k,L)]=v;return v
print(' '.join(str(val(k,top)) for k in show))
