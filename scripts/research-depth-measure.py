"""Seed 4 measured (swarm-000525-jcz8): how fast rooms propose and conclude, and what research rooms cite.
Reads room logs (data/swarm-*.jsonl). Run: python3 scripts/research-depth-measure.py [data dir]"""
import json,sys,glob,os,re,statistics as st
import sys as _s; M=_s.argv[1] if len(_s.argv)>1 else "data"
rows=[]
for f in sorted(glob.glob(M+"/swarm-*.jsonl")):
    t0=None;first_prop=None;concl=None;topic="";joins=0;board_before=0;chat_before=0;recruit=0;msgs=0;agents=set();verify_before=0;evidence_chars=0;calls={}
    for l in open(f):
        try:d=json.loads(l)
        except: continue
        ty=d.get("type")
        if ty=="room": topic=d["opts"].get("topic","")
        elif ty=="join":
            joins+=1
            if d["p"].get("agent")!="human": agents.add(d["p"]["name"])
            t0=t0 or d["p"]["joinedAt"]
        elif ty=="message":
            m=d["msg"]; 
            if m["kind"]=="proposal" and not first_prop: first_prop=m["ts"]
            if m["kind"]=="conclusion": concl=m["ts"]
            if m["kind"]=="chat" and m["from"]["id"]!="system" and not first_prop: chat_before+=1
        elif ty=="board" and not first_prop:
            k=d["key"]
            if k.startswith("claim/") or k.startswith("draft/"): pass
            else: board_before+=1; evidence_chars+=len((d.get("entry") or {}).get("text") or "")
        elif ty=="call_completion":
            calls[d["tool"]]=calls.get(d["tool"],0)+1
            if d["tool"]=="request_agent" and d.get("outcome")=="success": recruit+=1
    if not t0: continue
    from datetime import datetime as D
    p=lambda s:D.fromisoformat(s.replace("Z","+00:00"))
    rows.append(dict(room=os.path.basename(f)[:-6],n=len(agents),research=bool(re.search(r"research|investigat|brainstorm|find out|survey|red-team",topic,re.I)),
      build=bool(re.search(r"\bbuild|implement|fix\b",topic,re.I)),
      ttp=(p(first_prop)-p(t0)).total_seconds()/60 if first_prop else None, ttc=(p(concl)-p(t0)).total_seconds()/60 if concl else None,
      board_before=board_before,evchars=evidence_chars,chat_before=chat_before,recruit=recruit,ra_calls=calls.get("request_agent",0),topic=topic[:70].replace("\n"," ")))
json.dump(rows,open("/tmp/research-depth-rows.json","w"))
def q(xs):
    xs=sorted(x for x in xs if x is not None)
    return "n=%d med=%.1f p25=%.1f p75=%.1f min=%.1f max=%.1f"%(len(xs),st.median(xs),xs[len(xs)//4],xs[3*len(xs)//4],xs[0],xs[-1]) if xs else "n=0"
print("rooms",len(rows),"with proposal",sum(r['ttp'] is not None for r in rows),"concluded",sum(r['ttc'] is not None for r in rows))
for name,sel in [("all",rows),("research",[r for r in rows if r['research']]),("research-not-build",[r for r in rows if r['research'] and not r['build']]),("build",[r for r in rows if r['build']])]:
    print("==",name,len(sel));print(" min to first proposal:",q([r['ttp'] for r in sel]));print(" min to conclusion:",q([r['ttc'] for r in sel]))
    print(" evidence board entries before 1st proposal:",q([r['board_before'] for r in sel if r['ttp'] is not None]))
    pr=[r for r in sel if r['ttp'] is not None]
    print(" proposed with 0 non-claim board entries: %d/%d"%(sum(r['board_before']==0 for r in pr),len(pr)), " proposed <3min: %d  <5min: %d"%(sum(r['ttp']<3 for r in pr),sum(r['ttp']<5 for r in pr)))
    print(" rooms with >=1 successful recruit: %d/%d ; any request_agent call: %d"%(sum(r['recruit']>0 for r in sel),len(sel),sum(r['ra_calls']>0 for r in sel)))
import re
rows=json.load(open("/tmp/research-depth-rows.json"))
U=re.compile(r"https?://[^\s)\]\"'>,]+|arXiv:\d{4}\.\d{4,5}|10\.\d{4,}/\S+")
tot=[]
for r in rows:
    if not(r['research'] and not r['build']): continue
    topic="";new=set();board=set();concl=""
    for l in open(f"{M}/{r['room']}.jsonl"):
        d=json.loads(l);ty=d.get("type")
        if ty=="room": topic=d["opts"].get("topic","")
        elif ty=="board": board|=set(U.findall((d.get("entry")or{}).get("text")or""))
        elif ty=="message" and d["msg"]["kind"]=="chat": board|=set(U.findall(d["msg"]["content"]))
        elif ty=="state" and d.get("conclusion"): concl=d["conclusion"]["text"]
    tu=set(U.findall(topic)); dom=lambda s:{re.sub(r"https?://([^/]+).*",r"\1",u) for u in s}
    newb=dom(board)-dom(tu); newc=dom(set(U.findall(concl)))-dom(tu)
    tot.append((r['room'],r['n'],round(r['ttp'],1) if r['ttp'] else None,round(r['ttc'],1) if r['ttc'] else None,len(newb),len(newc),len(concl),r['topic'][:50]))
for t in tot: print(t)
c=[t for t in tot if t[3]]
print("concluded",len(c),"with 0 new source domains anywhere in room:",sum(t[4]==0 for t in c),"0 in conclusion:",sum(t[5]==0 for t in c))
