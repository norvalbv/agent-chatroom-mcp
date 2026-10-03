#!/usr/bin/env python3
"""Delivered cross-claim reads per seat (pre-registered before scoring, 6-astra-4 #657 / 6-astra-7 #651).
Usage: reads.py <run dir swarms/<run>> [names of worker seats, default: every claude-opus-5-5-N]

For each seat's Claude trace (found as scripts/swarm-tool-usage.py --discover-claude finds it), every chat line the hub
actually delivered to it (messages[] of wait_for_messages / read_messages / join_room recent_messages tool results, and
send_message refusals' unread[]) is attributed to its author. A cross-claim read is a line authored by ANOTHER worker
seat that does not @-mention the reader. Only workers are counted as authors (verifier and system lines are excluded),
since the brief's three questions are split between the two workers. Lines delivered twice count twice (that is what
the reader paid for). Output per seat: lines, chars; "unknown" when no trace is found. Stubs ("[shown to you mid-turn")
count as delivered lines.
"""
import glob, json, os, re, subprocess, sys
run_dir = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
u = json.loads(subprocess.run([sys.executable, os.path.join(here, "..", "..", "scripts", "swarm-tool-usage.py"), "--run-dir", run_dir,
    "--discover-claude"], capture_output=True, text=True).stdout or "{}")
cfg = os.environ.get("CLAUDE_CONFIG_DIR", os.path.expanduser("~/.claude"))
LINE = re.compile(r"^#\d+ ([^:\[]+?)(?: \[[a-z]+\])?: ")
def delivered(text):
    try: obj = json.loads(text)
    except Exception: return []
    out = []
    for k in ("messages", "recent_messages", "unread"):
        v = obj.get(k) if isinstance(obj, dict) else None
        if isinstance(v, list): out += [x for x in v if isinstance(x, str)]
    return out
seats = list(u.get("seats", {}))
workers = [s for s in seats if s.startswith("claude-opus-5-5-")] if len(sys.argv) < 3 else sys.argv[2:]
res = {}
for seat, v in u.get("seats", {}).items():
    paths = [p for t in v.get("trace_sources", []) for p in glob.glob(os.path.join(cfg, "projects", "*", t))]
    if not paths: res[seat] = "unknown"; continue
    lines = chars = 0
    for path in paths:
        uses = {}
        for l in open(path, errors="replace"):
            try: e = json.loads(l)
            except json.JSONDecodeError: continue
            msg = e.get("message") or {}
            for c in msg.get("content") or [] if isinstance(msg.get("content"), list) else []:
                if not isinstance(c, dict): continue
                if c.get("type") == "tool_use": uses[c["id"]] = c.get("name", "")
                if c.get("type") == "tool_result" and "chatroom" in uses.get(c.get("tool_use_id"), ""):
                    body = c.get("content")
                    text = "".join(b.get("text", "") for b in body if isinstance(b, dict)) if isinstance(body, list) else str(body)
                    for m in delivered(text):
                        a = LINE.match(m)
                        if not a: continue
                        author = a.group(1).strip()
                        if author in workers and author != seat and f"@{seat}" not in m:
                            lines += 1; chars += len(m)
    res[seat] = {"cross_claim_lines": lines, "cross_claim_chars": chars}
print(json.dumps({"run_dir": run_dir, "workers": workers, "seats": res}))
