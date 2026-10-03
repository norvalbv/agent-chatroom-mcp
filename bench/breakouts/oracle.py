#!/usr/bin/env python3
"""Breakouts bench oracle (claim/breakouts, swarm-202803-dpij). Usage: bench/breakouts/oracle.py <data dir> <run id>

Reads every <run id>-*.jsonl room log in <data dir> and prints one JSON line:
  rooms          rooms of the run
  concluded      rooms that reached a conclusion
  breakouts      rooms other than <run id>-room that 2+ distinct seats joined (the brief forces a split; see Scope)
  linked         of those, rooms created with a parent link (only possible on builds with join_room(parent=))
  carried        parent board entries inbox/<child>/conclusion (written by the hub or by post_to_room)
  final_both     the <run id>-room conclusion mentions both decisions (matches "1" and "2" decision markers)
  d1_evidence    that conclusion cites src/hub.ts:62, the line that sets the default (12)
  d2_evidence    it names a script under scripts/ that, in the bench repo (<repo>, default /tmp/bo-repo.tar's tree at
                 31daae67), really launches a model seat (spawns claude/codex) or binds a port (.listen()
  minutes        first room event to the <run id>-room conclusion (null if none)
  ok             outcome oracle: main room concluded, final_both, d1_evidence and d2_evidence
  anywhere_ok    lenient: d1 and d2 evidence each appear in SOME concluded room of the run (credits a seat that put
                 the combined answer in a third room instead of the main one)

Scope (verifier #366): the brief asks for each decision as its own agreed conclusion, and a room concludes once, so the
task forces a split in both arms. This bench measures what the split costs and whether the result reaches the parent,
not whether seats split unprompted.
"""
import glob, json, os, re, sys
from datetime import datetime

data, run = sys.argv[1], sys.argv[2]
repo = sys.argv[3] if len(sys.argv) > 3 else "/tmp/bo-repo-ref"
def ts(s): return datetime.fromisoformat(s.replace("Z", "+00:00"))
rooms = {}
for path in sorted(glob.glob(os.path.join(data, f"{run}-*.jsonl"))):
    name = os.path.basename(path)[:-len(".jsonl")]
    r = {"joins": set(), "parent": None, "conclusion": None, "start": None, "end": None, "inbox": set()}
    for line in open(path):
        try: ev = json.loads(line)
        except json.JSONDecodeError: continue
        t = ev.get("type")
        if t == "room":
            r["parent"] = (ev.get("opts") or {}).get("parent"); r["start"] = ev.get("createdAt")
        elif t == "join" and (ev.get("p") or {}).get("agent") != "human":
            r["joins"].add(ev["p"].get("session") or ev["p"]["name"])
        elif t == "state" and ev.get("state") == "concluded":
            r["conclusion"] = (ev.get("conclusion") or {}).get("text"); r["end"] = (ev.get("conclusion") or {}).get("decidedAt")
        elif t == "board" and str(ev.get("key", "")).startswith("inbox/") and str(ev.get("key")).endswith("/conclusion") and ev.get("entry"):
            r["inbox"].add(ev["key"])
    rooms[name] = r
main = rooms.get(f"{run}-room", {})
others = [n for n in rooms if n != f"{run}-room"]
breakouts = [n for n in others if len(rooms[n]["joins"]) >= 2]
text = (main.get("conclusion") or "")
both = bool(re.search(r"(decision|d)\s*1", text, re.I)) and bool(re.search(r"(decision|d)\s*2", text, re.I))
def live(name):
    path = os.path.join(repo, "scripts", name)
    if not os.path.isfile(path): return False
    src = open(path, errors="replace").read()
    return bool(re.search(r"\.listen\(", src)) or (bool(re.search(r"\bspawn(Sync)?\(", src)) and bool(re.search(r"[\"'](claude|codex)[\"']", src)))
d1 = "src/hub.ts:62" in text
named = set(re.findall(r"scripts/([\w.-]+\.(?:ts|mjs|js|sh))", text))
d2 = any(live(n) for n in named)
alltext = "\n".join(r["conclusion"] or "" for r in rooms.values())
anywhere = "src/hub.ts:62" in alltext and any(live(n) for n in set(re.findall(r"scripts/([\w.-]+\.(?:ts|mjs|js|sh))", alltext)))
minutes = round((ts(main["end"]) - ts(main["start"])).total_seconds() / 60, 1) if main.get("end") and main.get("start") else None
print(json.dumps({"run": run, "rooms": len(rooms), "concluded": sum(1 for r in rooms.values() if r["conclusion"]),
    "breakouts": len(breakouts), "linked": sum(1 for n in breakouts if rooms[n]["parent"]),
    "carried": len(main.get("inbox", set())), "final_both": both, "d1_evidence": d1, "d2_evidence": d2, "d2_live_named": sorted(n for n in named if live(n)),
    "minutes": minutes, "ok": bool(main.get("conclusion")) and both and d1 and d2, "anywhere_ok": anywhere}))
