"""How often the hub assigned a claim's reviewer to a recruit seat, and whether that reviewer ever wrote a verify/*
entry in the room (swarm-000525-jcz8, remaining/verification). Run: python3 scripts/reviewer-recruit-measure.py <main>/data [<more files>]"""
import json, sys, glob, collections, os
files = []
for a in sys.argv[1:]: files += glob.glob(a + "/*.jsonl") if os.path.isdir(a) else [a]
c = collections.Counter()
for f in files:
    role, verified, assigned = {}, set(), {}
    for l in open(f):
        try: d = json.loads(l)
        except Exception: continue
        t = d.get("type")
        if t == "join": role[d["p"]["name"]] = d["p"].get("role") or "worker"
        if t == "board" and d.get("entry"):
            e = d["entry"]
            if d["key"].startswith("verify/"): verified.add(e.get("by"))
            if d["key"].startswith("claim/") and e.get("reviewer") and d["key"] not in assigned: assigned[d["key"]] = e["reviewer"]
    for k, r in assigned.items():
        kind = "recruit" if role.get(r) == "recruit" else "seat"
        c[(kind, "assigned")] += 1
        c[(kind, "wrote a verify/* in the room" if r in verified else "never wrote a verify/*")] += 1
for k in sorted(c): print(k, c[k])
