#!/usr/bin/env python3
"""Per-room token usage of Claude Code seats, read from session transcripts (~/.claude/projects/<slug>/*.jsonl).
Usage: scripts/claude-room-usage.py <room-substring> [...]   Dedupes by message.id (a multi-block turn logs several lines)."""
import json, sys, glob, os, re
rooms = sys.argv[1:]
files = glob.glob(os.path.expanduser("~/.claude/projects/*agent-chatroom-mcp*/*.jsonl"))
out = {r: dict(seats=0, turns=0, inp=0, cread=0, ccreate=0, outp=0) for r in rooms}
for f in files:
    room = None; seen = {}; 
    try: lines = open(f).read().splitlines()
    except Exception: continue
    for ln in lines[:6]:
        m = re.search(r"MCP room [`\\\"']*([\w-]+)", ln)   # the room this seat was told to join, not rooms named in prior-run context
        if m:
            room = next((r for r in rooms if r in m.group(1)), None); break
    if not room: continue
    for ln in lines:
        try: d = json.loads(ln)
        except Exception: continue
        m = d.get("message") or {}
        if d.get("type") == "assistant" and m.get("id") and m.get("usage"): seen[m["id"]] = m["usage"]
    o = out[room]; o["seats"] += 1; o["turns"] += len(seen)
    for u in seen.values():
        o["inp"] += u.get("input_tokens", 0); o["cread"] += u.get("cache_read_input_tokens", 0)
        o["ccreate"] += u.get("cache_creation_input_tokens", 0); o["outp"] += u.get("output_tokens", 0)
print(f"{'room':28} {'seats':>5} {'turns':>6} {'input+cache':>13} {'per turn':>9} {'per seat':>10} {'cache-read%':>11} {'output':>9}")
for r, o in out.items():
    tot = o["inp"] + o["cread"] + o["ccreate"]
    if not o["turns"]: print(f"{r:28} no sessions found"); continue
    print(f"{r:28} {o['seats']:5d} {o['turns']:6d} {tot:13,d} {tot//o['turns']:9,d} {tot//o['seats']:10,d} {100*o['cread']/tot:10.1f}% {o['outp']:9,d}")
