"""How often a passing verify head's prose says something was not verified (swarm-000525-jcz8, claim/verify-gaps).
Run: python3 scripts/verify-gaps-measure.py <main checkout>/data"""
import json, sys, glob, re, collections
GAP = re.compile(r"not verified|NOT VERIFIED|did not (run|verify|exercise|watch|drive|check|test)|could not (run|verify|test)|not (run|exercised|watched|driven|checked) by me|unverified|untested|not tested|author-only|rests on the author", re.I)
c = collections.Counter(); ex = []
for f in sorted(glob.glob(sys.argv[1] + "/*.jsonl")):
    last = {}
    for l in open(f):
        try: d = json.loads(l)
        except Exception: continue
        if d.get("type") == "board" and d.get("key", "").startswith("verify/") and d.get("entry"):
            last[d["key"]] = d["entry"].get("text", "")
    for k, t in last.items():
        first, _, rest = t.partition("\n")
        try: h = json.loads(first); h = h if isinstance(h, dict) else None
        except Exception: h = None
        if not h or h.get("exit_code") != 0: continue
        c["passing heads"] += 1
        m = GAP.search(rest) or GAP.search(str(h.get("output_tail", "")))
        if m:
            c["prose names a gap"] += 1
            if len(ex) < 6: ex.append((f.split("/")[-1][:30], k, rest[max(0, m.start() - 60): m.end() + 100].replace("\n", " ")))
print(dict(c))
for e in ex: print(e)
