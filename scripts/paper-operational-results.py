#!/usr/bin/env python3
"""Derive the operational paper's numeric source from its retained measurements."""
import hashlib
import json
from pathlib import Path
import re
from statistics import median

ROOT = Path(__file__).resolve().parent.parent
sources = {}


def source(path):
    data = (ROOT / path).read_bytes()
    sources[path] = hashlib.sha256(data).hexdigest()
    return data.decode()


def load(path):
    return json.loads(source(path))


def change(before, after):
    return after / before - 1


replay = load("docs/output-size-2026-10-03.json")["replay"]
output = dict(zip(replay["columns"], replay["totals"]))
output["bytes_reduction"] = -change(output["bytes_before"], output["bytes_final"])
output["proxy_tokens_reduction"] = -change(output["proxy_tokens_before"], output["proxy_tokens_final"])

router = load("docs/measurements/openrouter-steering-2026-10-03.json")
router_result = {}
for arm in ("before", "after"):
    router_result[arm] = dict(router["aggregate"][arm])
    router_result[arm]["median_reply_seconds"] = median(
        run["mention_to_reply_ms"] / 1000 for run in router["arms"][arm]
    )
    router_result[arm]["combined_bytes"] = (
        router_result[arm]["tool_response_bytes"] + router_result[arm]["steering_context_bytes"]
    )
router_result["relative_change"] = {
    key: change(router_result["before"][key], router_result["after"][key])
    for key in ("prompt_tokens", "combined_bytes", "wall_ms")
}

contract = source("docs/experiments/2026-10-03-steering-contract.md")
contract_result = {"precision": "Parsed from the published rounded component table; not raw billing precision."}
for arm in ("base", "head"):
    row = next(line for line in contract.splitlines() if line.startswith(f"| {arm}, 3 mentions |"))
    cells = [cell.strip() for cell in row.split("|")[1:-1]]
    latencies = [float(value) for value in re.findall(r"\d+\.\d+", cells[2].split("(")[0])]
    contract_result[arm] = {
        "median_reply_seconds": median(latencies),
        "reported_cost_usd": float(cells[5].removeprefix("$")),
        "cache_read_tokens": int(cells[6].replace(",", "")),
        "output_tokens": int(cells[7].replace(",", "")),
    }
contract_result["relative_cost_change"] = change(
    contract_result["base"]["reported_cost_usd"], contract_result["head"]["reported_cost_usd"]
)

wait = load("docs/bench-wait-view-2026-10-03/historical-replay.json")
wait["bytes_reduction"] = -change(wait["original_bytes"], wait["candidate_bytes"])

combined = {}
for arm in ("baseline", "head"):
    data = load(f"docs/measurements/swarm-efficiency-final-{arm}.json")
    combined[arm] = {
        "median_reply_seconds": data["reply_replay"]["reply_metrics"]["reply_latency_ms"]["p50"] / 1000,
        "reported_cost_usd": sum(seat["cost"] for seat in data["provider_usage"].values()),
        "hub_calls": data["tool_usage"]["observed_totals"]["hub_tool_calls"],
        "hub_text_bytes": data["tool_usage"]["observed_totals"]["hub_text_bytes"],
    }
combined["relative_cost_change"] = change(
    combined["baseline"]["reported_cost_usd"], combined["head"]["reported_cost_usd"]
)

cross_run = load("docs/measurements/swarm-efficiency-cross-run.json")
cross_result = {}
for name, run in cross_run["runs"].items():
    cross_result[name] = {
        "unread_refusals": run["redundancy_candidates"]["unread_send_refusals"],
        "send_calls": run["tools"]["send_message"]["calls"],
    }
    status = run["tools"].get("room_status")
    if status:
        cross_result[name]["status_share_of_hub_text"] = status["text_bytes"] / run["observed_totals"]["hub_text_bytes"]

result = {
    "generator": "python3 scripts/paper-operational-results.py",
    "source_sha256": sources,
    "output_size": output,
    "openrouter": router_result,
    "claude_three_seat": contract_result,
    "wait_replay": wait,
    "initial_combined": combined,
    "cross_run": cross_result,
}
destination = ROOT / "paper/generated/operational-results.json"
destination.write_text(json.dumps(result, indent=2) + "\n")
print(destination.relative_to(ROOT))
