# Arm-C process-trace audit

This note records a zero-model-spend audit of the committed RQ1 arm-C artifacts. It is
diagnostic evidence for choosing the next experiment, not a causal result about any hub
mechanic.

## Falsifier fixed before inspection

If the committed arm-C artifacts contained no reproducible signal of disagreement followed
by correction beyond final agreement, they would not justify prioritising RQ2 or RQ3 from a
mechanism story; the next spend should instead go to admitting another task family.

## Research motivation

[arXiv:2510.20963](https://arxiv.org/abs/2510.20963), *When and Why Does
Multi-Agent Debate Fail and Does It Really Underperform?*, distinguishes consensus-seeking
debate, which can discard informative disagreement, from collaborative debate that surfaces
missing evidence and verifies claims. This motivates measuring disagreement-to-correction
transitions rather than treating consensus itself as evidence that deliberation helped.

## Committed evidence

The 120 files under `bench/results/rq1-suite/*-C-seed*/result.json` do not retain the raw hub
JSONL or room transcript. They retain one final free-text summary per seat. Searching those
summaries for explicit first-answer/opening corrections, followed by manual checks of the
matched examples, gives conservative lower bounds. The reported 26 and 14 are manual tallies,
not the output of a single regex: the summaries use non-standard prose, so search terms were
used to find candidates and each candidate was then read against the narrow criteria below.

- `stamp-interpreter`: at least 26 of 40 runs explicitly report that an opening or first trace
  contained the known `101`-versus-`100` scope error and that another seat corrected it.
- `stamp-2`: at least 14 of 40 runs explicitly report an opening disagreement or correction on
  the `1027 1008` versus `3007 3005` scope trap.

All 80 arm-C runs on those two tasks passed. These counts are lower bounds over non-standard,
self-reported summaries, not estimates of a latent correction rate. Representative artifacts
are `stamp-interpreter-C-seed102`, `stamp-interpreter-C-seed107`,
`stamp-interpreter-C-seed108`, and `stamp-2-C-seed129`.

The evidence does not identify the challenge gate as the cause. In the named examples,
summaries attribute correction to another seat's scope explanation; some call the later
challenge procedural, and seed 129 describes correction before proposal. Because the raw room
events are absent, challenge, amendment, and verification effects cannot be reconstructed
reliably from the committed artifacts.

## Consequence for the next experiment

RQ2's pre-registered arm B (builder output followed by a reviewer and at most one revision)
matches the correction path visible in the retained evidence and is therefore the first causal
comparison to run. A challenge-off RQ3 pilot should not be interpreted mechanistically unless
future harness artifacts persist structured opening, proposal, challenge, revision, and final
answer transitions.
