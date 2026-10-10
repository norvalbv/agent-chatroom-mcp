# Agent messages recorded as replies to a human, split by how they addressed the human (src/hub.ts addressesHuman).
# python3 scripts/measure/human-mentions.py [checkout]  (reads <checkout>/data/*.jsonl and <checkout>/logs/*/data/*.jsonl)
import json,glob,re,sys,collections
root=sys.argv[1] if len(sys.argv)>1 else "."
files=sorted(set(glob.glob(root+"/data/*.jsonl")+glob.glob(root+"/logs/*/data/*.jsonl")))
GREET=r"(?:(?:hi|hello|hey|thanks|thank you|ok|okay|sure|yes|no|done|got it|good (?:morning|afternoon|evening))[ ,!.]+)?"
def names(name,text): return re.search(r"(?<!\w)"+re.escape(name)+r"(?!\w)",text,re.I) is not None
def addresses(name,text):
    n=re.escape(name)
    if re.search(r"(?<![\w-])@"+n+r"(?![\w-])",text,re.I): return True
    if re.match(r"\s*@[\w-]",text): return False  # a message to other seats
    pre=r"(?:^\s*(?:[A-Za-z]+[,!]?\s+){0,2}|[,;]\s+)"
    post=r"(?=\s*(?:[,:!?—–]|\.(?:\s|$)|\s-\s|$))"
    return re.search(pre+n+post,text,re.I) is not None
stats=collections.Counter(); ex=[]
refusals=collections.Counter()
for f in files:
    msgs={}
    for l in open(f,errors="ignore"):
        try:e=json.loads(l)
        except:continue
        if e.get("type")=="refusal":
            r=e.get("reason","")
            for k in ["addressed that to","already answered","match their register"]:
                if k in r: refusals[k]+=1
        if e.get("type")!="message":continue
        m=e["msg"]; msgs[m["id"]]=m
        if m.get("kind")!="chat" or m["from"].get("agent")=="human": continue
        rt=m.get("replyTo"); h=msgs.get(rt) if rt else None
        if not h or h["from"].get("agent")!="human": continue
        hn=h["from"]["name"]
        stats["agent replies recorded to a human"]+=1
        if names(hn,m["content"]) and not addresses(hn,m["content"]):
            stats["named in passing only"]+=1
            if len(ex)<200: ex.append((f.split('/')[-1],m["seq"],hn,m["content"][:150].replace("\n"," ")))
        elif addresses(hn,m["content"]): stats["addressed (@ or leading name)"]+=1
        else: stats["reply_to without name"]+=1
print(len(files),"logs"); print(dict(stats)); print("refusals",dict(refusals))
for x in ex: print(x)
