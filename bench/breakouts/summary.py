#!/usr/bin/env python3
"""One arm's cost line for the breakouts bench. Usage: bench/breakouts/summary.py <hub dir> <run id>
Sums swarms/<run>/*.usage.json (cost, tokens), counts model turns (distinct assistant message ids
in each seat's Claude trace; null when absent) and hub tool calls from data/<run>-*.jsonl call_completion events (all rooms of the run)."""
import glob, json, os, sys, collections
hub, run = sys.argv[1], sys.argv[2]
cost = inp = out = cache = 0.0
for f in glob.glob(os.path.join(hub, "swarms", run, "*.usage.json")):
    u = json.load(open(f)); cost += u.get("cost", 0); inp += u.get("input_tokens", 0); out += u.get("output_tokens", 0); cache += u.get("cache_read_input_tokens", 0)
# model turns = distinct assistant message ids in each seat's Claude trace (found the way scripts/swarm-tool-usage.py
# --discover-claude finds them); null when no trace is found
import subprocess
here = os.path.dirname(os.path.abspath(__file__))
usage = json.loads(subprocess.run([sys.executable, os.path.join(here, "..", "..", "scripts", "swarm-tool-usage.py"), "--run-dir",
    os.path.join(hub, "swarms", run), "--discover-claude"], capture_output=True, text=True).stdout or "{}")
turns = 0; seen = False
for seat in usage.get("seats", {}).values():
    for src in seat.get("trace_sources", []):
        for path in glob.glob(os.path.join(os.environ.get("CLAUDE_CONFIG_DIR", os.path.expanduser("~/.claude")), "projects", "*", src)):
            ids = set()
            for line in open(path, errors="replace"):
                try: ev = json.loads(line)
                except json.JSONDecodeError: continue
                if ev.get("type") == "assistant": ids.add((ev.get("message") or {}).get("id"))
            turns += len(ids); seen = True
calls = collections.Counter()
for f in glob.glob(os.path.join(hub, "data", f"{run}-*.jsonl")):
    for line in open(f):
        try: ev = json.loads(line)
        except json.JSONDecodeError: continue
        if ev.get("type") == "call_completion": calls[ev["tool"]] += 1
n = sum(calls.values())
print(json.dumps({"run": run, "cost_usd": round(cost, 3), "input_tokens": int(inp), "cache_read": int(cache), "output_tokens": int(out),
    "model_turns": turns if seen else None, "cost_per_turn": round(cost / turns, 4) if seen and turns else None,
    "hub_tool_calls": n, "by_tool": dict(calls.most_common())}))
