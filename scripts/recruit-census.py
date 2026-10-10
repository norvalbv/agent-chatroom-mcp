#!/usr/bin/env python3
"""Who recruits, and what recruits deliver, across room logs (swarm-000525-jcz8 findings/recruiting).

Run: python3 scripts/recruit-census.py <dir of room *.jsonl logs>
Counts only rooms whose log carries call_completion telemetry and had 3 or more joins.
"""
import collections, glob, json, re, sys
from datetime import datetime

parse = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))
seats, recruiters = collections.Counter(), collections.Counter()
asked_seats, asked_recruiters = collections.Counter(), collections.Counter()
rooms = rooms_recruited = calls = refused = 0
latency, first_output, recruit_out = [], [], []

for path in sorted(glob.glob(sys.argv[1] + "/*.jsonl")):
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
print(f"recruit joined -> first board write: median {med(first_output):.1f} min (n={len(first_output)})")
n = len(recruit_out)
print(f"recruit seats {n}: posted a message {sum(1 for m, _ in recruit_out if m)}, wrote a board entry {sum(1 for _, b in recruit_out if b)}, neither {sum(1 for m, b in recruit_out if not m and not b)}")
