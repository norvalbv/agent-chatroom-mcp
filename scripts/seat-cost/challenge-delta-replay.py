import json,glob,os,sys
base=os.path.expanduser('~/.claude/projects/')
direct=0; resent=0; allin=0
for d in sorted(glob.glob(base+'*'+sys.argv[1]+'*')):
  for f in glob.glob(d+'/*.jsonl'):
    lines=open(f).read().splitlines()
    if len(lines)<30: continue
    id2tool={}; seen={}; events=[]; mids=set()
    for line in lines:
      try: e=json.loads(line)
      except: continue
      if e.get('type')=='assistant':
        m=e['message']
        if m.get('id') not in mids:
          mids.add(m['id']); u=m.get('usage',{}); allin+=u.get('cache_read_input_tokens',0)+u.get('cache_creation_input_tokens',0)+u.get('input_tokens',0)
          events.append(('call',0))
        for b in m.get('content',[]):
          if b.get('type')=='tool_use': id2tool[b['id']]=b['name']
      elif e.get('type')=='user':
        c=e.get('message',{}).get('content')
        if not isinstance(c,list): continue
        for b in c:
          if b.get('type')!='tool_result' or not id2tool.get(b.get('tool_use_id'),'').endswith('wait_for_messages'): continue
          cc=b.get('content'); txt=cc if isinstance(cc,str) else ''.join(x.get('text','') for x in cc if isinstance(x,dict))
          try: op=json.loads(txt).get('open_proposal')
          except: continue
          if not isinstance(op,dict): continue
          s=0
          for ch in op.get('challenges',[]):
            n=len(json.dumps(ch.get('objection',''))); k=ch.get('id')
            if k and seen.get(k)==ch.get('status'): s+=n-60
            seen[k]=ch.get('status')
          events.append(('save',s))
    calls_after=0
    for kind,v in reversed(events):
      if kind=='call': calls_after+=1
      else: direct+=v; resent+=v*calls_after
print(f'direct chars saved {direct} (~{direct//4} tok); incl. re-reads on later calls ~{resent//4/1e6:.1f}M tok of {allin/1e6:.0f}M total input ({100*resent/4/allin:.1f}%)')
