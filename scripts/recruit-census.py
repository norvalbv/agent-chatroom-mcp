#!/usr/bin/env python3
"""Who recruits, and what recruits deliver, across room logs (swarm-000525-jcz8 findings/recruiting).

Run: python3 scripts/recruit-census.py <dir of room *.jsonl logs> [--rows]
The first part counts only rooms whose log carries call_completion telemetry and had 3 or more joins.
"recruits by kind" (decision/recruit-timing, swarm-005940-77tu) covers every recruit: what it was for (in-room,
breakout, replacement; who asked), whether it joined, delivered (a board key other than claim/take/hold/inbox/...)
and was cited by another seat, minutes to its first deliverable, and its cost. --rows prints one JSON line each.
"""
import collections, glob, json, os, re, statistics, sys
from datetime import datetime

parse = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))
seats, recruiters = collections.Counter(), collections.Counter()
asked_seats, asked_recruiters = collections.Counter(), collections.Counter()
rooms = rooms_recruited = calls = refused = 0
latency, first_output, recruit_out = [], [], []

paths = sorted(glob.glob(sys.argv[1] + "/*.jsonl"))
for path in paths:
    joins, reqs, has, topic = {}, [], False, ""
    msgs, boards, first_board = collections.Counter(), collections.Counter(), {}
    n_refused = 0
    for line in open(path, errors="ignore"):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        t = e.get("type")
        if t == "room":
            topic = e["opts"].get("topic", "")
        elif t == "join":
            joins[e["p"]["id"]] = e["p"]
        elif t == "call_completion":
            has = True
            if e["tool"] == "request_agent":
                if e["outcome"] == "success":
                    reqs.append(e)
                else:
                    n_refused += 1
        elif t == "message":
            msgs[e["msg"]["from"].get("id")] += 1
        elif t == "board" and e.get("entry"):
            boards[e["entry"].get("by")] += 1
            first_board.setdefault(e["entry"].get("by"), e["entry"].get("updatedAt"))
    if not has or len(joins) < 3:
        continue
    rooms += 1
    rooms_recruited += bool(reqs)
    calls += len(reqs)
    refused += n_refused
    who = {r["participant"] for r in reqs}
    asked = bool(re.search(r"recruit|request_agent", topic, re.I))
    for pid, j in joins.items():
        k = (j.get("role") or "worker", j.get("agent"))
        seats[k] += 1
        recruiters[k] += pid in who
        if k[0] == "worker":
            ak = (j.get("agent"), "topic asks" if asked else "topic silent")
            asked_seats[ak] += 1
            asked_recruiters[ak] += pid in who
        if j.get("role") == "recruit":
            joined = parse(j["joinedAt"])
            prior = [parse(r["ts"]) for r in reqs if parse(r["ts"]) <= joined]
            if prior:
                latency.append((joined - max(prior)).total_seconds())
            if first_board.get(j["name"]):
                first_output.append((parse(first_board[j["name"]]) - joined).total_seconds() / 60)
            recruit_out.append((msgs[pid], boards[j["name"]]))

med = lambda xs: sorted(xs)[len(xs) // 2] if xs else None
print(f"rooms {rooms}, recruited in {rooms_recruited}; request_agent ok {calls}, refused {refused}")
print("seats that ever recruited, by role/provider:")
for k in sorted(seats, key=lambda k: -seats[k]):
    print(f"  {k[0]}/{k[1]}: {recruiters[k]} of {seats[k]} ({100 * recruiters[k] / seats[k]:.0f}%)")
print("worker seats, by whether the topic mentions recruiting:")
for k in sorted(asked_seats):
    print(f"  {k[0]}, {k[1]}: {asked_recruiters[k]} of {asked_seats[k]} ({100 * asked_recruiters[k] / asked_seats[k]:.0f}%)")
print(f"request -> recruit joined: median {med(latency)} s (n={len(latency)})")
print(f"recruit joined -> first board write: median {med(first_output) or 0:.1f} min (n={len(first_output)})")
n = len(recruit_out)
print(f"recruit seats {n}: posted a message {sum(1 for m, _ in recruit_out if m)}, wrote a board entry {sum(1 for _, b in recruit_out if b)}, neither {sum(1 for m, b in recruit_out if not m and not b)}")

NONDELIV = ("take/", "claim/", "hold/", "wake/", "inbox/", "draft/", "join-request/", "help/")
ANNOUNCE = re.compile(r"^(?P<by>\S+) recruited (?P<names>.+?) \((?P<agent>[a-z]+)(?:/[^,)\s]+)?(?P<rest>[^)]*)\): ", re.S)
RUN = re.compile(r"^(swarm-\d{6}-[a-z0-9]{4})")
SHA = re.compile(r"\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{7,40}\b")
mins = lambda a, b: round((parse(b) - parse(a)).total_seconds() / 60, 1)


def read_room(path):
    """What the recruit rows need from one log: joins, recruit announcements or recruit_spawn events, board writes, texts, cost."""
    r = {"joins": {}, "spawns": [], "ann": [], "writes": collections.defaultdict(list), "texts": [], "cost": {}}
    for line in open(path, errors="ignore"):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        t = e.get("type")
        if t == "join":
            r["joins"].setdefault(e["p"]["name"], e["p"])
        elif t == "recruit_spawn":
            r["spawns"].append(e)
        elif t == "message":
            m, c = e["msg"], e["msg"].get("content") or ""
            if m.get("kind") != "system":
                r["texts"].append((m.get("ts"), m["from"].get("name"), c))
            elif " recruited " in c[:200] and ANNOUNCE.match(c):
                r["ann"].append((m.get("ts"), ANNOUNCE.match(c)))
        elif t == "board" and (e.get("entry") or {}).get("text"):
            en = e["entry"]
            r["writes"][en.get("by")].append((en.get("updatedAt"), e["key"]))
            r["texts"].append((en.get("updatedAt"), en.get("by"), en["text"]))
        elif t == "usage":
            r["cost"][e.get("seat")] = max(r["cost"].get(e.get("seat"), 0), (e.get("usage") or {}).get("cost_usd") or 0)
    return r


def recruits(paths):
    rooms = {os.path.basename(p)[:-6]: read_room(p) for p in paths}
    run_of = lambda room: (RUN.match(room) or [room])[0]
    texts = collections.defaultdict(list)
    for name, r in rooms.items():
        texts[run_of(name)] += r["texts"]
    rows = []
    for name, r in rooms.items():
        asked = [dict(at=e["ts"], name=e["name"], by=e["requested_by"], by_role=e.get("by_role") or "worker", kind=e.get("kind") or "in-room",
                      room=e["room"], area=e.get("area"), compact_window=e.get("compact_window")) for e in r["spawns"]]
        if not r["spawns"]:  # older logs: the hub's "X recruited A, B (agent/model, into R, area X ...)" line
            for at, m in r["ann"]:
                into = re.search(r", into (\S+?)(?:,|$)", m["rest"])
                area = re.search(r", area (\S+?)(?:,|$)", m["rest"])
                by_role = (r["joins"].get(m["by"]) or {}).get("role") or "worker"
                for nm in (n.strip() for n in m["names"].split(",")):
                    asked.append(dict(at=at, name=nm, by=m["by"], by_role=by_role, kind="breakout" if into else "in-room",
                                      room=into.group(1) if into else name, area=area.group(1) if area else None, compact_window=None))
        for a in asked:
            target = rooms.get(a["room"]) or {"joins": {}, "writes": {}, "cost": {}}
            p = target["joins"].get(a["name"])
            joined = bool(p and p.get("joinedAt") and p["joinedAt"] >= a["at"])
            mine = sorted(w for w in target["writes"].get(a["name"], []) if w[0] and w[0] >= a["at"]) if joined else []
            deliv = [w for w in mine if not w[1].startswith(NONDELIV) and not w[1].endswith(".ack")]
            shas = sorted((ts, f"commit {m.group(0)}") for ts, by, text in texts[run_of(a["room"])] if joined and by == a["name"] and ts and ts >= a["at"]
                          for m in [SHA.search(text)] if m) if joined else []
            keys = {k for _, k in deliv}
            deliv = sorted(deliv + shas[:1])
            named = re.compile("|".join(rf"(?<![\w/.-]){re.escape(k)}(?![\w/-])" for k in sorted(keys))) if keys else None
            cited = any(by != a["name"] and named.search(text) for _, by, text in texts[run_of(a["room"])]) if keys else False
            rows.append({**a, "joined": joined, "join_s": round(mins(a["at"], p["joinedAt"]) * 60) if joined else None,
                         "delivered": bool(deliv), "commit": bool(shas), "cited": cited, "deliv_keys": sorted(keys)[:8],
                         "first_deliv_min": mins(a["at"], deliv[0][0]) if deliv else None,
                         "cost_usd": round(target["cost"].get(p.get("seatKeyHash"), 0), 2) if joined and target["cost"].get(p.get("seatKeyHash")) else None})
    return rows


rows = recruits(paths)
pct = lambda a, b: f"{a} ({100 * a // b if b else 0}%)"
print("recruits by kind (decision/recruit-timing): n, joined, delivered, cited, median min to first deliverable, median $ (priced n)")
for label, key in (("kind", "kind"), ("requester role", "by_role")):
    for k in sorted({r[key] for r in rows}):
        g = [r for r in rows if r[key] == k]
        d = [r["first_deliv_min"] for r in g if r["first_deliv_min"] is not None]
        c = [r["cost_usd"] for r in g if r["cost_usd"] is not None]
        print(f"  {k:<14} {len(g):3d}  joined {pct(sum(r['joined'] for r in g), len(g))}  delivered {pct(sum(r['delivered'] for r in g), len(g))}"
              f"  cited {pct(sum(r['cited'] for r in g), len(g))}  first {round(statistics.median(d), 1) if d else '-'} min  ${round(statistics.median(c), 2) if c else '-'} ({len(c)})")
    if label == "kind":
        print("recruits by requester role:")
if "--rows" in sys.argv[2:]:
    for r in rows:
        print(json.dumps(r))
