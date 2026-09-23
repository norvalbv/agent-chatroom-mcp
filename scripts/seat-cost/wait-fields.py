import json,glob,os,collections,sys
base=os.path.expanduser('~/.claude/projects/')
pat=sys.argv[1]
field=collections.Counter(); sizes=[]; n=0
for d in sorted(glob.glob(base+'*'+pat+'*')):
  for f in glob.glob(d+'/*.jsonl'):
    id2tool={}
    lines=open(f).read().splitlines()
    if len(lines)<30: continue
    for line in lines:
      try: e=json.loads(line)
      except: continue
      if e.get('type')=='assistant':
        for b in e['message'].get('content',[]):
          if b.get('type')=='tool_use': id2tool[b['id']]=b['name']
      elif e.get('type')=='user':
        c=e.get('message',{}).get('content')
        if not isinstance(c,list): continue
        for b in c:
          if b.get('type')!='tool_result' or not id2tool.get(b.get('tool_use_id'),'').endswith('wait_for_messages'): continue
          cc=b.get('content'); txt=cc if isinstance(cc,str) else ''.join(x.get('text','') for x in cc if isinstance(x,dict))
          sizes.append(len(txt)); n+=1
          try: j=json.loads(txt)
          except: field['<unparsed>']+=len(txt); continue
          for k,v in j.items(): field[k]+=len(json.dumps(v))
sizes.sort(); T=sum(field.values())
print('waits',n,'median',sizes[len(sizes)//2],'p90',sizes[int(.9*len(sizes))],'max',sizes[-1])
for k,v in field.most_common(25): print(f'{k:24s}{v/1e3:8.0f}k {100*v/T:5.1f}%')
