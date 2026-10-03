#!/usr/bin/env python3
"""Extract the harness follow-up's numeric snapshot from committed measurements."""
import hashlib
import json
from pathlib import Path
from statistics import mean
import subprocess

ROOT = Path(__file__).resolve().parent.parent
commits, hashes = {}, {}


def source(path):
    # Read Git, not the working file: uncommitted measurements cannot enter the paper.
    data = subprocess.check_output(["git", "show", f"HEAD:{path}"], cwd=ROOT)
    commits[path] = subprocess.check_output(
        ["git", "log", "-1", "--format=%H", "HEAD", "--", path], cwd=ROOT, text=True
    ).strip()
    hashes[path] = hashlib.sha256(data).hexdigest()
    return json.loads(data)


history = source("docs/measurements/harness-tool-usage-2026-10-03.json")
traces = source("docs/measurements/harness-tool-traces-2026-10-03.json")
consensus = {
    "interpretation": "Single pair, both task oracles pass; candidate vote already in flight, so no causal latency/cost/autonomy claim."
}
for arm in ("base", "head"):
    row = source(f"docs/measurements/consensus-action-{arm}-valid.json")
    consensus[arm] = {
        key: row[key] for key in (
            "sourceCommit", "room", "providerRequests", "agentToolCalls", "agentHubCalls",
            "costUSD", "costPerProviderRequestUSD", "timeToConclusionMs", "amendToVoteMs",
            "outcome", "coldAudit", "causalLatencySupported",
        )
    }
    consensus[arm]["time_to_conclusion_seconds"] = row["timeToConclusionMs"] / 1000
    consensus[arm]["amend_to_vote_seconds"] = row["amendToVoteMs"] / 1000

directory = source("docs/measurements/room-directory-2026-10-03.json")
directory_result = {
    key: directory[key] for key in ("decision", "summary", "rows", "limitations", "cache_regime", "order")
}
directory_result["relative_mean_cost_change"] = (
    directory["summary"]["head"]["cost_usd"] / directory["summary"]["base"]["cost_usd"] - 1
)
directory_result["limitations"] = [*directory_result["limitations"],
    "First candidate verifier joined first, adding Final answer prefix to persisted topic; all launched task/plan briefs identical. Driver wall time retained as recorded, not independently re-derived."]

recruit_rows = []
for arm, names in (("base", ("base2", "base3", "base4")), ("head", ("head1", "head2", "head3"))):
    for name in names:
        row = source(f"docs/measurements/recruit-policy-{name}.json")
        recruit_rows.append({
            "arm": arm, "room": row["room"], "cost_usd": row["usage"]["cost_usd"],
            **{key: row[key] for key in (
                "model_turns", "cost_per_model_turn_usd", "tool_calls", "hub_tool_calls",
                "time_to_conclusion_seconds", "cold_start",
            )},
            "strict_oracle": row["score"]["oracle"],
            "post_hoc_facts_correct": row["supplemental_json_head_fact_check"],
            "recruit_attempts": row["score"]["recruit_attempts"],
        })
recruit_summary = {}
for arm in ("base", "head"):
    rows = [row for row in recruit_rows if row["arm"] == arm]
    recruit_summary[arm] = {
        key: mean(row[key] for row in rows) for key in (
            "cost_usd", "model_turns", "tool_calls", "hub_tool_calls", "time_to_conclusion_seconds",
        )
    }
    recruit_summary[arm].update({
        "aggregate_cost_per_model_turn_usd": sum(row["cost_usd"] for row in rows) / sum(row["model_turns"] for row in rows),
        "runs": len(rows), "strict_oracle_passes": sum(row["strict_oracle"] for row in rows),
        "post_hoc_factual_passes": sum(row["post_hoc_facts_correct"] for row in rows),
        "recruit_attempts": sum(row["recruit_attempts"] for row in rows),
    })

breakouts = source("docs/measurements/breakouts-2026-10-03/summary.json")
cost_receipts = source("docs/measurements/breakouts-2026-10-03/cost-state-extracts.json")
for row in breakouts["runs"]:
    receipts = [receipt for receipt in cost_receipts
                if (receipt["pair"], receipt["arm"]) == (row["pair"], row["arm"])]
    expected = {(trace["trace"], trace["sha256"]) for trace in row["traces"]}
    observed = {(receipt["trace"], receipt["trace_sha256"]) for receipt in receipts}
    if observed != expected or len(receipts) != len(expected):
        raise ValueError(f"Incomplete or duplicate cost receipts: {row['arm']} pair {row['pair']}")
    costs = [receipt["cost_state"].get("totalCostUSD") for receipt in receipts]
    known = all(receipt["cost_state"].get("hasUnknownModelCost") is False for receipt in receipts)
    row["source_summary_cost_usd"] = row["cost_usd"]
    row["cost_usd"] = sum(costs) if known and all(type(cost) in (int, float) for cost in costs) else None
    row["cost_per_turn"] = row["cost_usd"] / row["model_turns"] if row["cost_usd"] is not None else None
breakout_summary = {}


def complete_mean(rows, key):
    values = [row.get(key) for row in rows]
    return mean(values) if values and all(type(value) in (int, float) for value in values) else None


for arm in ("base", "head"):
    rows = [row for row in breakouts["runs"] if row["arm"] == arm]
    breakout_summary[arm] = {
        key: complete_mean(rows, key)
        for key in ("cost_usd", "model_turns", "hub_tool_calls", "all_tool_calls", "minutes")
    }
    breakout_summary[arm].update({
        "runs": len(rows), "main_oracle_passes": sum(row["ok"] for row in rows),
        "anywhere_oracle_passes": sum(row["anywhere_ok"] for row in rows),
        "aggregate_cost_per_model_turn_usd": (
            sum(row["cost_usd"] for row in rows) / sum(row["model_turns"] for row in rows)
            if breakout_summary[arm]["cost_usd"] is not None else None
        ),
    })
breakout_summary["relative_mean_cost_change"] = (
    breakout_summary["head"]["cost_usd"] / breakout_summary["base"]["cost_usd"] - 1
    if all(breakout_summary[arm]["cost_usd"] is not None for arm in ("base", "head")) else None
)
liveness = source("docs/measurements/away-seat-liveness-2026-10-03.json")
unprompted = source("docs/measurements/breakouts-unprompted-2026-10-03/summary.json")
unprompted_receipts = source("docs/measurements/breakouts-unprompted-receipts-2026-10-03.json")
unprompted_builds = source("docs/measurements/breakouts-unprompted-build-audit-2026-10-03.json")
delivery = source("docs/measurements/breakouts-unprompted-delivery-2026-10-03.json")
receipts_by_run = {row["run"]: row for row in unprompted_receipts}
delivery_by_run = {row["run"]: row for row in delivery}
run_ids = {row["run"] for row in unprompted["runs"]}
if not (run_ids == set(receipts_by_run) == set(delivery_by_run)):
    raise ValueError("Unprompted trial coverage differs across committed sources")
unprompted_rows = []
for row in unprompted["runs"]:
    receipt, exposure = receipts_by_run[row["run"]], delivery_by_run[row["run"]]
    expected = {(trace["trace"], trace["sha256"]) for trace in row["traces"]}
    observed = {(Path(seat["trace"]).name, seat["sha256"]) for seat in receipt["seats"]}
    if expected != observed or len(receipt["seats"]) != len(expected):
        raise ValueError(f"Unprompted receipt roster mismatch: {row['run']}")
    if receipt["provider_requests"] != row["model_turns"]:
        raise ValueError(f"Unprompted turn mismatch: {row['run']}")
    unprompted_rows.append({
        "arm": row["arm"], "run": row["run"], "cost_usd": receipt["cost_usd"],
        "model_turns": receipt["provider_requests"], "tool_calls": receipt["tool_calls"],
        "hub_tool_calls": row["hub_tool_calls"], "minutes": row["minutes"],
        "registered_oracle": row["ok"], "corrected_factual_oracle": row["ok_corrected"],
        "breakout_formed": exposure["breakout_formed"], "rooms_opened": exposure["rooms_opened"],
        "seconds_to_two_session_split": exposure["seconds_to_two_session_split"],
        "registered_peer_worker_proxy": row["delivered_cross_claim"],
        "claim_aware_delivery": exposure["seats"], "coverage": exposure["coverage"],
    })
unprompted_summary = {}
for arm in ("orig-31daae67", "base-ed66a491", "head-679ddc55"):
    rows = [row for row in unprompted_rows if row["arm"] == arm]
    unprompted_summary[arm] = {
        key: complete_mean(rows, key)
        for key in ("cost_usd", "model_turns", "tool_calls", "hub_tool_calls", "minutes")
    }
    unprompted_summary[arm].update({
        "runs": len(rows), "breakouts_formed": sum(row["breakout_formed"] is True for row in rows),
        "registered_oracle_passes": sum(row["registered_oracle"] for row in rows),
        "corrected_factual_oracle_passes": sum(row["corrected_factual_oracle"] for row in rows),
        "aggregate_cost_per_model_turn_usd": sum(row["cost_usd"] for row in rows) / sum(row["model_turns"] for row in rows),
        "seats_with_unknown_cross_claim_reads": sum(
            seat["cross_claim_reads"] is None for row in rows for seat in row["claim_aware_delivery"]),
    })

result = {
    "generator": "python3 scripts/paper-harness-results.py",
    "scope": "Descriptive historical census and separate exploratory task trials; not pooled across tasks.",
    "source_commits": commits, "source_sha256": hashes,
    "coverage": history["coverage"], "completed_room_bound_calls": history["aggregate"]["calls"],
    "selected_tools": {key: history["aggregate"]["tools"][key] for key in (
        "request_agent", "kick_vote", "replace_participant", "post_to_room", "board_get", "board_set", "wait_for_messages",
    )},
    "historical_trace_slice": {
        "files": sum(run["trace_count"] for run in traces["runs"]),
        "hub_calls": sum(run["hub_calls"] for run in traces["runs"]),
        "list_rooms_calls": sum(seat["tools"].get("list_rooms", 0) for run in traces["runs"] for seat in run["seats"]),
    },
    "consensus_action": consensus, "room_directory": directory_result,
    "recruitment_policy": {
        "rows": recruit_rows, "summary": recruit_summary,
        "scope": "Pre-action factual lookup under dry spawning and caching disabled; supplemental fact check is post-hoc and does not replace strict oracle.",
    },
    "breakouts": {
        "summary": breakout_summary, "runs": breakouts["runs"],
        "scope": "Forced split with two initial seats per arm; additional baseline recruits are included. Main-room placement oracle differs from finding answers somewhere. Per-run conclusion minutes are rounded in the source.",
    },
    "away_seat_liveness": {
        "summary": liveness["summary"], "cost_source": liveness["cost_source"],
        "scope": "Reported provider cost-state receipts cover all recorded seats. Baseline originals were stopped after conclusion; their unfinished rejoin work is omitted. Head still attempted replacement four times; refusal prevented duplicates.",
    },
    "unprompted_breakouts": {
        "summary": unprompted_summary, "runs": unprompted_rows,
        "build_provenance": unprompted_builds, "comparisons": unprompted["comparisons"],
        "scope": "No room opened in nine short three-seat runs. Frozen factual oracle contained a wrong q2 key; corrected scores are post-hoc, and neither scores judgment quality. Claim attribution is unknown for every seat; registered worker-line delivery is a different proxy. Prelaunch build hashes retain their recorded 16-hex precision.",
    },
}
destination = ROOT / "paper/generated/harness-affordances.json"
destination.write_text(json.dumps(result, indent=2) + "\n")
print(destination.relative_to(ROOT))
