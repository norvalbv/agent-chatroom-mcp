#!/usr/bin/env bash
# Run the remaining self-improvement batches back to back (36 seats each fits the model's
# 100 req/min), then consolidate every batch's summary into one consensus.
# Usage: OPENROUTER_API_KEY=... fleet/run-batches.sh <first-fleet-summary.md> [wait-for-pid]
set -u
cd "$(dirname "$0")/.."
FIRST="$1"; WAIT_PID="${2:-}"
MODEL="${MODEL:-deepseek/deepseek-v4-flash-0731}"
if [ -n "$WAIT_PID" ]; then while kill -0 "$WAIT_PID" 2>/dev/null; do sleep 30; done; fi
SUMMARIES="$FIRST"
newest() { ls -td swarms/fleet-*/ | head -1; }
run_batch() {
  echo "[$(date +%H:%M:%S)] batch: $1"
  node dist/fleet.js fleet/self-improvement.json --model "$MODEL" --agents 12 --timeout 50 --stagger 20 --only "$1" --cwd "$PWD"
  local d; d="$(newest)"; [ -f "$d/summary.md" ] && SUMMARIES="$SUMMARIES,$d/summary.md"
  sleep 60  # let the provider's window clear before the next 36 seats
}
run_batch launcher,prompts,ui
run_batch research-debate,testing
run_batch research-coordination,telemetry
echo "[$(date +%H:%M:%S)] final batch + consolidation over: $SUMMARIES"
node dist/fleet.js fleet/self-improvement.json --model "$MODEL" --agents 12 --timeout 50 --stagger 20 --only safety,human --consolidate --consolidate-from "$SUMMARIES" --cwd "$PWD"
echo "[$(date +%H:%M:%S)] all batches done"
