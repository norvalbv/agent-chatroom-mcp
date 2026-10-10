"""How much bystander context public two-seat working exchanges cost, and how many there are (swarm-082539-kns2,
claim/quiet-default; launcher-claude #128: claude seats send 7.7% of chat quiet, codex 41.9%).

A candidate is an agent's public chat message that @-names or replies to at most two other agents and names no human.
"marked" candidates also carry something the minimal prompt keeps public (a board key of a coordination prefix, a
proposal id, a commit-like hex token): the hub could not make those quiet without hiding an evidence pointer.
Bystander chars = message chars x the agents in the room at that moment that were neither sender nor addressee.

Usage: python3 -I scripts/quiet-candidates-measure.py <log.jsonl> ...
"""
import json
import re
import sys
from collections import defaultdict

# the same predicate as src/hub.ts AUTO_QUIET_MARKER / AUTO_QUIET_COMMITMENT plus settled-axis slugs
MARK = re.compile(r"\b(?:claim|verify|build|final|findings|evidence|sources|idea|attack|review|remaining|handoff|draft|inbox)/\S|\bprop_[0-9a-f]{4,}|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b", re.I)
COMMIT = re.compile(r"\b(?:I'll|I will|I'm (?:taking|building|starting|running|writing|picking|claiming|on it)|I am (?:taking|building)|I take\b|I've (?:started|taken|claimed)|taking (?:it|this|that)\b|on it\b|leave (?:it|that) to me)|\bRE-TARGET\b", re.I)
import glob as _g, os as _o
SLUGS = [_o.path.basename(f)[:-3] for f in _g.glob(_o.path.join(_o.path.dirname(_o.path.abspath(__file__)), "..", "docs", "decisions", "*.md"))]
def marked_text(t):
    return bool(MARK.search(t) or COMMIT.search(t) or any(s in t for s in SLUGS if len(s) >= 8))
MENTION = re.compile(r"@([\w.-]+)")

tot = defaultdict(lambda: defaultdict(int))
per_room = []
for path in sys.argv[1:]:
    present = {}  # pid -> (name, agent)
    msgs = {}
    room_chat = room_flip = 0
    for line in open(path, encoding="utf8", errors="replace"):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        t = e.get("type")
        if t == "join":
            p = e["p"]
            present[p["id"]] = (p["name"], p.get("agent", "?"))
        elif t == "leave":
            present.pop(e.get("p", {}).get("id"), None)
        elif t == "message":
            m = e["msg"]
            msgs[m["id"]] = m
            f = m.get("from", {})
            agent = f.get("agent")
            if m.get("kind") != "chat" or agent in (None, "hub", "human") or m.get("tag") == "opening":
                continue
            k = tot[agent]
            k["chat"] += 1
            room_chat += 1
            if m.get("quiet"):
                k["quiet"] += 1
                if marked_text(m.get("content", "")):
                    k["quiet_marked"] += 1
                continue
            names = {n: pid for pid, (n, _) in present.items()}
            humans = {n for pid, (n, a) in present.items() if a == "human"}
            ment = set(MENTION.findall(m.get("content", "")))
            if ment & humans:
                continue
            addressees = {names[n] for n in ment if n in names and names[n] != f.get("id")}
            parent = msgs.get(m.get("replyTo") or "")
            if parent and parent["from"].get("agent") not in (None, "hub", "human") and parent["from"]["id"] != f.get("id"):
                addressees.add(parent["from"]["id"])
            if not addressees or len(addressees) > 2:
                continue
            agents_here = [pid for pid, (_, a) in present.items() if a not in ("human", "hub")]
            by = len([pid for pid in agents_here if pid != f.get("id") and pid not in addressees])
            chars = len(m.get("content", ""))
            marked = marked_text(m.get("content", ""))
            key = "cand_marked" if marked else "cand_plain"
            k[key] += 1
            room_flip += not marked
            k[key + "_bychars"] += chars * by
        k = None
    if room_chat >= 20:
        per_room.append(room_flip / room_chat)

print(json.dumps({a: dict(v) for a, v in tot.items()}, indent=1))
per_room.sort()
if per_room:
    q = lambda f: round(100 * per_room[min(len(per_room) - 1, int(f * len(per_room)))], 1)
    print(f"rooms with >=20 agent chat messages: {len(per_room)}; share of agent chat that flips quiet, per room: p25 {q(.25)}% median {q(.5)}% p75 {q(.75)}%")
