import json,glob,os,collections,sys
base=os.path.expanduser('~/.claude/projects/')
pat=sys.argv[1]
tot=collections.Counter(); calls=collections.Counter(); per=[]
resp=collections.Counter()  # tool_result size by tool
for d in sorted(glob.glob(base+'*'+pat+'*')):
  seat=d.split('-')[-1]
  for f in glob.glob(d+'/*.jsonl'):
    msgs={}; order=[]; id2tool={}
    for line in open(f):
      try: e=json.loads(line)
      except: continue
      if e.get('type')=='assistant':
        m=e['message']; mid=m.get('id')
        if mid not in msgs: msgs[mid]={'u':m.get('usage',{}),'tools':[]}; order.append(mid)
        for b in m.get('content',[]):
          if b.get('type')=='tool_use':
            msgs[mid]['tools'].append(b['name'].replace('mcp__chatroom__','')); id2tool[b['id']]=b['name'].replace('mcp__chatroom__','')
      elif e.get('type')=='user':
        c=e.get('message',{}).get('content')
        if isinstance(c,list):
          for b in c:
            if b.get('type')=='tool_result':
              s=len(json.dumps(b.get('content')))
              resp[id2tool.get(b.get('tool_use_id'),'?')]+=s
    if len(order)<10: continue
    st=0
    for mid in order:
      u=msgs[mid]['u']; c=u.get('cache_read_input_tokens',0)+u.get('cache_creation_input_tokens',0)+u.get('input_tokens',0)
      k=msgs[mid]['tools'][0] if msgs[mid]['tools'] else 'final-text'
      tot[k]+=c; calls[k]+=1; st+=c
    per.append((seat,len(order),st))
T=sum(tot.values()); R=sum(resp.values())
print('seat sessions',len(per),'API calls',sum(calls.values()),'input tokens',T)
for k,v in tot.most_common(22): print(f'{k:20s} calls={calls[k]:5d} in={v/1e6:7.2f}M {100*v/T:5.1f}%  result_chars={resp[k]/1e3:8.0f}k {100*resp[k]/R:5.1f}%')
for p in sorted(per,key=lambda x:-x[2]): print(p)
