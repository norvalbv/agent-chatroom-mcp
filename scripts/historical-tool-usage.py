#!/usr/bin/env python3
"""Census completed room-bound MCP calls without exporting chat or credentials.

python3 scripts/historical-tool-usage.py --data-dir data --before <UTC ISO time>
Roomless calls, rejected schemas and pending calls are outside this ledger.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re


MAIN_ROOM = re.compile(r"swarm-\d{6}-[a-z0-9]+-room")
OUTCOMES = ("success", "hub_refusal", "error")


def counts(events):
    totals = Counter(event["outcome"] for event in events)
    return {"calls": len(events), **{key: totals[key] for key in OUTCOMES}}


def summarize(path):
    raw = path.read_bytes()
    events = [json.loads(line) for line in raw.splitlines() if line.strip()]
    metadata = next(event for event in events if event["type"] == "room")
    calls = [event for event in events if event["type"] == "call_completion"]
    if any(event["outcome"] not in OUTCOMES for event in calls):
        raise ValueError(f"Unknown call outcome in {path.name}")
    participants = {event["p"]["id"]: event["p"] for event in events
                    if event["type"] in ("join", "leave")}
    seats = []
    for pid, participant in participants.items():
        own = [event for event in calls if event.get("participant") == pid]
        seats.append({"name": participant["name"], "agent": participant["agent"],
                      "role": participant.get("role", "worker"), **counts(own),
                      "tools": dict(sorted(Counter(event["tool"] for event in own).items()))})
    tools = {tool: counts([event for event in calls if event["tool"] == tool])
             for tool in sorted({event["tool"] for event in calls})}
    messages = [event["msg"] for event in events if event["type"] == "message"]
    claims = {event["key"] for event in events
              if event["type"] == "board" and event["key"].startswith("claim/") and event.get("entry")}
    message_mix = Counter(("human_chat" if message["from"]["agent"] == "human" else "agent_chat")
                          if message["kind"] == "chat" else message["kind"] for message in messages)
    states = [event for event in events if event["type"] == "state"]
    return {
        "room": metadata["room"], "source": path.name,
        "source_sha256": hashlib.sha256(raw).hexdigest(), "source_bytes": len(raw),
        "created_at": metadata["createdAt"], "telemetry_version": metadata.get("telemetryVersion"),
        "last_call_at": max((event["ts"] for event in calls), default=None),
        "state": states[-1]["state"] if states else "open",
        "calls": counts(calls), "tools": tools,
        "unattributed_calls": sum(event.get("participant") not in participants for event in calls),
        "seats": seats, "claim_keys_ever_written": len(claims),
        "messages": {"total": len(messages), **dict(sorted(message_mix.items()))},
    }


def census(data_dir, before):
    observed, excluded = [], []
    for path in sorted(data_dir.glob("swarm-*-room.jsonl")):
        if not MAIN_ROOM.fullmatch(path.stem):
            continue
        room = summarize(path)
        if room["created_at"] >= before:
            continue
        elif room["telemetry_version"] != 1:
            excluded.append({key: room[key] for key in ("room", "source_sha256", "telemetry_version")})
        else:
            observed.append(room)
    totals = defaultdict(Counter)
    for room in observed:
        for tool, stats in room["tools"].items():
            totals[tool].update(stats)
            totals[tool]["rooms_used"] += 1
            totals[tool]["rooms_with_success"] += int(stats["success"] > 0)
    return {
        "schema_version": 1,
        "method": {
            "selection": "swarm-HHMMSS-id-room.jsonl created before cutoff, telemetryVersion=1; child and benchmark rooms excluded",
            "created_before": before,
            "denominator": "Completed guard invocations targeting an existing room; success is a returned tool action, not task success",
            "missing": "Roomless calls, pending calls, schema rejections outside guard and failed room creation are not logged",
            "list_rooms": "unknown: roomless tool never enters a room ledger",
            "list_agents": "lower bound: only calls with explicit room are logged",
        "model_scope": "Historical mixed models; agent field is runner family, not an exact model identifier",
            "interpretation": "Descriptive corpus; no useful-opportunity denominator or causal outcome/cost comparison",
            "privacy": "No chat bodies, call arguments, session keys or participant IDs are exported",
        },
        "coverage": {"observed_main_rooms": len(observed), "excluded_without_telemetry": len(excluded)},
        "aggregate": {"calls": sum(room["calls"]["calls"] for room in observed),
                      "tools": {tool: dict(stats) for tool, stats in sorted(totals.items())}},
        "rooms": observed, "excluded": excluded,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--before", required=True, help="Exclusive room-created UTC timestamp, e.g. 2026-10-03T20:28:03.762Z")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    if not args.data_dir.is_dir():
        parser.error("--data-dir must be an existing directory")
    result = json.dumps(census(args.data_dir, args.before), indent=2) + "\n"
    if args.out:
        args.out.write_text(result)
    else:
        print(result, end="")


if __name__ == "__main__":
    main()
