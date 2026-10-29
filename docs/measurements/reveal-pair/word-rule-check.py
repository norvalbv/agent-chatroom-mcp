"""Which idea/* texts match the pre-registered word rule (decision/reveal-rivals-protocol SECONDARY), at first write and at the end.
run-room.py applies the rule to the board's final idea/* texts; this shows each match so a hit can be read by hand.
Known false positive: /exponent/ matches "toExponential", so a toFixed/toExponential tie-rounding seed counts as naming case 458's error.
  python3 -I docs/measurements/reveal-pair/word-rule-check.py <room.jsonl>"""
import sys, json, re
ERR = lambda t: bool(re.search(r'exponent', t, re.I) and re.search(r'(exact|binary|power of (ten|10)|after rounding|1e-0?7|%\.17g|9\.99)', t, re.I))
CHK = lambda t: bool(re.search(r'(/usr/bin/printf|system printf|real printf|libc|C printf|snprintf|python.{0,20}%)', t, re.I))
first, last, writers = {}, {}, {}
for line in open(sys.argv[1]):
    if not line.strip(): continue
    e = json.loads(line)
    if e.get('type') != 'board': continue
    k = e.get('key', '')
    if not k.startswith('idea/'): continue
    ent = e.get('entry') or {}
    t = ent.get('text') if isinstance(ent, dict) else None
    if t is None: t = e.get('text')
    if t is None: continue
    first.setdefault(k, t); last[k] = t; writers.setdefault(k, []).append(ent.get('by') if isinstance(ent, dict) else None)
for k in first:
    print(f"{k}: first err={ERR(first[k])} chk={CHK(first[k])} | final err={ERR(last[k])} chk={CHK(last[k])} | writes={len(writers[k])} by={sorted(set(map(str, writers[k])))}")
    if ERR(first[k]) or CHK(first[k]): print('   FIRST:', first[k][:260].replace('\n', ' '))
print('any first err', any(ERR(t) for t in first.values()), 'any first chk', any(CHK(t) for t in first.values()))
print('any final err', any(ERR(t) for t in last.values()), 'any final chk', any(CHK(t) for t in last.values()))
