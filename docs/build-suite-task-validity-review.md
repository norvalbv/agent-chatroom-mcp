# Independent task validity review

Reviewer: 6-astra-7, room `swarm-191133-4hqx-room`, 2026-09-19.
Task author: sonnet-1. Initial reviewed generator commit: `fa8133a`.
Instances: `build-billing-s1` and `build-billing-s2`, one billing family.

This review follows `measure-task-success-on-a-machine-oracle` and
`done-means-independently-verified`. It covers specification determinacy and
task presentation. The separate scorer audit covers isolation and tampering.
It does **not** admit either task: admission needs real single-agent measurements.

## Reading order and independent expectations

I read both public specifications and briefs before reading source, tests,
generator, hidden checks, expected values, or reference fixtures. The timestamped
board entry `evidence/task-validity-preoracle` records that reading before oracle
inspection. I did not read the correct fixtures for this review.

The specification determines these outcomes, among others:

| Behavior | Independently derived expectation |
|---|---|
| Negative half rounding | -2.5 becomes -3 |
| Month-end addition | 2024-01-31 plus one month becomes 2024-02-29 |
| First tier boundary | s1: 101 units cost 1209; s2: 201 units cost 4009 |
| Actual period length | Jan 17 to Feb 1 in a Jan 1–Feb 1 period is 15/31 |
| Multiple percentage coupons | 10% and 20% on 10000 plus fixed 500 discount 3500 |
| Percentage cap | 20% on 10000 capped at 1000 discounts 1000 |
| Excess discount | Fixed 12000 on 10000 discounts 10000 |
| Discounted tax base | Region X: 10000 less 1000 yields tax 630 |
| Exemption | `taxExempt: true` yields zero tax |
| Grace boundary | Day 7 costs zero; day 8 on 10000 costs 500 in s1, 200 in s2 |
| Subscription boundary | End date equal to `asOf` is inactive |
| Annual MRR | 12000 annual cents contributes 1000 monthly cents |

After opening the hidden cases, I independently calculated all twelve D-group
expected values for each instance using Python integer/Fraction arithmetic and
calendar reasoning. All 24 groups matched `oracle/expected.json`; neither the
generator's correct implementation nor a correct fixture was imported. This
checks expected values, not the scorer's resistance to a malicious submission.

## Ambiguity and giveaway attack

No nearby source comments announce fixes. Public files contain neither a defect
inventory nor reference fixtures. The misleading dunning test expects a fee on
day 7, contradicting the explicit specification; the brief explicitly makes
specification compliance the task, so the contradiction is deliberate and
resolvable. It must not be preserved as a correctness requirement after repair.

The specification does not define how fractional percentage discounts round
(each coupon versus after aggregation), invalid dates, fractional/negative usage,
or proration outside a period. None of the inspected hidden cases exercises
these unspecified domains. Thus these gaps do not explain a scored miss.

The specification is 46 lines, with 157 lines of implementation across
ten modules. Before seeing any pilot results, my prediction is **ceiling risk**:
most rules map directly to a small local edit, and the module count alone does
not demonstrate useful context pressure. Existing `bench-doc-audit` and
`complementary-fix` admission records are the relevant negative precedents.
Only the pinned-effort pilot can establish a useful miss rate.

## Reproduced setup failures at fa8133a

The exact brief command, `node --import tsx --test test/`, exits 1 under Node
22.20.0 with `ERR_UNSUPPORTED_DIR_IMPORT` in the public task directory. Replacing
the directory argument with `test/*.test.ts` runs **21/21 passing tests for each
planted instance**. This verifies that the baseline tests themselves are green.

The exact committed validation command,
`node --import tsx scripts/bench-build-task.test.ts`, exits 1: **11 pass, 2 fail**.
Both failures are copied public suites in temporary directories unable to resolve
`tsx`. The test runner must resolve its loader independently of the copied
workspace, and the brief must give a runnable command. These findings were sent
to the author before admission spending. The original claim of 13 passing tests
does not hold for this commit in the reviewed environment.

## Admission boundary

The current user brief's mean per-defect catch band of 30–70% over at least five
valid runs controls this suite; it is a different outcome from the older
all-or-nothing ten-run admission rule. Preserve every rejected task version and
raw run. Two generated instances remain one family. An unambiguous oracle and a
green baseline are necessary conditions, not evidence of a room advantage.

## Independent check of the first exploratory screen

I read `/tmp/sb/s1-A-{1,2,3,4,5}/result.json` and re-scored all five saved
workspaces with the task oracle. Every run catches all nine plants and ships
zero measured regressions. The stored anti-tamper flag is true in every run.
These are **default-effort exploratory runs**, with no `effort` provenance field;
they cannot establish admission in a pinned regime. They support rejecting this
small version at ceiling. Do not pool them with a redesigned version's pilot.

| Seed | Caught | Shipped | USD | Thinking tokens | Wall seconds |
|---|---:|---:|---:|---:|---:|
| 1 | 9/9 | 0 | 0.0847026 | 263 | 43.735 |
| 2 | 9/9 | 0 | 0.0846540 | 393 | 44.588 |
| 3 | 9/9 | 0 | 0.0816894 | 182 | 44.674 |
| 4 | 9/9 | 0 | 0.0746452 | 311 | 39.918 |
| 5 | 9/9 | 0 | 0.0840580 | 317 | 47.800 |

Total: **0.4097492 USD**. Thinking tokens are CLI-reported
`seats[0].model_usage["claude-sonnet-5"].thinkingTokens`, not inferred from output
tokens. D02, D03, D04, D07, D08, D09, D10, D11 and D12 each pass in **5/5** runs.
The raw files, final workspaces, exact task snapshot and independent re-scores are
now archived under `bench/build-suite-evidence/billing-v1/`, with a hash manifest.
The original launch used `d7ba963` (a check-naming follow-up to `fa8133a`);
the archived task tree and launch runner hashes match every stored run.
