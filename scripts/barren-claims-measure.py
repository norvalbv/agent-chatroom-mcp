"""How often a room's first proposal opened while a seat still in the room owned a claim/* and had put nothing else on
the board (swarm-000525-jcz8, idea R3). Reads room logs. Run: python3 scripts/barren-claims-measure.py [data dir]"""
import glob, json, re, sys
D = sys.argv[1] if len(sys.argv) > 1 else "data"
NOT_FINDINGS = re.compile(r"^(claim|draft|inbox|hold)/")
rooms = hit = seats = barren_seats = later = 0
for f in sorted(glob.glob(D + "/swarm-*.jsonl")):
    claims, wrote, active, proposed, barren = {}, set(), set(), False, set()
    for line in open(f):
        try: d = json.loads(line)
        except ValueError: continue
        t = d.get("type")
        if t == "join": active.add(d["p"]["name"])
        elif t == "leave": active.discard(d["p"]["name"])
        elif t == "board" and d.get("entry"):
            by = d["entry"].get("by")
            if d["key"].startswith("claim/"): claims[d["key"]] = by
            elif not NOT_FINDINGS.match(d["key"]): wrote.add(by)
        elif t == "board" and not d.get("entry"): claims.pop(d["key"], None)
        elif t == "proposal" and not proposed:
            proposed = True
            owners = {by for by in claims.values() if by in active}
            barren = owners - wrote
            rooms += 1; seats += len(owners); barren_seats += len(barren); hit += bool(barren)
    if proposed: later += len(barren & wrote)
print(f"rooms with a proposal: {rooms}")
print(f"first proposal opened with at least one barren claim owner: {hit} ({100*hit//max(rooms,1)}%)")
print(f"claim owners present at first proposal: {seats}; with nothing else on the board: {barren_seats} ({100*barren_seats//max(seats,1)}%)")
print(f"of those, wrote a findings entry later in the room: {later}")
