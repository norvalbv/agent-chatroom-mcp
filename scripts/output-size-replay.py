"""Replay compact JSON and send receipts over captured Codex tool results.

Usage: uv run --with tiktoken python scripts/output-size-replay.py <run-dir>
Token counts use o200k_base as a proxy, never as provider billing telemetry.
"""
import collections
import json
from pathlib import Path
import sys

import tiktoken


def compact(text):
    try:
        return json.dumps(json.loads(text), ensure_ascii=False, separators=(",", ":"))
    except ValueError:
        prefix, newline, suffix = text.partition("\n")
        if newline:
            try:
                return prefix + newline + json.dumps(json.loads(suffix), ensure_ascii=False, separators=(",", ":"))
            except ValueError:
                pass
        return text


def replay(root):
    tokenizer = tiktoken.get_encoding("o200k_base")
    totals = collections.defaultdict(lambda: [0] * 7)
    calls_by_seat = {}
    for path in sorted(root.glob("*.events.jsonl")):
        calls = 0
        for line in path.read_text().splitlines():
            event = json.loads(line)
            item = event.get("item", {})
            if (event.get("type") != "item.completed" or item.get("type") != "mcp_tool_call"
                    or item.get("server") != "chatroom"):
                continue
            calls += 1
            for block in (item.get("result") or {}).get("content", []):
                text = block.get("text")
                if not isinstance(text, str):
                    continue
                packed = compact(text)
                final = packed
                if item.get("tool") == "send_message":
                    try:
                        payload = json.loads(packed)
                    except ValueError:
                        payload = {}
                    if isinstance(payload, dict) and isinstance(payload.get("sent"), str):
                        body = item["arguments"]["content"]
                        if not body or not payload["sent"].endswith(body):
                            raise ValueError(f"Unrecognized successful send in {path.name}: {item['id']}")
                        payload["sent"] = payload["sent"][:-len(body)].rstrip()
                        final = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
                row = totals[item["tool"]]
                row[0] += 1
                for index, value in enumerate((text, packed, final)):
                    row[1 + index] += len(value.encode("utf-8"))
                    row[4 + index] += len(tokenizer.encode(value))
        calls_by_seat[path.name.removesuffix(".events.jsonl")] = calls
    return {
        "source_run": root.name,
        "encoding": "o200k_base proxy, not provider billed tokens",
        "columns": ["calls", "bytes_before", "bytes_compact_only", "bytes_final",
                    "proxy_tokens_before", "proxy_tokens_compact_only", "proxy_tokens_final"],
        "by_tool": dict(sorted(totals.items(), key=lambda entry: -entry[1][1])),
        "totals": [sum(row[index] for row in totals.values()) for index in range(7)],
        "calls_by_seat": calls_by_seat,
        "method": "Completed Codex chatroom text blocks; compact full JSON or error JSON suffix, then remove exact sender-authored echo. Same calls/data, not a live task-cost estimate.",
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    print(json.dumps(replay(Path(sys.argv[1])), indent=2))
