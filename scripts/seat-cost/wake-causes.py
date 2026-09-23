import json,glob,os,sys,collections,re
base=os.path.expanduser('~/.claude/projects/')
cat=collections.Counter(); cnt=collections.Counter()
for d in sorted(glob.glob(base+'*'+sys.argv[1]+'*')):
  for f in glob.glob(d+'/*.jsonl'):
    lines=open(f).read().splitlines()
    if len(lines)<30: continue
    calls={}; order=[]; res={}
    for line in lines:
      try: e=json.loads(line)
      except: continue
      if e.get('type')=='assistant':
        m=e['message']; mid=m['id']
        if mid not in calls: calls[mid]={'u':m.get('usage',{}),'t':[]}; order.append(mid)
        for b in m.get('content',[]):
          if b.get('type')=='tool_use': calls[mid]['t'].append((b['name'],b['id']))
      elif e.get('type')=='user':
        c=e.get('message',{}).get('content')
        if isinstance(c,list):
          for b in c:
            if b.get('type')=='tool_result':
              cc=b.get('content'); res[b['tool_use_id']]=cc if isinstance(cc,str) else ''.join(x.get('text','') for x in cc if isinstance(x,dict))
    prev=None
    for mid in order:
      u=calls[mid]['u']; c=u.get('cache_read_input_tokens',0)+u.get('cache_creation_input_tokens',0)+u.get('input_tokens',0)
      if prev and prev[0].endswith('wait_for_messages'):
        try: j=json.loads(res.get(prev[1],''))
        except: j=None
        if isinstance(j,dict):
          msgs=j.get('messages') or []
          op=j.get('open_proposal') or {}
          if j.get('addressed_to_you'): k='addressed to me'
          elif j.get('unanswered_human'): k='human'
          elif isinstance(op,dict) and 'text' in op: k='new proposal version'
          elif j.get('conclusion'): k='conclusion'
          elif msgs and all(re.match(r'#\d+ (system:|\S+: \[BOARD\])',m) for m in msgs): k='only system/board notices'
          elif msgs: k='peer chat, not addressed'
          elif j.get('board_delta'): k='board delta only'
          else: k='empty'
          cat[k]+=c; cnt[k]+=1
      prev=calls[mid]['t'][-1] if calls[mid]['t'] else None
T=sum(cat.values())
for k,v in cat.most_common(): print(f'{k:28s} wakes={cnt[k]:4d} {v/1e6:6.1f}M {100*v/T:5.1f}% of wake cost')
