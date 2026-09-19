# Pre-registration: confirmatory five-arm run

**Status:** frozen before any confirmatory cell.  The only runs reported below are
calibration and the seed-901 pilot; neither uses a seed in 501–520 and neither is
included in confirmatory inference.  This document is the prospective amendment
to `paper/protocol.md` for this run.  It retains the settled definitions in
`paper/prereg-arm-k.md`, `paper/amendments.md`, and the decision slug
`provenance-before-mechanism-and-a-cheap-pair-is-the-baseline`.

## Design

There are two task families, `stamp-interpreter` and `bench-printf-format`, and
20 fresh bookkeeping seeds per family: 501 through 520.  For every task/seed the
five arms are run back-to-back before the next seed starts:

- **A:** one Claude Sonnet seat at normal (medium) effort.
- **AH:** one Claude Sonnet seat at high effort.
- **B:** the existing no-chat builder then reviewer pipeline, both at medium
  effort.
- **K:** independent medium-effort attempts, `k=10` for stamp-interpreter and
  `k=7` for bench-printf-format, with the already-frozen oracle-free selectors
  in `paper/prereg-arm-k.md`.
- **C:** the three-seat chatroom, all seats at medium effort.

The grid iterates all 20 stamp-interpreter seeds before all 20
bench-printf-format seeds.  It never separates the five arms within a seed, but
a provider-regime boundary between task families remains possible and is handled
by the per-task sentinel strata rather than pooling them.

Every workspace is initialized as its own git root and the harness writes its
workspace-root `.claude/settings.json`; every Claude invocation uses project
settings.  The harness records the settings path/hash and direct terminal
`model_usage` provenance.  This is the implementation consequence of
`token-cost-is-resent-context` and `provenance-before-mechanism-and-a-cheap-pair-is-the-baseline`.

The within-seed order is frozen to the left rotation of `[A, AH, B, K, C]` by
`(seed - 501) mod 5`: seed 501 is `[A, AH, B, K, C]`, 502 is
`[AH, B, K, C, A]`, and so on.  Thus every arm occupies every ordinal position
once per five-seed block.  In confirmatory mode K has its frozen per-attempt cap
and no longer waits for C; the separate paired C and K result artifacts are
reported together after both cells exist (the K `matched_from` field is not
backfilled).  This makes the rotation possible without changing K's selector.

A and AH have the nonbinding runaway limits `--max-budget-usd 0.30` and
`--deadline-ms 150000`; neither limit bound in the earlier 240 attempts.  B and
C complete naturally; K retains its frozen `$0.30` / 150 s *per-attempt* limits.
All launched cells remain in their assigned denominator.  A non-`task_pass`
outcome is a failure, including timeout, parser and infrastructure outcomes;
the outcome type remains visible.  A completed K group follows its pre-existing
null-vote rule.  A result-less launch or unknown cost halts a capped grid rather
than being valued at zero.  This is an explicit, prospective denominator
override to protocol §4 for this five-arm run.

## Effort calibration and regime sentinel

Before this pre-registration, 12 real `stamp-interpreter` arm-A attempts in the
actual nested workspace layout ran at seeds 901–903.  Values below are per run;
cost is USD/run.  The settings were read by the seat, but this short-regime
sample does **not** demonstrate a strong medium/high separation.
The calibration table is transcribed from its run logs; its raw result files
were not retained.  In contrast, the seed-901 pilot result files and grid log
are committed as auditable evidence.

| requested effort | n | pass | mean output tokens | thinking tokens (individual; mean) | mean cost |
|---|---:|---:|---:|---|---:|
| none | 3 | 2/3 | 1,737 | 915, 1,034, 1,278; 1,076 | 0.059 |
| low | 3 | 3/3 | 1,419 | 858, 887, 934; 893 | 0.047 |
| medium (**normal**) | 3 | 2/3 | 1,497 | 898, 918, 1,201; 1,006 | 0.048 |
| high (**AH**) | 3 | 2/3 | 1,651 | 1,115, 1,150, 1,227; 1,164 | 0.050 |

The confirmed short/long separation from the earlier dated evidence is roughly
0.9–1.3K versus about 10.5K direct thinking tokens.  The pilot below showed why
an output-token cutoff cannot transfer between task families (`printf` A had
4,180 output but only 888 thinking tokens).  Therefore the frozen per-seed A
sentinel, applied to every arm of the paired seed, is:

| A direct thinking provenance | stratum |
|---|---|
| finite and `< 4,000` tokens | calibrated short-thinking |
| finite and `>= 4,000` tokens | long-thinking / outside calibrated regime |
| missing or invalid | unknown |

Raw output tokens are always retained descriptively but never determine this
class, including when missing.  The `3,999/4,000` boundary is regression-tested.
All reporting displays calibrated, long-thinking, unknown, and missing cells;
only calibrated cells supply the primary tests.  Out-of-band and unknown cells
are never silently dropped or pooled.  This pilot-informed amendment is made
before any 501–520 cell.

## Pilot (not confirmatory)

Seed 901, outside the confirmatory range, ran every arm on each task.  All costs
were known, all listed seat exits were zero, and no deadline killed a seat.
Thinking/output for B and C are sums of all terminal seats; K is the sum of all
attempts.  The complete pilot cost was **$2.940826** and its **sum of cell wall
durations** was 547.723 s (not a measured end-to-end grid elapsed time).

| task | arm | outcome | cost USD | thinking tokens | output tokens | wall s | exit codes |
|---|---|---|---:|---:|---:|---:|---|
| stamp-interpreter | A | fail | 0.049260 | 922 | 1,512 | 19.956 | 0 |
| stamp-interpreter | AH | pass | 0.050302 | 927 | 1,611 | 19.732 | 0 |
| stamp-interpreter | B | fail | 0.091781 | 1,972 | 3,014 | 36.535 | 0, 0 |
| stamp-interpreter | K | fail | 0.513972 | 9,942 | 16,817 | 51.473 | ten 0s |
| stamp-interpreter | C | pass | 0.418881 | 3,732 | 10,520 | 65.319 | 0, 0, 0 |
| bench-printf-format | A | fail | 0.081497 | 888 | 4,180 | 43.110 | 0 |
| bench-printf-format | AH | fail | 0.092189 | 689 | 4,661 | 58.230 | 0 |
| bench-printf-format | B | fail | 0.131437 | 1,984 | 5,581 | 63.059 | 0, 0 |
| bench-printf-format | K | fail | 0.595062 | 5,483 | 30,187 | 83.699 | seven 0s |
| bench-printf-format | C | fail | 0.916446 | 3,073 | 23,379 | 106.610 | 0, 0, 0 |

The pilot is feasibility/provenance evidence only.  It establishes neither an
effect nor an effort separation, and it has no role in the denominators,
intervals, tests, or selection of 501–520.

## Confirmatory command and projections

The resumable command is:

```sh
node --import tsx scripts/bench-grid.ts --confirmatory \
  --tasks stamp-interpreter,bench-printf-format --seeds 501-520 \
  --arms A,AH,B,K,C --k stamp-interpreter=10,bench-printf-format=7 \
  --model sonnet --concurrency 5 --results-dir bench/results/rq1-confirmatory \
  --max-cost-usd 74 --port-base 19850
```

At the current pilot regime, simple 20-fold extrapolation is **$58.816520** and
182.574 minutes (3.04 h) of summed cell durations; end-to-end elapsed time can
be higher.  The command's $74 cap is that estimate plus a 25% reserve.  This is
only a planning estimate: the cap is checked between cells, so an in-flight
cell may carry realized spend beyond it; unknown spend halts the grid.

For a long-thinking contingency estimate, the dated window evidence uses stamp
A about $0.20, C $1.4–2.2, K $1.7–2.3, assumes B about $0.50 and AH about
$0.26, and conservatively puts printf at about 1.5 times stamp: about $5 for
stamp plus $7 for printf per seed.  The resulting unmeasured forecast is
**about $235 and 7–8 h** for 20 seeds (about 2.5 times pilot wall time), before
any reserve.  This is a contingency forecast, not a license to pool regimes or
to extend the $74 current-regime run.

## Analysis, falsifiers, and interpretation limits

For each task and arm, the report gives pass rate with Wilson intervals, cost per
correct answer (unknown if any relevant cost is unknown), and thinking tokens per
run.  It directly calls two-sided `fisherExactTest` for the fixed 14-test family:
for each of two tasks, B/C, AH/C, K/C, AH/A, B/A, K/A, and C/A.  It reports raw
and Holm-adjusted p-values side by side; absent comparisons are padded with
`p=1`, preserving conservative `m=14` on partial data rather than shrinking the
family after observing which comparisons are available.

The n=20 power calculations are unadjusted / conservative first-rank
`0.05/14` threshold respectively: (.9,1) 0.0431745 / 0.0004156; (.8,1)
0.3703517 / 0.0321427; (.7,.9) 0.2416792 / 0.0423572; (.5,.8) 0.4094569 /
0.1111630.  The latter is not joint Holm power.  Consequently a non-significant
test is inconclusive, never equality, matching `measure-task-success-on-a-machine-oracle`.

Falsifiers are recorded rather than repaired: an A sentinel outside/unknown
stratum splits reporting; unknown cost halts further capped launch; a cap/deadline
that binds remains outcome data; invalid provenance remains unknown; and a
pre-registered comparison whose adjusted p is not below .05 has not established
a difference.  No equivalence margin or equality conclusion is authorized.

The predictions below are directional/cost predictions, not equivalence tests:
the stamp AH prediction is contradicted if AH has a lower pass rate than C with
Holm-adjusted two-sided Fisher `p < .05`; its “matches” wording cannot be
confirmed or falsified as equality without a predeclared equivalence margin.
The B cost prediction is contradicted if complete-cost B mean cost/run is at
least one third of C mean cost/run.  K “not significantly different” likewise
cannot establish or falsify equality; an adjusted significant K/C difference is
reported as contrary directional evidence, while a non-significant result stays
inconclusive.  The printf no-aggregation prediction is contradicted when any of
B, K, or C has a higher pass rate than A with adjusted `p < .05`.

The maintainer's predictions, recorded verbatim, are:

> "On stamp-interpreter AH matches or beats C at lower cost per correct answer; B is not significantly different from C and costs under a third as much per run; K is not significantly different from C. On bench-printf-format no aggregation arm (B, K, C) beats A; whether AH beats A there is open and I make no prediction."

Room prediction: the pilot does not justify a contrary directional prediction;
it predicts only that the direct-thinking sentinel, provenance, and all-cell
denominator will remain necessary for an interpretable result.
