# Pre-registration: planted-defect build suite

**Status:** development protocol frozen before admission results were read. The
confirmatory protocol becomes frozen only after the dated admission and pilot
appendix is filled from committed machine-readable artifacts. Confirmatory seeds
501--520 must not run in this room.

This suite asks whether a four-connection chatroom catches more independent defects
in a multi-module build than either one agent or a no-chat builder/reviewer pair
when every arm has the same maximum dollar budget. It extends
`measure-task-success-on-a-machine-oracle`: the terminal result is a hidden machine
oracle, never a vote or a model judgement. Review and conclusion requirements cite
`done-means-independently-verified`, `consensus-requires-scrutiny`,
`identity-is-the-connection`, and `proposal-is-a-document`; they are not being
re-opened here.

Prior-art verdict: **INSUFFICIENT_EVIDENCE; followed as a narrowing, not as
clearance.** No inspected benchmark combines initially-green public tests,
per-defect hidden scoring, independent snapshot review, and equal aggregate dollar
caps across one/pair/room arms. We reuse validated pieces instead: mutation and
real-fault validation (DOI 10.1145/2635868.2635929; arXiv:2406.09843),
SWE-smith-style defect composition and leakage review (arXiv:2504.21798),
project-level review leakage controls (arXiv:2203.09095), semantic cross-file
dependencies rather than padding (arXiv:2306.03091), and the repository's existing
hidden-oracle/provenance harness. Multi-agent repository results without cost
matching (arXiv:2603.21489) motivate this comparison but do not answer it.

## Claims and falsifiers fixed before development results

The primary estimand is the within-seed difference between arm C and arm A in the
fraction of planted defects caught. The secondary estimand is C minus B; B minus A
is descriptive. Safety is reported beside every catch result as introduced hidden
regression failures and total defects shipped.

The claimed room advantage is falsified for this family if any of these occurs:

1. At the common cap, C's mean catch fraction is no greater than the better of A
   and B, or the paired 95% interval for C minus that arm includes zero.
2. C catches more plants but has a higher introduced-regression rate. That is a
   trade-off, not dominance.
3. B matches C on catch and shipped scores while using less realized spend. The
   evidence then favours the cheaper pair baseline.
4. A matches or beats both coordinated arms without more shipped defects. The
   paper's prior cost finding then extends to this build family.
5. No generated instance clears admission, or task review finds ambiguity,
   leakage, coupled defect tests, a contaminated manifest, or artificial padding.
6. More than 10% of planned confirmatory cells are invalid because of timeout,
   tamper, stale provenance, unknown cost, or incomplete oracle execution. No
   missing cell is replaced after outcomes are known.

These are tests of one generated task family, not a general claim about all software
engineering. Two sibling instances and their individual defects are correlated
evidence, not independent task families.

## Tasks, versions, and admission

The generator emits `build-billing-s1` and `build-billing-s2`. Each has nine planted
defects selected from one twelve-defect catalogue and spread across modules. The
public tree contains the written specification, source, and tests; its tests must
pass while the plants remain. The private tree contains one named
`defect/<id>` check per plant plus baseline-preserving `regression/<id>` checks.
Neither private files nor the manifest's expected outcomes enter a model workspace.

The committed known-good manifest is part of the task version. It covers the
generator seed/configuration, public tree, hidden oracle and scorer, runner, hub
build, and effort-settings hashes. Launch and resume refuse a mismatch even when a
before/after comparison would otherwise look unchanged. A change to a specification
clause, source plant, public test, private test, scorer, or generator creates a new
version and invalidates all earlier development evidence for that version.

Development/admission uses arm A seeds 1--5 at the pinned normal effort. An
instance is admitted to this build experiment only when all five cells are valid,
the mean `defects_caught / defects_total` is in the inclusive interval [0.30,
0.70], public tests pass on the planted tree, every defect check fails on the
planted baseline and passes on its isolated fix, every regression check passes on
both planted and reference trees, and a non-author specification/giveaway attack
passes. This five-run build-suite admission is deliberately separate from the
legacy `tasks/SUITE.json` all-or-nothing task-pass gate, which requires ten runs.
Until that separate schema is satisfied, these task entries remain `pending` there;
the paper must not call them legacy-suite `primary` tasks.

The per-defect catch table is always retained. A defect caught 5/5 is presumed too
easy and is replaced. A defect caught 0/5 is reviewed against the public
specification: a determined but hard defect may remain; an ambiguous, impossible,
or coupled one is replaced. Any replacement produces a new task version and reruns
the whole gate on fresh development seeds 6--10. The rejected version and its raw
table remain on record. No rule is tuned on confirmatory seeds.

## Mechanical scores

For a valid run with `N` planted defects and `R` newly failing hidden regression
checks:

```text
caught_fraction       = N_fixed / N
residual_plants       = N - N_fixed
introduced_regressions = R
defects_shipped       = residual_plants + R
```

The report always shows all four values. A deleted, disabled, duplicate, unnamed,
malformed, or non-binary hidden check makes the cell invalid; it never counts as a
fix. Each defect check must be isolated by a one-fix matrix: it fails on the planted
tree, passes on its isolated fix, and unrelated defect checks retain their expected
state. Regression checks pass on both the planted and reference trees.

The task, scorer, runner, effort settings, hub entry, whole hub build, launch HEAD,
and served model observations are hashed or recorded before any seat starts and
checked again before scoring. A model never receives the hidden tree. Timeout,
infrastructure error, parse failure, tamper, and incomplete usage are retained as
distinct outcomes. In particular, a seat killed before its terminal result has
unknown authoritative cost even if partial token usage exists; it is not a zero-cost
cell and is ineligible for an equal-budget claim.

## Arms and equal-cap contract

The model alias is Claude Sonnet. Normal effort is `medium`, pinned by making each
benchmark workspace its own git root and writing
`.claude/settings.json` with `{ "effortLevel": "medium" }`. The result records the
level, settings path and hash, and `own_git_root=true`. Calibration in the current
short-thinking regime showed only weak token separation, so effort is an observed
configuration, not a claim about a provider-internal reasoning level.

Every arm gets the same aggregate maximum **M = 2.00 USD** and the same 900-second
wall-clock deadline. Equality means equal maximum opportunity, not equal realized
spend. Actual spend, cost coverage, output and thinking tokens, turns, and wall time
are reported separately.

- **A -- one agent:** one seat receives M.
- **B -- pair:** builder 1 receives M/2; an independent reviewer on a snapshot copy
  receives M/4; an optional final builder revision receives the reserved M/4.
  Unused review/revision shares are forfeited, not transferred. Only builders can
  change the scored workspace.
- **C -- room:** four distinct MCP connections each receive M/4. The room requires
  claims, hub-assigned non-author review, a challenge, supermajority, a concluded
  proposal, and a valid verification entry. A merely edited workspace without a
  verified conclusion is invalid.

The Claude CLI can overshoot a process cap on its last turn. Every seat's terminal
cost is summed. Any arm with unknown cost or summed cost above M is retained and
labelled cap-noncompliant, but excluded from the equal-cap comparison; there is no
post-hoc tolerance. The spend ledger includes known partial spend and labels unknown
remainders rather than filling them with zero.

## Ordering, seeds, and analysis

- Development/admission: seeds 1--5, or fresh 6--10 after a task-version change.
- Diagnostic three-arm pilot: seeds 101--103 on the first admitted instance.
- Confirmatory: seeds 501--520 on both admitted instances.

The seed is a pairing and ordering key, not a provider sampling seed. Within a seed,
all cells run back to back. Arm order rotates A/B/C with offset
`(seed - first_seed) mod 3`; instance order alternates by seed parity. The next seed
does not start until both instances and all three arms for the current seed are
terminal. Valid cells are never rerun because their outcome is inconvenient.

For each arm and seed, average the two instance catch fractions to one family-level
block. Report per-instance and per-defect tables, but estimate C-A and C-B from the
20 paired family blocks. Use a paired bootstrap over seed blocks (10,000 resamples,
PRNG seed 191133) for 95% intervals. Because there is one generator family, the
interval describes run-to-run variation for this family and does not create a
multi-family population claim. Regressions and invalid outcomes are reported as
counts and rates without severity weighting.

## Artifact pipeline and resumability

The pilot and confirmatory tables are generated, not transcribed. The table command
must reject duplicate `(task, arm, seed)` cells, wrong task versions, stale hashes,
missing seat provenance, incomplete hidden checks, unknown cost, and cap violations.
The non-author verifier reruns it and compares the generated Markdown/JSON output to
the committed artifact.

Resumption is hash-compatible: an existing cell is skipped only when its
`build-result.json` is terminal and its task, generator, public tree, hidden tree,
scorer, runner, hub build, model alias, effort settings, arm allocation, and cap
match the current manifest. File existence alone never means done. A stale cell is
quarantined or rejected, never silently overwritten or pooled.

The confirmatory command is reserved now and will be finalized byte-for-byte when
the reviewed `bench-build-grid.ts` interface lands. Its fixed semantic content is:

```sh
node --import tsx scripts/bench-build-grid.ts \
  --tasks build-billing-s1,build-billing-s2 \
  --arms A,B,C --seeds 501-520 \
  --results bench/results/build-suite-confirmatory \
  --model sonnet --effort medium --max-budget-usd 2.00 \
  --seats 4 --deadline-ms 900000 --base-port 23000 --resume
```

This room does not run that command. The hard cap upper bound is
`20 seeds x 2 instances x 3 arms x 2.00 USD = 240 USD`; the projected realized
cost and wall time will be generated from the diagnostic pilot as a range, not a
single falsely precise number.

## Freeze and amendment log

1. **Development freeze:** this design, seed split, score formulas, arm allocations,
   falsifiers, and invalid-cell rules were posted at board key
   `evidence/prereg-design` before admission outcomes were read. They are frozen in
   the first commit of this file.
2. **Confirmatory freeze:** after admission and the diagnostic pilot, append the raw
   task/admission tables, three-arm pilot table, rejected variants, exact reviewed
   CLI, and cost projection. That second commit must precede every seed 501--520
   cell.
3. Any later change is append-only here with its date, preceding observation, and
   affected cells. It cannot relabel earlier exploratory work as confirmatory.

## Development and pilot evidence (not yet observed at freeze)

This section is intentionally empty in the development-freeze commit. It will name
the integration branch and commit, admitted task versions and per-defect 5-seed
tables, the non-author ambiguity/giveaway reviews, every rejected variant and why,
the seed 101--103 A/B/C table (caught, shipped components, actual cost, thinking
tokens, wall time, provenance coverage), the room spend ledger, and the generated
20-seed projection. No value is filled from memory or chat prose when a committed
machine-readable artifact exists.
