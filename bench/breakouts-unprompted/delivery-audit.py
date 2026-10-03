#!/usr/bin/env python3
"""Supplementary delivery/formation audit; does not change the registered task oracle.

--data-dir contains hub ledgers; --run names the run; repeat --trace for every seat.
Actual context delivery is observable, attention is not. Missing claims stay unknown.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True

PARSER = Path(__file__).resolve().parents[2] / "scripts/swarm-tool-usage.py"
SPEC = importlib.util.spec_from_file_location("tool_usage", PARSER)
USAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(USAGE)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def room_record(path):
    events = list(USAGE.rows(path))
    meta = next((e for e in events if e.get("type") == "room"), None)
    if not meta:
        return None
    members, active, claims, messages = {}, {}, {}, {}
    formed, unknown_identity = None, False
    for event in events:
        kind = event.get("type")
        if kind in ("join", "leave"):
            p = event["p"]
            members[p["id"]] = p
            if kind == "leave":
                active.pop(p["id"], None)
            elif p.get("agent") != "human" and p.get("role") != "chair":
                unknown_identity |= not bool(p.get("session"))
                active[p["id"]] = p.get("session")
                if formed is None and len(set(active.values()) - {None}) >= 2:
                    formed = p.get("lastActiveAt") or p.get("joinedAt")
        elif kind == "board" and event.get("key", "").startswith("claim/"):
            entry = event.get("entry") or {}
            try:
                body = json.loads(entry.get("text", ""))
            except (ValueError, TypeError):
                body = {}
            owner = body.get("owner") if isinstance(body, dict) else None
            if isinstance(owner, str) and body.get("status") != "released":
                claims[event["key"]] = owner
            else:
                claims.pop(event["key"], None)
        elif kind == "message":
            message = event["msg"]
            owned = defaultdict(set)
            for key, owner in claims.items():
                owners = {p.get("session") for p in members.values() if p["name"] == owner}
                if len(owners) == 1 and None not in owners:
                    owned[next(iter(owners))].add(key)
            messages[message["seq"]] = (message, dict(owned))
    return {"name": meta["room"], "created": meta.get("createdAt"),
            "parent": (meta.get("opts") or {}).get("parent"), "formed": formed,
            "members": members, "messages": messages, "unknown_identity": unknown_identity,
            "source": path.name, "source_sha256": digest(path)}


def trace_record(path):
    _, _, calls, _ = USAGE.parse_trace(path)
    joins = {(c["args"].get("room"), c["args"].get("name")) for c in calls
             if c["hub"] and c["tool"] == "join_room"}
    delivered, stubs = [], 0
    for call in calls:
        if not call["hub"] or not call.get("text"):
            continue
        for line in USAGE.delivered_messages(call["text"]):
            if "[shown to you mid-turn" in line:
                stubs += 1
                continue
            delivered.append((call["args"].get("room"), int(re.match(r"#(\d+)", line)[1]), len(line.encode())))
    # A pushed chat is user context, not a tool result. Only accept the explicit delivery frame.
    for row in USAGE.rows(path):
        if row.get("type") != "user":
            continue
        content = USAGE.text_content((row.get("message") or {}).get("content"))
        frame = re.match(r"(?:<system-reminder>\s*)?\[Chatroom ([^,\]\n]+), from [^\]\n]+\]\s*(#(\d+) .*)", content, re.S)
        if frame:
            delivered.append((frame[1], int(frame[3]), len(frame[2].encode())))
    return {"source": path.name, "source_sha256": digest(path), "joins": joins,
            "calls": calls, "delivered": delivered, "stubs": stubs}


def related_rooms(rooms, traces, main):
    selected = {main}
    while True:
        sessions = {p.get("session") for name in selected for p in rooms[name]["members"].values()
                    if p.get("agent") != "human" and p.get("role") != "chair"} - {None}
        expanded = selected | {name for name, r in rooms.items() if r["parent"] in selected or any(
            p.get("session") in sessions for p in r["members"].values())}
        for trace in traces:
            for call in trace["calls"]:
                if call["hub"] and call["tool"] == "request_agent" and call["args"].get("room") in selected:
                    target = USAGE.decode_payload(call.get("text") or "").get("room")
                    if target in rooms:
                        expanded.add(target)
        if expanded == selected:
            return selected
        selected = expanded


def audit(data_dir, run, trace_paths):
    rooms = {r["name"]: r for p in sorted(data_dir.glob("*.jsonl")) if (r := room_record(p))}
    main = run + "-room"
    if main not in rooms:
        raise ValueError("Main room ledger is missing")
    traces = [trace_record(p) for p in trace_paths]
    selected = related_rooms(rooms, traces, main)
    names, primary, pairs, roles = defaultdict(set), {}, defaultdict(set), {}
    for name in sorted(selected, key=lambda n: (n != main, n)):
        for p in rooms[name]["members"].values():
            session = p.get("session")
            if p.get("agent") == "human" or p.get("role") == "chair" or not session:
                continue
            names[session].add(p["name"])
            primary.setdefault(session, p["name"])
            roles.setdefault(session, p.get("role", "worker"))
            pairs[name, p["name"]].add(session)
    receipts, coverage = defaultdict(list), defaultdict(list)
    ambiguous = []
    for trace in traces:
        sessions = set().union(*(pairs[pair] for pair in trace["joins"])) if trace["joins"] else set()
        if len(sessions) != 1:
            ambiguous.append(trace["source"])
            continue
        session = next(iter(sessions))
        coverage[session].append({k: trace[k] for k in ("source", "source_sha256", "stubs")})
        receipts[session].extend(trace["delivered"])
    seats = []
    for session, label in primary.items():
        seen, counts = set(), Counter()
        for room_name, seq, size in receipts[session]:
            if room_name not in selected:
                continue
            entry = rooms[room_name]["messages"].get(seq)
            if not entry:
                counts["unmatched_sequence_occurrences"] += 1
                continue
            message, owned = entry
            author = rooms[room_name]["members"].get(message["from"]["id"], {})
            if message["kind"] != "chat" or message.get("quiet") or author.get("agent") == "human" or not author.get("session") or author["session"] == session:
                continue
            counts["public_peer_delivery_occurrences"] += 1
            counts["public_peer_delivered_text_bytes"] += size
            if (room_name, seq) in seen:
                continue
            seen.add((room_name, seq))
            counts["unique_public_peer_messages"] += 1
            reader_ids = {pid for pid, p in rooms[room_name]["members"].items() if p.get("session") == session}
            if not reader_ids.intersection(message.get("mentions") or []):
                counts["unique_public_background_messages"] += 1
            a, b = owned.get(author["session"]), owned.get(session)
            if not a or not b:
                counts["unknown_claim_attribution"] += 1
            elif a.isdisjoint(b):
                counts["cross_claim_lower_bound"] += 1
            else:
                counts["shared_claim_messages"] += 1
        fields = ("public_peer_delivery_occurrences", "public_peer_delivered_text_bytes", "unique_public_peer_messages",
                  "unique_public_background_messages", "cross_claim_lower_bound", "shared_claim_messages",
                  "unknown_claim_attribution", "unmatched_sequence_occurrences")
        row = {"seat": label, "role": roles[session], "aliases": sorted(names[session]), "traces": coverage[session],
               "observed": {key: counts[key] for key in fields} if coverage[session] else None}
        row["cross_claim_reads"] = counts["cross_claim_lower_bound"] if coverage[session] and not (
            counts["unknown_claim_attribution"] or counts["unmatched_sequence_occurrences"]) else None
        seats.append(row)
    children = [rooms[n] for n in sorted(selected) if n != main]
    first = min((r["formed"] for r in children if r["formed"]), default=None)
    elapsed = None
    if first and rooms[main]["created"]:
        elapsed = (datetime.fromisoformat(first.replace("Z", "+00:00")) - datetime.fromisoformat(rooms[main]["created"].replace("Z", "+00:00"))).total_seconds()
    return {"run": run, "measurement": "supplemental actual public peer chat delivery; explicit claim ownership at message time; missing attribution unknown",
            "helper_sha256": digest(Path(__file__)),
            "room_inventory": [{"name": r["name"], "source_sha256": r["source_sha256"], "related": r["name"] in selected} for r in rooms.values()],
            "parser_sha256": digest(PARSER), "rooms": [{k: rooms[n][k] for k in ("name", "parent", "created", "formed", "source", "source_sha256", "unknown_identity")} for n in sorted(selected)],
            "breakout_formed": True if first else (None if any(r["unknown_identity"] for r in children) else False), "seconds_to_two_session_split": elapsed,
            "rooms_opened": len(children), "seats": seats,
            "coverage": {"roster_seats": len(primary), "seats_with_traces": sum(bool(v) for v in coverage.values()), "unattributed_traces": ambiguous,
                         "limit": "Supplied traces only; stubs are not message bodies. Unrecognised push formats remain outside coverage; delivery is not demonstrated attention."}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--trace", type=Path, action="append", default=[])
    args = parser.parse_args()
    print(json.dumps(audit(args.data_dir, args.run, args.trace), indent=2))
