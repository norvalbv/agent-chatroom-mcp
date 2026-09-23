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
node --import tsx scripts/paper-account-regime.ts bench/results/account-switch-log/switches.json bench/results --out paper/generated/account-regime --tex paper/tables/account-regime.tex > /dev/null

# --- claim/confirmatory-results-integration-takeover (5-6-sol-1) ---
node --import tsx scripts/paper-account-regime.ts --mixed-seeds bench/results/account-switch-log/switches.json bench/results/rq1-confirmatory 4 > bench/results/rq1-confirmatory/mixed-seeds.json
node --import tsx scripts/paper-rq1-confirmatory.ts bench/results/rq1-confirmatory --mixed-seeds bench/results/rq1-confirmatory/mixed-seeds.json --out paper/generated/rq1-confirmatory --tex paper/tables/rq1-confirmatory.tex > /dev/null

node --import tsx scripts/paper-verify-practice.ts bench/results/verify-practice/heads.jsonl bench/results/verify-practice/rooms.json bench/results/verify-practice/labels.json --out paper/generated/verify-practice --tex paper/tables/verify-practice.tex
node --import tsx scripts/paper-review-audit.ts bench/results/review-audit/audit-2026-09-23.json --out paper/generated/review-audit --tex paper/tables/review-audit.tex
python3 scripts/paper-fig-review.py paper/generated paper/figures
