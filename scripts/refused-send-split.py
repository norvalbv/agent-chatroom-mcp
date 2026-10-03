#!/usr/bin/env python3
"""Split a run's refused send_message calls by refusal reason, by what was unread, and by what the seat sent next.

Usage: scripts/refused-send-split.py --run-dir swarms/<run> [--transcript claude-session.jsonl ...]
A refusal is any send_message result without a "sent" receipt. "Next" compares the refused content with the seat's
next send_message (difflib ratio): same (>0.9) means the refusal only cost a retry; different (<0.5) means the seat
said something else after reading what had arrived.
"""
import argparse
import collections
import difflib
import json
from pathlib import Path
import re


def codex_calls(path):
    for line in path.open():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        item = row.get("item", {})
        if row.get("type") == "item.completed" and item.get("type") == "mcp_tool_call" and item.get("server") == "chatroom":
            result = item.get("result") or {}
            text = "\n".join(b.get("text", "") for b in (result.get("content") or []) if b.get("type") == "text")
            args = item.get("arguments") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except ValueError:
                    args = {}
            yield item.get("tool"), args, text or str(item.get("error") or "")


def claude_calls(path):
    uses = {}
    for line in path.open():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        message = row.get("message") or {}
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, list):
            continue
        for block in content:
            if block.get("type") == "tool_use" and block["name"].startswith("mcp__chatroom__"):
                uses[block["id"]] = (block["name"].rsplit("__", 1)[-1], block.get("input") or {})
            elif block.get("type") == "tool_result" and block["tool_use_id"] in uses:
                raw = block.get("content")
                text = raw if isinstance(raw, str) else "\n".join(b.get("text", "") for b in (raw or []) if b.get("type") == "text")
                name, args = uses[block["tool_use_id"]]
                yield name, args, text


def reason(text):
    for key, pattern in (("arrived", "arrived while you were composing"), ("owed", "owe a reply"),
                         ("overtalk", "most of the talking"), ("overtalk", "fair share is about"),
                         ("human-register-cap", "match their register"), ("human-already-answered", "One reply is enough"),
                         ("addressed-elsewhere", "addressed that to"),
                         ("departed", "has left the room")):
        if pattern in text:
            return key
    return "other"


def unread_kinds(text):
    start = text.find("{")
    try:
        payload = json.loads(text[start:]) if start >= 0 else {}
    except ValueError:
        return ("unparsed",)
    kinds = set()
    for line in payload.get("unread") or []:
        if re.match(r"#\d+ system:", line):
            kinds.add("system")
        elif re.match(r"#\d+ [^:]+: \[BOARD\]", line):
            kinds.add("board")
        elif "[quiet" in line[:80]:
            kinds.add("quiet")
        else:
            kinds.add("chat")
    return tuple(sorted(kinds)) or ("none",)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--transcript", type=Path, action="append", default=[])
    args = parser.parse_args()
    seats = [list(codex_calls(p)) for p in sorted(args.run_dir.glob("*.events.jsonl"))]
    seats += [list(claude_calls(p)) for p in args.transcript]
    hub_calls = sum(len(s) for s in seats)
    by_reason, by_unread, by_next = collections.Counter(), collections.Counter(), collections.Counter()
    for calls in seats:
        for i, (name, call_args, text) in enumerate(calls):
            if name != "send_message" or '"sent"' in text[:60]:
                continue
            why = reason(text)
            by_reason[why] += 1
            if why == "arrived":
                by_unread[unread_kinds(text)] += 1
            following = next((a for n, a, _ in calls[i + 1:] if n == "send_message"), None)
            if following is None:
                by_next["abandoned"] += 1
                continue
            ratio = difflib.SequenceMatcher(None, call_args.get("content", ""), following.get("content", "")).ratio()
            by_next[("same" if ratio > 0.9 else "edited" if ratio > 0.5 else "different") + (" (force)" if following.get("force") else "")] += 1
    refused = sum(by_reason.values())
    print(json.dumps({"run": args.run_dir.name, "seats": len(seats), "hub_calls": hub_calls, "refused_sends": refused,
                      "by_reason": dict(by_reason), "arrived_by_unread": {"+".join(k): v for k, v in by_unread.items()},
                      "next_send": dict(by_next)}, indent=2))


if __name__ == "__main__":
    main()
