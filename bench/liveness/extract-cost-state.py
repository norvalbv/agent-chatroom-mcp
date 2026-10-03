#!/usr/bin/env python3
"""Copy each seat's provider cost receipt (the last type=cost-state row of its raw Claude trace) next to the arm's
committed artifacts, so collect.py prices every seat, recruits and stopped seats included, from receipts, not tokens.

Usage: bench/liveness/extract-cost-state.py <artifact dir> [--projects $CLAUDE_CONFIG_DIR/projects]
Reads <arm>/usage.json (trace_sources, trace_sha256) and writes <arm>/cost-state.json.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("root", type=Path)
parser.add_argument("--projects", type=Path, default=Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude")) / "projects")
args = parser.parse_args()
for arm in sorted(p for p in args.root.iterdir() if (p / "usage.json").exists()):
    usage = json.loads((arm / "usage.json").read_text())
    out = {}
    for seat, entry in usage["seats"].items():
        for source in entry["trace_sources"]:
            paths = list(args.projects.glob(f"*/{source}"))
            if len(paths) != 1:
                raise SystemExit(f"{arm.name} {seat}: {len(paths)} traces named {source}")
            raw = paths[0].read_bytes()
            if hashlib.sha256(raw).hexdigest() != entry["trace_sha256"][source]:
                raise SystemExit(f"{arm.name} {seat}: {source} no longer matches its recorded sha256")
            rows = [json.loads(l) for l in raw.decode().splitlines() if l.strip().startswith("{") and '"cost-state"' in l]
            last = [r for r in rows if r.get("type") == "cost-state"][-1]
            out[seat] = {"source": source, "trace_sha256": entry["trace_sha256"][source], "totalCostUSD": last["totalCostUSD"], "hasUnknownModelCost": last.get("hasUnknownModelCost")}
    (arm / "cost-state.json").write_text(json.dumps(out, indent=2) + "\n")
    print(arm.name, round(sum(v["totalCostUSD"] for v in out.values()), 6))
