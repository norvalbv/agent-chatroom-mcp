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

MARK = re.compile(r"\b(?:claim|verify|build|final|findings|evidence|sources|idea|attack|review|remaining|handoff)/[\w./-]+|\bprop_[0-9a-f]{6,}|\b[0-9a-f]{7,40}\b")
MENTION = re.compile(r"@([\w.-]+)")

tot = defaultdict(lambda: defaultdict(int))
for path in sys.argv[1:]:
    present = {}  # pid -> (name, agent)
    msgs = {}
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
            if m.get("quiet"):
                k["quiet"] += 1
                if MARK.search(m.get("content", "")):
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
            marked = bool(MARK.search(m.get("content", "")))
            key = "cand_marked" if marked else "cand_plain"
            k[key] += 1
            k[key + "_bychars"] += chars * by
        k = None

print(json.dumps({a: dict(v) for a, v in tot.items()}, indent=1))
