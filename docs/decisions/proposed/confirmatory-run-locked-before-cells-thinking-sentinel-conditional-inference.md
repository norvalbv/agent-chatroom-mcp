# Proposed decision: confirmatory-run-locked-before-cells-thinking-sentinel-conditional-inference

From swarm-191130-twok (concluded); report: swarms/swarm-191130-twok/report.md. A human promotes this into docs/decisions/ with `guard-decisions add`; nothing is adopted automatically.

DECISION RECORD** (for `guard-decisions add`)

- **slug:** `confirmatory-run-locked-before-cells-thinking-sentinel-conditional-inference`
- **context:** The paper's closing five-arm run needed an interleaved, effort-pinned, pre-registered design. The seed-901 pilot showed the draft output-token regime cutoff mislabelled a correct short-thinking printf run (4180 output / 888 thinking) as long-thinking. That would have removed the whole printf family from the primary tests. Effort levels were also not separable in the short regime (medium 1006 vs high 1164 thinking tokens, n=3, overlapping). A stratum defined by arm A's own post-run thinking was shown to conditionally inflate A-vs-other Fisher tests.
- **ruling:** Effort is pinned through a workspace-root `.claude/settings.json` in a per-run git root. The within-seed order is a left rotation of [A, AH, B, K, C] by (seed−501) mod 5. A and AH get flat runaway caps, K is fixed-k and needs no C result, and timeouts are data. The regime is read from arm A's direct thinking tokens (<4000 calibrated, ≥4000 long, missing or invalid unknown) by one shared function used by both grid and report. Inference is Fisher with Holm over a fixed m=14, and the calibrated-stratum tests are labelled conditional associations. The pre-registration is committed before any 501–520 cell.
- **consequences:** Regime flips cannot separate arms. Unknown spend halts the grid instead of being summed as zero. Grid and report cannot drift on the sentinel rule. Non-significance is never written as equality (power table included).
- **tradeoff:** The effort manipulation may be a null in the short regime, so AH-vs-A tests a label. The calibrated-stratum tests give up causal claims (no independent pre-run sentinel). The confirmatory run costs about $59 to $235.
- **researched:** No new external sources this run (no arXiv or URLs fetched); work used only repo files and the SETTLED AXES. Nothing is NEW relative to the list.
- **rejected:**
  - Output-token regime cutoff: loses on task-independence (pilot evidence).
  - Per-task rolling min/max band: loses on being learned from confirmatory outcomes.
  - C-first ordering, and A's C-matched budget: lose on the requirement that every arm rotate within a seed.
  - Pooling regimes: loses on the owner's rule that regimes are reported split.
  - Dropping the selection caveat: loses on the exact null counterexample (p ≈ .139 of a spurious Holm-significant contrast).
- **revisit-when:** An independent pre-run sentinel exists (for example, a separate calibration probe per seed), or a real long-thinking run shows medium and high thinking tokens separate, or the observed calibrated-stratum share of seeds falls below about 50%.
- **RE-TARGET:** none. This ratifies `measure-task-success-on-a-machine-oracle` and `done-means-independently-verified` without contradicting any settled axis.
