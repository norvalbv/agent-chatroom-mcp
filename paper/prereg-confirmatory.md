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
sample does **not** demonstrate a strong medium/high separation.  The raw
calibration result files were not retained; this table is transcribed from
the run logs, and the committed seed-901 pilot is the auditable evidence.

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

The A sentinel is measured after A runs; it is not an independently randomized
or pre-run provider-state measurement.  Thus the calibrated-stratum comparisons
condition on A's own realized thinking and are **descriptive conditional
associations**, not causal arm effects or a clean provider-regime control.  A
future causal conditional-effect design would need an independent pre-run
sentinel.  The all-cell and every-stratum tables remain necessary context for
these conditional tests.

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

Selection limitation (frozen before any cell): the regime stratum is read from arm A's own post-run thinking tokens, so stratifying on it conditions on a variable that A's outcome may correlate with (a harder seed may draw more thinking).  Comparisons against A inside the calibrated stratum are therefore conditional associations, not clean causal contrasts.  The number of seeds excluded from each primary comparison is the difference between the total launched and the calibrated-stratum n in the report's per-stratum table, and a comparison against A is not read as a causal effect when that number is non-zero.  Fisher/Holm p-values and the prediction checks below describe the selected conditional sample; they do not establish unconditional or causal arm effects or control error for those claims. An adjusted significant B/K/C-vs-A result is conditional contrary evidence only. Long-thinking and unknown strata are still reported separately, never pooled and never dropped.

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
All such calibrated-stratum prediction scores are conditional associations under
the A sentinel, not causal falsifications of an arm mechanism.

The maintainer's predictions, recorded verbatim, are:

> "On stamp-interpreter AH matches or beats C at lower cost per correct answer; B is not significantly different from C and costs under a third as much per run; K is not significantly different from C. On bench-printf-format no aggregation arm (B, K, C) beats A; whether AH beats A there is open and I make no prediction."

Room prediction: the pilot does not justify a contrary directional prediction;
it predicts only that the direct-thinking sentinel, provenance, and all-cell
denominator will remain necessary for an interpretable result.


## 2026-09-20 00:50 UTC — Deviation for the printf block: runaway caps raised before any further printf cell (maintainer)

**State when written.** The interpreter block is complete (100 cells, seeds 501 to 520, 19 seeds long-thinking
by the sentinel). The first printf cell, arm A seed 501, hit the 150 s runaway deadline at 150573 ms with
usage lost (partial signal: 4 assistant events, 16 output tokens, 18215 cache-creation tokens) and the grid
halted on unknown spend as designed. No other printf cell exists.

**Why the caps are wrong for printf in this regime.** The 0.30 USD / 150 s caps were derived from short-regime
evidence (largest arm-A attempt 0.104 USD, 48 s). In the long-thinking regime the interpreter block's
single-agent cells reached 8.5K output tokens, 0.170 USD and 79 s (arm A) and 16.1K tokens, 0.301 USD and
141 s (arm AH); 1 of 20 AH interpreter cells and 0 of 20 A cells finished within 5 per cent of the
0.30 USD cap, so the cap may already have bound AH there (all 20 AH cells passed regardless). printf output
was about 2.7 times the interpreter's in the short regime (4.6K vs 1.7K tokens per attempt), so a long-regime
printf single attempt is expected to need roughly 0.5 to 0.9 USD and several minutes; the old caps would
turn the block into timeouts.

**Deviation.** For the printf block only: single-attempt caps 1.50 USD and 900 s (about five times the
interpreter AH maxima; 900 s equals the harness's overall per-cell timeout), applied identically to arms A,
AH and every K attempt through the new `--cap-usd` and `--cap-deadline-ms` flags (`scripts/bench-grid.ts`,
tested in `scripts/confirmatory-grid.test.ts`). Arms B and C run to natural completion as before. The
interpreter block is untouched and keeps its 0.30 USD / 150 s caps.

**Inference.** printf inference uses seeds 502 to 520 (19 seeds). Seed 501's arm-A timeout under the old cap
stays on disk and is reported separately as a pre-amendment cell; seed 501's other printf arms are run for
completeness but excluded from the printf comparisons. The interpreter block's AH cells are reported with
the count of cells at the cap.

**Resumable command (printf block):**
`node --import tsx scripts/bench-grid.ts --confirmatory --tasks bench-printf-format --seeds 501-520 --arms A,AH,B,K,C --k bench-printf-format=7 --model sonnet --concurrency 5 --results-dir bench/results/rq1-confirmatory --cap-usd 1.5 --cap-deadline-ms 900000 --max-cost-usd 240 --port-base 19850`
Projection in the long regime: about 5 USD per printf seed (A 0.6, AH 0.9, B 1.2, K 7 x 0.6, C 3), so about
100 USD for 20 seeds, on top of the 66 USD already spent.

**Addendum 2026-09-20 01:00 UTC.** The capped grid refuses to run while any cell in the results directory has
unknown spend, so the pre-amendment cell `bench-printf-format-A-seed501` (timeout, usage lost) was moved
unchanged to `bench/results/rq1-confirmatory-pre-amendment/`. Seed 501's arm A is therefore re-run under
the new caps like the other seed-501 printf arms; all seed-501 printf cells stay outside printf inference.

**Addendum 2026-09-20 01:30 UTC (killed-cell cost accounting).** `bench-printf-format-C-seed503` ran to the
900 s per-cell timeout: its three seats made about 100 hub calls each with under 1.1K output tokens in
total, one proposal, one challenge and two votes, i.e. the room stalled rather than worked. That is a
recorded chatroom failure (outcome `timeout`), kept as data. Its seats kept stream-json partial usage, so the
grid now counts a killed cell whose every seat has partial usage at Sonnet list prices (2.00 / 0.20 / 2.50 /
10.00 USD per million input, cache-read, cache-write and output tokens) times a 1.5 safety factor toward the
cost cap, logged as `[est-cost]`, instead of treating it as unknown and halting. A killed cell with no
partial signal stays unknown and still halts a capped grid. This changes cost accounting only; outcomes,
caps and inference are unchanged. Estimated costs are reported as upper bounds in the cost tables.

## 2026-09-20 08:00 UTC — Provider quota hit mid-block; the "thinking regime" is the subscription account (maintainer)

Written after the printf grid was stopped at 81 printf cells and before any further cell is run.

**What happened.** At 07:43 UTC the Claude subscription account the CLI was logged into reached its
five-hour session limit. The CLI then answers every call with a synthetic assistant message ("You've hit
your session limit · resets 9:30am"), zero tokens, exit 1. The harness scored the untouched workspaces, so
the grid logged provider refusals as `task_fail` for whichever arm came next. The maintainer stopped the
grid (SIGTERM) when the pattern was noticed; the in-flight `B seed517` cell was killed by that signal.

**Invalidation rule (outcome-blind, applied to every confirmatory cell of both blocks).** A cell is invalid
if any of its seats (or, for arm K, any attempt's seat) carries the CLI's synthetic model id `<synthetic>`
together with a limit message, or if the operator killed it. The scan matched nine printf cells and no
interpreter cell: seed 514 A, AH, B, C and seed 515 A, AH, B, C, K. With the operator-killed `B seed517`
they were moved, unchanged, to `bench/results/rq1-confirmatory-quota-invalidated/` (known spend in them:
2.75 USD, which still counts toward the reported total). They are re-run under the registered command.
`K seed514` finished before the limit and stays. No valid cell is re-run.

**Harness fix (same commit as this note).** `bench-rq1.ts` records a quota-refused seat as
`infrastructure_error` even if the workspace would pass; `bench-ak.ts` makes a group with any such attempt
an `infrastructure_error` group (it never got its k attempts); `bench-grid.ts` halts on the first
`infrastructure_error` cell instead of walking the outage through the remaining arms. Tests cover all three,
including a control where a real model merely writes the same words and is still scored.

**The regime is the account.** This machine runs an automatic account switcher for Claude Code
(`claude-swap`, menu-bar mode, strategy consume-first) across several subscription accounts. Nothing in the
harness knew. Its log gives every switch time. Joining those times to the `started_at` of every recorded
seat with thinking-token provenance in `bench/results/` (700 seats, 692 not straddling a switch):

| account active | single-agent runs (arms A, AH, K attempts) | thinking tokens >= 4000 | median | range |
|---|---|---|---|---|
| account 4 | 357 | 356 | 7322 | 3742 to 31604 |
| account 1 | 40 | 0 | 968 | 463 to 1295 |
| account 3 | 11 | 0 | 716 | 595 to 1316 |

The switch log also accounts for the earlier "regime flips" (account 1 to 4 at 16:38 UTC, back at 18:01 UTC,
and 1 to 4 again at 20:05 UTC on 2026-09-19). Runs from before the thinking-token fields existed show the
same split in output tokens. Interpreter arm-A runs on 2026-09-19, by hour (UTC) and active account, median
output tokens: 07h to 13h account 1, 510 runs, about 1.7K (max 2232); 16h to 17h account 4, 80 runs, about
9.9K (min 5763); 18h to 20h account 1, 68 runs, about 1.7K (max 1994); 20h to 23h account 4, 214 runs,
about 6.6K (min 4494). No hour block mixes the two levels. So the 2026-09-19 entries that say "no local cause" are wrong in one respect: the cause was
local, an account switch. What differs between the accounts (plan tier, a server-side experiment, an
account-level default) is not observable from here; the settings file, CLI version and model alias were
identical. The claim the paper can make is: the same alias served about seven times more thinking on one
account than on two others, stable over two days, and accuracy moved with it.

**Consequences for this run.**
1. Every confirmatory cell up to and including `K seed514` ran on account 4 (long). After the limit the
   switcher moved to account 3 and then account 1, so all five `seed516` cells and `AH seed517` ran short.
   They are valid short-regime cells and stay, reported as their own stratum, never pooled.
2. The remaining cells (seed 514 A, AH, B, C; seed 515 all; seed 517 A, B, K, C; seeds 518 to 520) are
   launched one seed at a time, and only while the switcher shows account 4 active. This pins the factor
   that was drifting; it does not touch the switcher or any credential.
3. Regime is assigned per cell from the switch log (account 4 = long; accounts 1 and 3 = short). A cell
   whose seat interval contains a switch is flagged mixed. A seed enters a regime stratum for paired
   inference only if all five of its cells are in that regime; seed 517 is therefore mixed by construction
   and is reported but excluded from paired tests. The thinking-token sentinel stays as a cross-check.
4. Decided before the remaining cells exist, and open to the maintainer's overrule: no cell with a valid
   outcome is re-run for being on the "wrong" account.

**Addendum 2026-09-20 08:37 UTC (mixed seeds by rule, before the remaining cells ran).** The mixed-seed rule
of point 3 is now computed, not listed by hand: `scripts/paper-account-regime.ts --mixed-seeds` writes
`bench/results/rq1-confirmatory/mixed-seeds.json` from the switch log, and `scripts/paper-rq1-confirmatory.ts
--mixed-seeds` puts those seeds in their own `mixed-account` stratum. A seat spanning two accounts of the
same regime (the 07:49 UTC switch from account 3 to account 1, both short) is not mixed. Applied to the
cells that exist, the rule also catches interpreter seed 501: its A, AH and B cells ran short just before
the 20:05 UTC switch on 2026-09-19 and its K and C cells ran long after it. That seed was the only
interpreter seed the thinking-token sentinel had classed as calibrated, so the interpreter block has no
clean short-regime seed at all. Consequence, stated plainly: the pre-registered primary comparisons use
calibrated (short-regime) seeds only, the run was served by the long-thinking account, and those primary
comparisons are therefore essentially unobserved. The long-thinking stratum is what this run measured, and
it is reported as the pre-registration's secondary stratum, not promoted to primary.

**Addendum 2026-09-20 08:45 UTC (exploratory long-stratum comparisons).** Because the pre-registered primary
comparisons are essentially unobserved, the report script now also prints the same fourteen Fisher
comparisons inside the long-thinking stratum, Holm-adjusted at m=14 and labelled exploratory in every
output. This was added after 13 long-thinking format seeds and all interpreter seeds had been seen, so it
carries no confirmatory weight; it exists so that a reader sees a test and not only rates.
