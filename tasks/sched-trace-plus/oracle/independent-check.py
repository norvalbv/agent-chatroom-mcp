import sys
lines=[l.strip() for l in open(sys.argv[1]) if l.strip() and not l.strip().startswith('#')]
J={}; order=[]
for l in lines:
    i,a,b,p,f=l.split(); J[i]=dict(id=i,arr=int(a),rem=int(b),pr=int(p),B=(f=='B'),wait=0,sb=0,run=0,spent=0); order.append(i)
ready=[]; running=None; switch=False; sleeping=[]; last=None; device=0; done={}; t=0
while len(done)<len(order):
    joined=set()
    wk=[s for s in sleeping if s[0]==t]   # sleeping kept in sleep order
    sleeping=[s for s in sleeping if s[0]!=t]
    for _,i in wk:
        j=J[i]; j['pr']=max(0,j['pr']-1); j['wait']=0; j['spent']=0; ready.append(i); joined.add(i)
    for i in order:
        if J[i]['arr']==t: J[i]['wait']=0; J[i]['spent']=0; ready.append(i); joined.add(i)
    for i in ready:
        if i in joined: continue
        j=J[i]; j['wait']+=1
        if j['wait']==(4 if j['B'] else 5): j['pr']=max(0,j['pr']-1); j['wait']=0
    if running is not None and not switch:
        r=J[running]
        if any(J[k]['pr']<r['pr'] for k in ready) or (r['run']>=3 and any(J[k]['pr']<=r['pr'] for k in ready)):
            r['wait']=0; ready.append(running); running=None
    if running is None and ready:
        ready.sort(key=lambda i:(J[i]['pr'],J[i]['arr'],i))
        running=ready.pop(0); J[running]['wait']=0; J[running]['run']=0
        switch = last is not None and last!=running
    elif running is None:
        switch=False
    if running is not None:
        j=J[running]
        if switch:
            switch=False
        else:
            j['rem']-=1; j['sb']+=1; j['run']+=1; j['spent']+=1; last=running
            if j['spent']==6: j['pr']=min(5,j['pr']+1); j['spent']=0
            if j['rem']==0: done[running]=t+1; running=None
            elif j['B'] and j['sb']==2:
                j['sb']=0; s=max(t+1,device); device=s+3; sleeping.append((s+3,running)); running=None
    else:
        last=None
    t+=1
print(' '.join(f"{i}:{done[i]}" for i in order))
