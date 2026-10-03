#!/usr/bin/env python3
"""Unprompted-breakout bench oracle (swarm-202803-dpij, chair #640). Usage: oracle.py <data dir> <run id>

The brief (brief.txt) poses three independent questions that one room may legally answer in one conclusion and never
mentions rooms, splitting or tools, so a breakout in either arm is the seats' own choice. Prints one JSON line:
  breakout_formed   some room other than <run>-room was joined by 2+ distinct seats
  rooms_opened      rooms other than <run>-room (any membership)
  linked            of those, created with join_room(parent=) (head build only)
  minutes_to_split  main room creation -> first other room's creation (null if none)
  cross_claim       per seat: public chat messages in the main room neither from it nor @-addressed to it
  q1/q2/q3          the main room's conclusion has the answer (ground truth at 31daae67):
                    q1 src/hub.ts:62, 12, CHATROOM_MAX_ROOMS_PER_RUN; q2 bench-build-oracle-audit.test.ts,
                    seat-env-regression.ts, claude-lean-flags-regression.ts; q3 20
  ok                main room concluded and q1, q2, q3
  minutes           main room creation -> its conclusion
"""
import glob, json, os, re, sys
from datetime import datetime
data, run = sys.argv[1], sys.argv[2]
ts = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))
rooms = {}
for path in sorted(glob.glob(os.path.join(data, f"{run}-*.jsonl"))):
    name = os.path.basename(path)[:-len(".jsonl")]
    r = {"seats": set(), "parent": None, "created": None, "conclusion": None, "decided": None, "msgs": []}
    for line in open(path):
        try: ev = json.loads(line)
        except json.JSONDecodeError: continue
        t = ev.get("type")
        if t == "room": r["parent"] = (ev.get("opts") or {}).get("parent"); r["created"] = ev.get("createdAt")
        elif t == "join" and (ev.get("p") or {}).get("agent") != "human": r["seats"].add(ev["p"].get("session") or ev["p"]["name"])
        elif t == "message": r["msgs"].append(ev["msg"])
        elif t == "state" and ev.get("state") == "concluded":
            r["conclusion"] = (ev.get("conclusion") or {}).get("text"); r["decided"] = (ev.get("conclusion") or {}).get("decidedAt")
    rooms[name] = r
main = rooms.get(f"{run}-room") or {"msgs": [], "conclusion": None, "created": None, "decided": None}
others = {n: r for n, r in rooms.items() if n != f"{run}-room"}
chat = [m for m in main["msgs"] if m.get("kind") == "chat" and m["from"].get("id") != "system"]
pub = [m for m in chat if not m.get("quiet")]
seats = {m["from"]["name"]: m["from"]["id"] for m in chat}
cross = {s: sum(1 for m in pub if m["from"]["name"] != s and sid not in (m.get("mentions") or [])) for s, sid in seats.items()}
text = main["conclusion"] or ""
q1 = "hub.ts:62" in text and re.search(r"\b12\b", text) is not None and "CHATROOM_MAX_ROOMS_PER_RUN" in text
q2 = all(n in text for n in ("bench-build-oracle-audit.test.ts", "seat-env-regression.ts", "claude-lean-flags-regression.ts"))
q3 = re.search(r"\b20\b", text) is not None
first = min((r["created"] for r in others.values() if r["created"]), default=None)
print(json.dumps({"run": run, "breakout_formed": any(len(r["seats"]) >= 2 for r in others.values()), "rooms_opened": len(others),
    "linked": sum(1 for r in others.values() if r["parent"]),
    "minutes_to_split": round((ts(first) - ts(main["created"])).total_seconds() / 60, 1) if first and main["created"] else None,
    "cross_claim": cross, "q1": q1, "q2": q2, "q3": q3, "ok": bool(main["conclusion"]) and q1 and q2 and q3,
    "minutes": round((ts(main["decided"]) - ts(main["created"])).total_seconds() / 60, 1) if main["decided"] else None}))
