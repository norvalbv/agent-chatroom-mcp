import json,glob,os,re,statistics as st
import sys as _s; D=_s.argv[1] if len(_s.argv)>1 else "data"  # pass the checkout's data/ dir
RES=('claim/','verify/','hold/','inbox/','handoff/','help/','join-request/','draft/','attack/')
Q=re.compile(r'["“]([^"”]{12,})["”]')
norm=lambda s:re.sub(r'\s+',' ',s.lower())
fire=0;rooms=0;lens=[];tot=un=0
for f in sorted(glob.glob(D+"/swarm-*-room.jsonl")):
    ents={};said=[];done=False
    for l in open(f):
        try:o=json.loads(l)
        except:continue
        t=o.get('type')
        if t=='proposal': done=True;break
        if t=='board':
            k=o['key'];e=o.get('entry')
            if not e or not e.get('text'): ents.pop(k,None); continue
            if not k.startswith(RES) and not k.endswith(('.ack','.partial')):
                ents[k]=(e['by'],e['text']); 
        elif t=='message':
            m=o['msg']
            if m.get('kind') not in('system','board') and m['from'].get('agent')!='hub': said.append((m['from']['name'],m['content']))
    if not done: continue
    rooms+=1
    allsaid=said+[(b,tx) for b,tx in ents.values()]
    u=[]
    for k,(by,tx) in ents.items():
        if len(tx)<200: continue
        tot+=1; n=norm(tx)
        if not any(b!=by and (k in c or any(norm(q) in n for q in Q.findall(c))) for b,c in allsaid): u.append(k)
    un+=len(u)
    if u: fire+=1; lens.append(len(u))
print("rooms with a proposal",rooms,"| the refuse-once would have fired in",fire,f"({fire/rooms:.0%})","| median list length when it fires",st.median(lens),"max",max(lens))
print("findings >=200 chars at first proposal:",tot,"unexamined by any other seat:",un,f"({un/tot:.0%})")
