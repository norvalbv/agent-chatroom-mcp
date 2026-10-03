#!/usr/bin/env python3
"""Measure a run's observed tool calls, returned text bytes, and provider usage.

Usage: scripts/swarm-tool-usage.py --run-dir swarms/<run> [--transcript seat.jsonl]
Missing traces/usage remain explicit. Text bytes are not wire bytes or token counts.
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import re


def rows(path):
    with path.open() as source:
        for number, line in enumerate(source, 1):
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                if line.endswith("\n"):
                    raise ValueError(f"Invalid JSONL at {path.name}:{number}") from None
                # Live JSONL may end in an incomplete write.


def text_content(value):
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return text_content(value.get("content", []))
    if isinstance(value, list):
        return "\n".join(block.get("text", "") for block in value
                         if isinstance(block, dict) and block.get("type") == "text")
    return ""


def decode_payload(text):
    try:
        result = json.loads(text)
        return result if isinstance(result, dict) else {}
    except (ValueError, TypeError):
        return {}


def delivered_messages(text):
    if not text:
        return []
    try:
        payload = json.loads(text)
    except ValueError:
        # A refused send has a plain-text explanation before its JSON envelope.
        start = text.find("\n{")
        payload = decode_payload(text[start + 1:]) if start >= 0 else {}
    if isinstance(payload, list):
        return [line for line in payload if isinstance(line, str) and re.match(r"#\d+ ", line)]
    if isinstance(payload, dict):
        return [line for key in ("messages", "unread", "recent_messages")
                for line in payload.get(key, []) if isinstance(line, str) and re.match(r"#\d+ ", line)]
    return []


def normalized_tool(name):
    return name.rsplit("__", 1)[-1] if name.startswith("mcp__chatroom__") else name


def parse_trace(path):
    calls, results, usage = {}, {}, {}
    seat, provider, previous_turn = None, None, 0
    for row in rows(path):
        kind = row.get("type")
        if kind == "turn.started":
            previous_turn += 1
        item = row.get("item", {})
        if kind in ("item.started", "item.completed") and item.get("id"):
            provider = "codex"
            key = (previous_turn, item["id"])
            if item.get("type") == "mcp_tool_call":
                hub = item.get("server") == "chatroom"
                name = item.get("tool", "unknown")
                args = item.get("arguments") or {}
            elif item.get("type") == "command_execution":
                hub, name, args = False, "command_execution", {}
            else:
                continue
            calls.setdefault(key, {"tool": name, "args": args, "hub": hub})
            if kind == "item.completed":
                result = item.get("result") if hub or item.get("type") == "mcp_tool_call" else item.get("aggregated_output")
                if result is not None:
                    results[key] = text_content(result)
            if hub and name == "join_room":
                seat = args.get("name", seat)
        message = row.get("message") or {}
        if kind == "assistant" and message.get("id") and message.get("usage"):
            provider = "claude"
            usage[message["id"]] = message["usage"]
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                provider = "claude"
                key = block["id"]
                name = block.get("name", "unknown")
                args = block.get("input") or {}
                hub = name.startswith("mcp__chatroom__")
                name = normalized_tool(name)
                calls.setdefault(key, {"tool": name, "args": args, "hub": hub})
                if hub and name == "join_room":
                    seat = args.get("name", seat)
            elif block.get("type") == "tool_result":
                results[block["tool_use_id"]] = text_content(block.get("content"))
    observations = []
    for key, call in calls.items():
        observations.append({**call, "text": results.get(key)})
    token_usage = None
    if usage:
        fields = ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens")
        token_usage = {field: sum(u[field] for u in usage.values() if field in u)
                       for field in fields if any(field in u for u in usage.values())}
        token_usage["assistant_messages"] = len(usage)
    return seat or path.name.replace(".events.jsonl", "").replace(".jsonl", ""), provider, observations, token_usage


def summarize_calls(calls):
    tools = {}
    candidates = collections.Counter()
    last_hub = None
    previous_board = {}
    previous_payloads = set()
    seen_messages = set()
    refused_sends = {}
    for call in calls:
        name, content = call["tool"], call["text"]
        stats = tools.setdefault(name, {"calls": 0, "results": 0, "text_bytes": 0, "max_text_bytes": 0, "hub": call["hub"]})
        stats["calls"] += 1
        if content is not None:
            size = len(content.encode("utf-8"))
            stats["results"] += 1
            stats["text_bytes"] += size
            stats["max_text_bytes"] = max(stats["max_text_bytes"], size)
        if not call["hub"]:
            continue
        room = call["args"].get("room")
        for line in delivered_messages(content):
            key = (room, line)
            if key in seen_messages:
                candidates["repeated_message_deliveries"] += 1
                candidates["repeated_message_text_bytes"] += len(line.encode("utf-8"))
            seen_messages.add(key)
        if name == "send_message":
            key = (room, call["args"].get("content"))
            if key in refused_sends:
                candidates["same_content_send_retries"] += 1
                del refused_sends[key]
            if "arrived while you were composing" in (content or ""):
                candidates["unread_send_refusals"] += 1
                candidates["unread_send_refusal_text_bytes"] += len(content.encode("utf-8"))
                refused_sends[key] = True
        if name == "read_messages" and last_hub and last_hub["tool"] == "wait_for_messages" and room == last_hub["args"].get("room"):
            candidates["read_messages_after_wait"] += 1
            old = set(re.findall(r"#(\d+)\b", last_hub["text"] or ""))
            new = set(re.findall(r"#(\d+)\b", content or ""))
            candidates["overlapping_message_seqs_after_wait"] += len(old & new)
        if name == "board_get":
            key = (room, call["args"].get("key"))
            if key[1] is None:
                candidates["board_manifest_reads"] += 1
            payload = decode_payload(content)
            body = payload.get("text")
            if isinstance(body, str):
                if previous_board.get(key) == body:
                    candidates["board_key_reads_with_unchanged_text"] += 1
                previous_board[key] = body
        if content is not None:
            fingerprint = (name, room, json.dumps(call["args"], sort_keys=True), hashlib.sha256(content.encode()).hexdigest())
            if fingerprint in previous_payloads:
                candidates["exact_repeated_hub_results"] += 1
            previous_payloads.add(fingerprint)
        last_hub = call
    return tools, dict(candidates)


def sidecar_usage(path):
    raw = json.loads(path.read_text())
    if "codex_usage" in raw:
        return "codex", raw["codex_usage"]
    if "input_tokens" in raw or "cache_read_input_tokens" in raw:
        return "claude", {k: raw[k] for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens") if k in raw}
    return "openrouter", {k: raw[k] for k in ("prompt_tokens", "completion_tokens", "steps") if k in raw}


def analyze(run_dir, transcripts=()):
    seats = {}
    paths = dict.fromkeys(path.resolve() for path in sorted(run_dir.glob("*.events.jsonl")) + list(transcripts))
    for path in paths:
        seat, provider, calls, usage = parse_trace(path)
        entry = seats.setdefault(seat, {"provider": provider, "trace_sources": [], "_calls": [], "usage": None})
        entry["trace_sources"].append(path.name)
        entry.setdefault("trace_sha256", {})[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
        entry["_calls"].extend(calls)
        if usage is not None:
            if entry["usage"] is None:
                entry["usage"] = usage
            else:
                for field, value in usage.items():
                    entry["usage"][field] = entry["usage"].get(field, 0) + value
    for path in sorted(run_dir.glob("*.usage.json")):
        seat = path.name.removesuffix(".usage.json")
        provider, usage = sidecar_usage(path)
        entry = seats.setdefault(seat, {"trace_sources": [], "_calls": []})
        entry.update(provider=provider, usage=usage or None, usage_source=path.name)
    totals = collections.Counter()
    aggregate_tools = {}
    aggregate_candidates = collections.Counter()
    for entry in seats.values():
        calls = entry.pop("_calls")
        entry["trace_observed"] = bool(entry["trace_sources"])
        entry["tool_calls"] = len(calls) if entry["trace_observed"] else None
        entry["hub_tool_calls"] = sum(c["hub"] for c in calls) if entry["trace_observed"] else None
        entry["tools"], entry["redundancy_candidates"] = summarize_calls(calls)
        aggregate_candidates.update(entry["redundancy_candidates"])
        for name, stats in entry["tools"].items():
            combined = aggregate_tools.setdefault(name, {"calls": 0, "results": 0, "text_bytes": 0, "max_text_bytes": 0, "hub": stats["hub"]})
            for key in ("calls", "results", "text_bytes"):
                combined[key] += stats[key]
            combined["max_text_bytes"] = max(combined["max_text_bytes"], stats["max_text_bytes"])
            if stats["hub"]:
                totals["hub_tool_calls"] += stats["calls"]
                totals["hub_results"] += stats["results"]
                totals["hub_text_bytes"] += stats["text_bytes"]
    return {"run": run_dir.name, "method": {
        "bytes": "UTF-8 bytes of returned text blocks joined by newline; excludes JSON transport envelope and non-text blocks",
        "tokens": "Provider-reported usage, separate from text bytes; missing fields are unknown, not zero",
        "candidates": "Observed patterns, not a finding that every matched call was unnecessary",
        "coverage": "Denominator is seats found in supplied artifacts, not a room roster. Sidecars supply usage without traces and supersede transcript usage.",
    }, "seats": seats, "observed_totals": dict(totals), "tools": aggregate_tools,
        "redundancy_candidates": dict(aggregate_candidates), "coverage": {
            "seats": len(seats), "seats_with_trace": sum(s["trace_observed"] for s in seats.values()),
            "seats_with_usage": sum(s.get("usage") is not None for s in seats.values()),
        }}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--transcript", type=Path, action="append", default=[])
    args = parser.parse_args()
    if not args.run_dir.is_dir():
        parser.error("--run-dir must be an existing run directory")
    print(json.dumps(analyze(args.run_dir, args.transcript), indent=2))


if __name__ == "__main__":
    main()
