"""How many asks did the addressee answer with a verify/* or attack/* entry covering the asked-for commit, and how many
of those were still owed (not replied to, no @-back to the sender) when the entry was written?
Usage: python3 -I scripts/ask-verify-measure.py <room.jsonl>..."""
import json, re, sys

SHA = re.compile(r'\b[0-9a-f]{7,40}\b')
hx = lambda t: {s for s in SHA.findall(t) if re.search('[a-f]', s) and re.search('[0-9]', s)}
for f in sys.argv[1:]:
    msgs, board = [], []
    for line in open(f):
        try: e = json.loads(line)
        except ValueError: continue
        if e.get('type') == 'message': msgs.append(e['msg'])
        if e.get('type') == 'board' and e.get('entry') and e['key'].startswith(('verify/', 'attack/')): board.append(e)
    name2id = {m['from']['name']: m['from']['id'] for m in msgs}
    asks = [m for m in msgs if m['kind'] == 'chat' and m.get('mentions') and m['from']['id'] != 'system']
    answered = {}
    for b in board:
        pid, ts, shas = name2id.get(b['entry']['by']), b['entry']['updatedAt'], hx(b['entry']['text'])
        for a in asks:
            if pid in a['mentions'] and a['ts'] < ts and a['id'] not in answered and hx(a['content']) & shas:
                answered[a['id']] = (a, pid, ts)
    pre = post = never = 0
    for aid, (a, pid, ts) in answered.items():
        rep = [m for m in msgs if m['from']['id'] == pid and m['kind'] == 'chat' and m['ts'] > a['ts']
               and (m.get('replyTo') == aid or a['from']['id'] in (m.get('mentions') or []))]
        if any(m['ts'] <= ts for m in rep): pre += 1
        elif rep: post += 1
        else: never += 1
    print(f"{f.split('/')[-1]}: {len(answered)} asks answered by a verify/attack entry; settled by chat before it {pre}, only after it {post}, never by chat {never}")
