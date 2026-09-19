#!/usr/bin/env bash
# Regime sentinel for the arm-B/C pilot: single-agent arm-A runs on the same task, run alongside it, so a
# thinking-budget shift shows up as a within-role change (paper/amendments.md, 2026-09-19 regime shift).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=bench/results/rq1-arm-b-pilot-sentinel
mkdir -p "$ROOT"
for SEED in 401 402 403 404 405; do
  D="$ROOT/stamp-interpreter-A-seed$SEED"
  [ -d "$D" ] || node --import tsx scripts/bench-rq1.ts tasks/stamp-interpreter A "$SEED" --root "$D" --model sonnet --max-budget-usd 0.6 --deadline-ms 300000
done
echo done
