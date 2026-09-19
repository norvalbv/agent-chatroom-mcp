#!/usr/bin/env bash
# Diagnostic arm-B-vs-arm-C pilot (claim/arm-b-run-and-stats): stamp-interpreter, seeds 401-405,
# B and C interleaved per seed so both are measured in the same window. Not a replacement for a
# full grid; n=5/arm has essentially no power (see evidence/power-and-inference for the n=12 case,
# which is already too small to show equivalence). Results go to bench/results/rq1-arm-b-pilot,
# never bench/results/rq1-suite or rq1-arm-k.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=bench/results/rq1-arm-b-pilot
PORT_BASE=19910
mkdir -p "$ROOT"
LOG=logs/rq1-arm-b-pilot.log
mkdir -p logs
: > "$LOG"
TOTAL=0
for SEED in 401 402 403 404 405; do
  PORT=$((PORT_BASE + SEED))
  BDIR="$ROOT/stamp-interpreter-B-seed$SEED"
  CDIR="$ROOT/stamp-interpreter-C-seed$SEED"
  if [ ! -d "$BDIR" ]; then
    echo "[run] B seed$SEED" | tee -a "$LOG"
    node --import tsx scripts/bench-rq1.ts tasks/stamp-interpreter B "$SEED" --root "$BDIR" --model sonnet --deadline-ms 900000 2>&1 | tee -a "$LOG"
  fi
  if [ ! -d "$CDIR" ]; then
    echo "[run] C seed$SEED" | tee -a "$LOG"
    node --import tsx scripts/bench-rq1.ts tasks/stamp-interpreter C "$SEED" --root "$CDIR" --model sonnet --port "$PORT" --deadline-ms 900000 2>&1 | tee -a "$LOG"
  fi
done
echo "done" | tee -a "$LOG"
