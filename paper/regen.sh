#!/usr/bin/env bash
# Regenerates every table and figure this paper cites (per the commands in
# paper/regen-manifest.sh) and fails if anything under bench/results/, paper/tables/,
# paper/figures/ or paper/generated/ changes as a result -- i.e. what main.tex includes
# must already equal what the generators produce from committed inputs.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "[regen] running paper/regen-manifest.sh ..." >&2
bash paper/regen-manifest.sh

echo "[regen] diffing generated paths against the working tree ..." >&2
# --ignore-blank-lines tolerates a trailing-newline-only difference (a pre-existing,
# content-free artifact of scripts/paper-rq1-armk.ts predating this room); any real
# numeric or textual change still fails the check.
if ! git diff --exit-code --ignore-blank-lines -- bench/results paper/tables paper/figures paper/generated; then
  echo "FAIL: regeneration changed committed output beyond blank lines. main.tex would cite stale numbers." >&2
  exit 1
fi
DIRTY_TRACKED="$(git diff --name-only -- bench/results paper/tables paper/figures paper/generated)"
if [[ -n "$DIRTY_TRACKED" ]]; then
  git checkout -- $DIRTY_TRACKED
fi

echo "[regen] auditing numbers typed into paper/sections/*.tex ..." >&2
node --import tsx scripts/paper-number-audit.ts

echo "OK: every regenerated table/figure matches what is committed." >&2
