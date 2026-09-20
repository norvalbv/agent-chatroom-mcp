#!/usr/bin/env bash
# One line per table/figure generator. paper/regen.sh sources this file and runs
# each line from the repo root, then checks that nothing under paper/tables,
# paper/figures or paper/generated changed. Append your own script's invocation
# here when you land it (claim/results-stats, claim/figures); do not remove another
# owner's line without checking with them first.
set -euo pipefail

node --import tsx scripts/paper-rq1-table.ts bench/results/rq1-suite --out bench/results/rq1-suite/rq1-table
node --import tsx scripts/paper-rq1-armk.ts bench/results/rq1-suite bench/results/rq1-arm-k --out bench/results/rq1-arm-k/rq1-armk-table

# --- claim/results-stats (sonnet-1): append your generator invocation below ---
node --import tsx scripts/paper-rq1-family.ts bench/results/rq1-suite bench/results/rq1-arm-k --out paper/generated/rq1-family-table
node --import tsx scripts/paper-rq1-tex.ts bench/results/rq1-suite bench/results/rq1-arm-k --out-dir paper/tables

# --- claim/figures (sonnet-4): append your generator invocation(s) below ---
node --import tsx scripts/paper-fig-data.ts bench/results/rq1-suite bench/results/rq1-arm-k --out paper/generated/fig-data.json
node --import tsx scripts/paper-fig-tables.ts paper/generated/fig-data.json paper/tables
python3 scripts/paper-fig.py paper/generated/fig-data.json paper/figures
node --import tsx scripts/paper-account-regime.ts bench/results/account-switch-log/switches.json bench/results --out paper/generated/account-regime > /dev/null
