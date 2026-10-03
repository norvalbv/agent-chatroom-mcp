#!/usr/bin/env python3
"""Score the away-seat liveness A/B (bench/liveness/arm.sh) from committed artifacts only.

Usage: bench/liveness/collect.py <artifact dir> > docs/measurements/away-seat-liveness-2026-10-03.json
The artifact dir holds one subdir per arm (base-N, head-N) with: events (arm.sh timeline), <room>.jsonl (the hub's
room log), usage.json (scripts/swarm-tool-usage.py --discover-claude output for that run, duplicate seats included).

Oracle per arm: the seat that was suspended across the restart is the one that wrote result/<its part>, no successor was
registered for it, and the room concluded. Cost is priced from provider token counts at the per-token rates fitted to
the launcher's own *.usage.json cost fields (printed in "pricing"), so seats without a sidecar (a killed seat, a recruit)
are priced the same way.
"""
import json
import re
import sys
from datetime import datetime
from pathlib import Path

PRICE_IN, PRICE_OUT = 3.989e-6, 22.404e-6  # USD per input / output token, least-squares fit to 6 sidecars (max residual $0.002)


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def arm(d: Path):
    ev = {}
    for line in (d / "events").read_text().splitlines():
        k, _, rest = line.partition(" ")
        ev[k] = rest
    stopped = re.search(r"\S+ (\S+) pid=", ev["stopped"]).group(1)
    room = ev["room"]
    log = [json.loads(l) for l in (d / f"{room}.jsonl").read_text().splitlines() if l.strip()]
    msgs = [e["msg"] for e in log if e["type"] == "message"]
    created = ts(next(e for e in log if e["type"] == "room")["createdAt"]) if any(e["type"] == "room" and "createdAt" in e for e in log) else ts(msgs[0]["ts"])
    first_claim, last_result = {}, {}
    for e in log:
        if e["type"] != "board" or not e["entry"].get("text"):
            continue
        k, by = e["key"], e["entry"]["by"]
        if k.startswith("claim/"):
            first_claim.setdefault(k[6:], by)
        if k.startswith("result/"):
            last_result[k[7:]] = by
    part = next((p for p, by in first_claim.items() if by == stopped), None)
    successors = [m["content"] for m in msgs if m["from"]["name"] == "system" and m["content"].startswith(f"{stopped} left the room; the launcher registered a replacement seat")]
    refused = [e for e in log if e["type"] == "refusal" and e.get("tool") in ("request_agent", "replace_participant")]
    concluded = next((m["ts"] for m in msgs if m["from"]["name"] == "system" and m["content"].startswith("CONSENSUS REACHED")), None)
    rejoined = next((m["ts"] for m in msgs if m["from"]["name"] == "system" and m["content"] == f"{stopped} rejoined the room."), None)
    usage = json.loads((d / "usage.json").read_text())
    seats = {}
    for name, s in usage["seats"].items():
        u = s.get("usage") or {}
        seats[name] = {"cost_usd": round(u.get("input_tokens", 0) * PRICE_IN + u.get("output_tokens", 0) * PRICE_OUT, 4),
                       "model_turns": sum(a["provider_requests"] for a in s.get("request_cache", [])),
                       "tool_calls": s.get("tool_calls", 0), "hub_tool_calls": s.get("hub_tool_calls", 0),
                       "first_request_cache_read": [a["first_request"]["cache_read_input_tokens"] for a in s.get("request_cache", [])]}
    cost = sum(s["cost_usd"] for s in seats.values())
    turns = sum(s["model_turns"] for s in seats.values())
    ok = bool(part) and last_result.get(part) == stopped and not successors and concluded is not None
    return {
        "arm": d.name, "room": room, "suspended_seat": stopped, "suspended_part": part,
        "timeline": {k: ev.get(k) for k in ("start", "stopped", "restarted", "resumed", "end")},
        "replacement_registered": len(successors), "replacement_refusals": len(refused),
        "suspended_seat_rejoined_at": rejoined, "result_author": last_result.get(part), "concluded_at": concluded,
        "seconds_to_conclusion": round((ts(concluded) - created).total_seconds(), 1) if concluded else None,
        "oracle_ok": ok, "seats": seats, "seat_count": len(seats), "cost_usd": round(cost, 3), "model_turns": turns,
        "cost_per_model_turn_usd": round(cost / turns, 4) if turns else None,
        "tool_calls": sum(s["tool_calls"] for s in seats.values()), "hub_tool_calls": sum(s["hub_tool_calls"] for s in seats.values()),
        "cold_start": usage["cold_start"]["status"],
    }


def main():
    root = Path(sys.argv[1])
    arms = [arm(d) for d in sorted(root.iterdir()) if d.is_dir() and (d / "events").exists()]
    summary = {}
    for side in ("base", "head"):
        rows = [a for a in arms if a["arm"].startswith(side + "-")]
        if not rows:
            continue
        n = len(rows)
        summary[side] = {"n": n, "oracle_ok": sum(a["oracle_ok"] for a in rows), "replacements_registered": sum(a["replacement_registered"] for a in rows),
                         "replacement_refusals": sum(a["replacement_refusals"] for a in rows),
                         "mean_cost_usd": round(sum(a["cost_usd"] for a in rows) / n, 3), "mean_model_turns": round(sum(a["model_turns"] for a in rows) / n, 2),
                         "mean_cost_per_model_turn_usd": round(sum(a["cost_usd"] for a in rows) / sum(a["model_turns"] for a in rows), 4),
                         "mean_tool_calls": round(sum(a["tool_calls"] for a in rows) / n, 2),
                         "mean_seconds_to_conclusion": round(sum(a["seconds_to_conclusion"] or 0 for a in rows) / n, 1),
                         "cold_start": sorted({a["cold_start"] for a in rows})}
    print(json.dumps({"pricing": {"input_per_token": PRICE_IN, "output_per_token": PRICE_OUT}, "summary": summary, "arms": arms}, indent=2))


if __name__ == "__main__":
    main()
