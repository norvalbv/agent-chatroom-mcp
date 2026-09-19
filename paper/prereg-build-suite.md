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

The primary measurement estimand is the within-seed difference between arm C and
arm A in the observed fraction of planted defects caught. The secondary measurement
estimand is C minus B; B minus A is descriptive. A co-reported delivery estimand
sets the catch fraction to zero when the arm did not complete its frozen protocol
(`protocol_success=false`) while leaving the observed machine score unchanged.
Safety is reported beside every catch result as introduced hidden regression
failures and total observed defects shipped.

The claimed room advantage is unsupported for this family if any of these occurs.
An interval containing zero is absence of evidence for superiority, not evidence of
equivalence:

1. At the common nominal cap, either simultaneous comparison C-A or C-B has a
   non-positive mean or a one-sided multiplicity-adjusted lower confidence bound
   at or below zero, or its worst-case partially identified mean-difference lower
   endpoint over all 20 planned blocks is at or below zero. A room-advantage claim
   must clear those same gates for both observed catch and protocol-adjusted catch.
2. C catches more plants but has a higher introduced-regression rate. That is a
   trade-off, not dominance.
3. B matches C on catch and shipped scores while using less realized spend. The
   evidence then favours the cheaper pair baseline.
4. A matches or beats both coordinated arms without more shipped defects. The
   paper's prior cost finding then extends to this build family.
5. No generated instance clears admission, or task review finds ambiguity,
   leakage, coupled defect tests, a contaminated manifest, or artificial padding.
6. More than 10% of planned confirmatory cells are non-scoreable for catch because
   of infrastructure failure, compromised scoring integrity, stale provenance, or
   incomplete oracle execution. No missing cell is replaced after outcomes are
   known. An arm-caused timeout or invalid room is a scored protocol failure, not
   missing catch data. Unknown authoritative cost removes only the realized-cost
   analyses when the workspace and oracle remain scoreable.
7. For either C-A or C-B, C's realized-cost ratio exceeds 1.25 or its ratio-of-sums
   catch-per-dollar efficiency is below the comparator. A catch difference may
   still be reported, but an advantage at comparable cost is unestablished.

These are tests of one generated task family, not a general claim about all software
engineering. Two sibling instances and their individual defects are correlated
evidence, not independent task families.

## Tasks, versions, and admission

The first generator version emitted `build-billing-s1` and `build-billing-s2`, but
that version was rejected at ceiling and is not an admitted task. A replacement
version must emit two new, versioned sibling task IDs from one generator before its
admission runs begin. Each instance has six to twelve planted defects spread across
modules. The public tree contains the written specification, source, and tests; its
tests must pass while the plants remain. The private tree contains one named
`defect/<id>` check per plant plus baseline-preserving `regression/<id>` checks.
Neither private files nor the manifest's expected outcomes enter a model workspace.
Before reading the oracle implementation, a non-author maps every hidden check to a
quoted clause of the public specification. Hidden inputs may compose documented
rules in an unmentioned way, but a check may not invent semantics absent from those
clauses; the mapping is committed with the task review.

The committed known-good manifest is part of the task version. It covers the
generator seed/configuration, public tree, hidden oracle and scorer, runner, hub
build, and effort-settings hashes. Launch and resume refuse a mismatch even when a
before/after comparison would otherwise look unchanged. A change to a specification
clause, source plant, public test, private test, scorer, or generator creates a new
version and invalidates all earlier development evidence for that version.

Development/admission uses arm A in consecutive, never-reused five-seed blocks at
the pinned normal effort. An
instance is admitted to this build experiment only when all five cells are valid,
the mean `defects_caught / defects_total` is in the inclusive interval [0.30,
0.70], public tests pass on the planted tree, every defect check fails on the
planted baseline and passes on its isolated fix, every regression check passes on
both planted and reference trees, and a non-author specification/giveaway attack
passes. This five-run build-suite admission is deliberately separate from the
legacy `tasks/SUITE.json` all-or-nothing task-pass gate, which requires ten runs.
Until that separate schema is satisfied, these task entries remain `pending` there;
the paper must not call them legacy-suite `primary` tasks.

The per-defect catch table is always retained. A 5/5 defect may remain as an easy
anchor when the task-level mean clears the band and non-author review finds no
giveaway; it is not automatically tuned away on five noisy trials. A defect caught
0/5 is reviewed against the public specification: a determined but hard defect may
remain; an ambiguous, impossible, coupled, or giveaway defect is replaced. Any
replacement produces a new task version and reruns the whole gate on the next
unused five-seed development block. The rejected version and its raw table remain
on record. No rule is tuned on confirmatory seeds.

## Mechanical scores

For a valid run with `N` planted defects and `R` newly failing hidden regression
checks:

```text
caught_fraction       = N_fixed / N
residual_plants       = N - N_fixed
introduced_regressions = R
defects_shipped       = residual_plants + R
protocol_success      = frozen arm protocol completed
protocol_adjusted_catch = caught_fraction if protocol_success else 0
```

The report always shows the four machine values plus the two protocol fields.
`protocol_adjusted_catch` is a delivery-policy score, never relabelled as defects
caught; no adjusted shipped count is invented. A deleted, disabled, duplicate, unnamed,
malformed, or non-binary hidden check makes the cell invalid; it never counts as a
fix. Each defect check must be isolated by a one-fix matrix: it fails on the planted
tree, passes on its isolated fix, and unrelated defect checks retain their expected
state. Regression checks pass on both the planted and reference trees.

Public tests are part of the editable submission. They must all pass on the planted
baseline, but an arm may correct a misleading public assertion when bringing the
codebase into agreement with the specification. Editing a public test, or finishing
with a public-test failure, is an observed task outcome and never anti-tamper
invalidity. The report includes final public-suite status (pass, fail, or unknown)
in its own field, outside the hidden regression count `R`; missing descriptive
telemetry does not discard an otherwise valid machine score, and deleting or
weakening an editable public test cannot improve `R`. Each non-misleading public behavior is independently re-expressed
by a host-held regression check frozen before launch, while the declared misleading
assertion is instead covered by a host-held spec-correct check. Only private task
fixtures, the scorer, executor, or frozen provenance inputs are protected integrity
surfaces.

The task, scorer, runner, effort settings, hub entry, whole hub build, launch HEAD,
and served model observations are hashed or recorded before any seat starts and
checked again before scoring. A model never receives the hidden tree. Timeout,
infrastructure error, parse failure, tamper, and incomplete usage are retained as
distinct outcomes. At an arm-caused timeout, failure to establish the required
room, or unverified room conclusion, the machine oracle scores the workspace exactly
as it stands. The catch and shipped scores remain in the primary intention-to-treat
analysis and the row is flagged `protocol_failure`; a conclusion is not imputed.
A benchmark-infrastructure or scorer failure, stale provenance, compromised hidden
fixture/executor integrity, or otherwise unscoreable workspace remains a planned
missing catch cell. Missing authoritative cost does not erase an otherwise valid
catch score: it makes only the realized-cost and efficiency analyses missing. In
particular, a seat killed before its terminal result may have unknown authoritative
cost even when partial token usage exists; it is never recorded as zero cost. Every
raw outcome and any observed partial cost remains in the ledger.

Outcome classification is mechanical and recorded before scoring. A
`protocol_failure` is (a) the shared deadline firing after at least one seat was
successfully spawned while the runner and, for C, hub remain alive; (b) any B or C
stage exhausting its frozen dollar share with an intact scoreable workspace,
including a non-zero seat exit after the provider reports `error_max_budget_usd`;
or (c) a healthy C hub reaching terminal seat completion without satisfying its
frozen room policy, historical claim/reviewer evidence, artifact-bound verification
and conclusion checks. A process spawn/exec error, provider/API failure, hub startup
failure or crash, HTTP 5xx, scorer exception, or unavailable frozen input is
`infrastructure_error`. A pre/post mismatch in the task, private fixtures, scorer,
executor, hub build, effort settings, or verification-bound workspace is `tamper`
and non-scoreable. The raw result records the failure stage, whether the deadline
fired, seat exit/signal state, hub health, scorer exit, and every integrity hash;
the reducer never reclassifies from prose after seeing the catch score.

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
  proposal, and a valid verification entry. Missing any coordination requirement
  sets `protocol_failure=true`, but the intact workspace is still oracle-scored.

The Claude CLI can overshoot a process cap on its last turn. Every seat's terminal
cost is summed. A valid attempt launched with the fixed shares remains in the
primary intention-to-treat comparison even when terminal spend exceeds M: excluding
overshoots would give C four outcome-dependent chances to be removed versus A's one.
It is labelled `actual_over_cap`, and the paper calls the design equal **nominal**
cap, never equal realized spend. A sensitivity analysis uses only paired blocks in
which both arms have complete cost and actual spend at or below M. An arm with
unknown cost remains missing from that cost sensitivity rather than zero-cost
evidence, without discarding its catch score. The spend ledger includes known
partial spend and labels unknown remainders.

The nominal cap is not evidence of equal realized cost when a seat stops far below
it. M=2.00 did not bind A in exploratory screens, whose observed runs cost roughly
0.05--0.16 USD. Accordingly, no result may be described as "at equal budget"
without printing the realized C/A spend ratio beside that wording and identifying
the design as equal nominal maximum opportunity. For each C-X comparison (`X` is A
or B), the cost-complete paired cells report
`sum(C cost) / sum(X cost)` and the ratio-of-sums efficiency
`sum(catch_fraction) / sum(cost)`. The paper may claim a coordination advantage at
comparable cost only if the C/X realized-cost ratio is at most 1.25 and C's
ratio-of-sums efficiency is at least X's, in addition to the catch, missingness and
safety gates. Otherwise it says only "higher catch at higher realized spend" (when
true) and treats equal-cost room superiority as unestablished. This is a claim gate,
not a fourth arm or an outcome-dependent exclusion from the catch analysis.

## Ordering, seeds, and analysis

- Development/admission: a new candidate version consumes the next declared
  five-seed block. Seeds 1--5 were consumed by rejected billing-v1 and 11--15 by
  rejected ledger-v2; 6--10 are retired unused rather than reused after later
  development was observed. The next candidate begins at 16--20.
- Diagnostic three-arm pilot: seeds 101--104 were consumed by the non-admitted
  ledger diagnostic. A future first admitted instance uses 105--107.
- Confirmatory: seeds 501--520 on both admitted instances.

The seed is a pairing and ordering key, not a provider sampling seed. Within a seed,
all cells run back to back. Arm order rotates A/B/C with offset
`(seed - first_seed) mod 3`; instance order alternates by seed parity. The next seed
does not start until both instances and all three arms for the current seed are
terminal. Valid cells are never rerun because their outcome is inconvenient.

For each arm and seed, average the two instance catch fractions to one family-level
block. Report per-instance and per-defect tables, but estimate C-A and C-B from the
20 planned paired family blocks. Pairwise-complete blocks receive a paired bootstrap
over seeds (10,000 resamples, PRNG seed 191133). Each one-sided 97.5% lower
confidence bound is the 2.5th percentile of its bootstrap distribution (Bonferroni
family-wise alpha 0.05 across the two comparisons); a room-advantage claim requires
both bounds above zero. Ordinary two-sided 95% intervals are also shown
descriptively and never interpreted as equivalence.

The identical block, bootstrap, multiplicity and partial-identification procedure
is run separately for observed catch and protocol-adjusted catch. This creates two
required gates, not extra opportunities to claim success: room advantage requires
both C-A and C-B to clear under both estimands.

Missing blocks are not replaced. For each comparison, the partially identified
mean-difference range over all 20 planned blocks assigns every externally missing
block -1 for the lower endpoint and +1 for the upper endpoint; the complete-block
estimate and count are printed beside it. A family block is missing for a comparison
if either arm lacks a scoreable catch result for either of its two instance cells;
unknown cost alone does not make its catch block missing. A room-advantage claim requires both the
complete-case multiplicity-adjusted lower confidence bound and this worst-case
lower endpoint to exceed zero for both C-A and C-B. Arm-caused protocol failures
retain their as-is oracle scores and are not missing blocks. If more than
10% of planned catch cells are non-scoreable, no confirmatory claim is made
regardless of the complete cases. The actual-at-or-below-M sensitivity is reported
separately and cannot replace the intention-to-treat result. Because there is one
generator family, every interval describes run-to-run variation for this family
and does not create a multi-family population claim. Regressions, protocol failures,
and non-scoreable outcomes are reported as counts and rates without severity
weighting.

## Artifact pipeline and resumability

The pilot and confirmatory tables are generated, not transcribed. The table command
must reject duplicate `(task, arm, seed)` cells, wrong task versions, stale hashes,
missing seat provenance, and incomplete hidden checks. Unknown-cost cells remain
catch-scoreable but are excluded and visibly counted in realized-cost summaries.
Nominal-cap overshoots are retained and flagged, not rejected. The
non-author verifier reruns the command and compares its generated Markdown/JSON
output to the committed artifact.

Resumption is hash-compatible: an existing cell is skipped only when its
`build-result.json` is terminal and its task, generator, public tree, hidden tree,
scorer, runner, hub build, model alias, effort settings, arm allocation, and cap
match the current manifest. File existence alone never means done. A stale cell is
quarantined or rejected, never silently overwritten or pooled.

The confirmatory command is reserved now and will be finalized byte-for-byte when
the reviewed `bench-build-grid.ts` interface lands. Its fixed semantic content is:

```sh
node --import tsx scripts/bench-build-grid.ts \
  --tasks ADMITTED_SIBLING_1,ADMITTED_SIBLING_2 \
  --arms A,B,C --seeds 501-520 \
  --results bench/results/build-suite-confirmatory \
  --model sonnet --effort medium --max-budget-usd 2.00 \
  --seats 4 --deadline-ms 900000 --base-port 23000 \
  --hub-entry dist/index.js --resume
```

This room does not run that command. The nominal allocated total is
`20 seeds x 2 instances x 3 arms x 2.00 USD = 240 USD`. It is not a hard realized
upper bound because the CLI permits last-turn overshoot. Projected realized cost and
wall time will be generated from the diagnostic pilot as a range, with the nominal
allocation total shown separately rather than presented as a ceiling.
`ADMITTED_SIBLING_1,ADMITTED_SIBLING_2` is a fail-closed placeholder after the
billing-v1 rejection; the confirmatory-freeze amendment must replace it with the
two exact admitted versioned IDs or there is no executable confirmatory protocol.

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

### 2026-09-19 -- nominal-cap intention-to-treat amendment

Before any pinned-effort admission or three-arm pilot, non-author review of commit
`9e1302b` identified an asymmetric exclusion: C has four opportunities for a final
turn to overshoot while A has one, so dropping actual-over-M cells could select on
arm and outcome. The protocol now retains every otherwise-valid nominal-cap attempt
in the primary analysis, moves actual-at-or-below-M blocks to sensitivity analysis,
and removes the false 240 USD hard-upper-bound wording. The same review required
simultaneous C-A/C-B inference and explicit missing-block bounds; both are fixed
above before those outcomes exist.

### 2026-09-19 -- coordination-failure intention-to-treat amendment

Before any pinned-effort admission or three-arm pilot, independent review of
`b8f74ca` showed that treating `invalid_room` as missing could selectively remove
arm-C blocks while leaving a positive complete-case result. The protocol now scores
arm-caused timeout, invalid-room, unverified-conclusion and model tamper as zero-
catch protocol failures. Only failures outside the arm remain externally missing,
and a room-advantage claim additionally requires the worst-case partially identified
lower endpoint over all 20 planned blocks to exceed zero for both comparisons. This
amendment precedes those outcomes.

### 2026-09-19 -- post-diagnostic score-at-deadline, cost-comparability, and task-version amendment

After the ledger diagnostic had run, a second non-author attack showed that forcing
a zero catch score at an arm timeout/non-conclusion discards the machine-observed
task outcome, unknown cost need not make catch unknowable, observed C spend was far
above A, and the command still named rejected billing tasks. The 1.25 realized-cost
claim gate and score-as-is rule are therefore post-hoc to development seeds 11--15
and diagnostic seeds 101--104; they are prospective only for a future admitted
task and seeds 501--520. This amendment supersedes only the zero-score clause
immediately above: an intact workspace is oracle-scored as-is at timeout,
budget-exhaustion, or non-conclusion and flagged as a protocol failure. Unknown cost
removes cost/efficiency evidence, not catch evidence. A C/X realized-cost ratio
above 1.25 or lower ratio-of-sums efficiency prevents any claim of room advantage
at comparable cost. A catch block is missing if either compared arm lacks either
instance catch score. Billing-v1 is rejected at 5/5 ceiling (all five exploratory
runs caught 9/9; archive commit `6669a46`), its development seeds 1--5 are consumed,
and the command now fails closed on placeholder task IDs until two new versioned
siblings pass admission. The same review confirmed that misleading public tests
must be editable task output. Their final status is reported separately; hidden
host-held checks, not editable tests, determine `R`. It also froze the stage/process/
health/hash classifier inputs above so arm versus infrastructure failure is not
chosen after future confirmatory catch outcomes are visible.

### 2026-09-19 -- observed versus protocol-adjusted score naming

After the ledger diagnostic but before any confirmatory cell, executor review exposed an
ambiguity between measuring the workspace and enforcing the delivery protocol. The
oracle's `defects_caught` and `defects_shipped` now always mean observed workspace
outcomes. `protocol_success` is separate, and `protocol_adjusted_catch` assigns zero
only for that delivery estimand. A room-advantage claim must clear both observed and
protocol-adjusted catch gates; the latter is never described as a measured defect
count. Scoreable timeout/non-conclusion workspaces therefore still run the oracle.

## Development and pilot evidence (not yet observed at freeze)

The development freeze above preceded these observations. No task is admitted and
therefore no confirmatory run is authorized.

- **Billing-v1 rejected:** five exploratory default-effort A runs each caught 9/9.
  Raw results, workspaces, launch snapshot, hashes and an independent replay are
  archived at commit `6669a46` (`bench/build-suite-evidence/billing-v1`); total
  recorded cost is $0.4097492. The raw result files are also indexed by SHA-256 in
  `docs/build-suite-artifacts/MANIFEST.json` at evidence commit `e1cb5d2`. The
  public task also contained local giveaway residue. This evidence is immutable
  and is not called pinned-effort admission.
- **Ledger-v2 rejected:** pinned-medium A caught 44/45 plants over five cells
  (task-level 97.8%, outside [0.30,0.70]). The committed detailed run and per-defect
  tables are `docs/build-suite-admission.md` and
  `docs/build-suite-admission-runs.json` on generator evidence commit `e8dbd0c`.
  Their raw runner outputs are indexed in
  `docs/build-suite-artifacts/MANIFEST.json` at `e1cb5d2`.
  Non-author attack additionally reproduced scorer spoofing, reference/spec bugs,
  whole-snapshot coupling and giveaway residue in the reviewed version. A post-hoc
  unplanted duplicate-SKU input was fixed by 6/15 exploratory seats, identifying a
  promising future defect class but not admitting this version.
- **Mixed diagnostic, not the required pilot:** ledger-s1 A/B seeds 101--103 used a
  $0.60 cap. C101 used the same nominal cap and, when its intact workspace was
  scored, caught 9/9 with zero regressions at $0.6225; its seats exhausted their
  shares during the conclusion ritual, an arm-caused protocol failure rather than
  missing infrastructure. Replacement C102--104 used a $1.60 cap on different
  seeds, so those rows are unequal-cap and unpaired. The oracle was also corrected
  after inspecting apparent misses. All re-scored A, B, C workspaces caught 9/9.
  The committed derived rows are `docs/build-suite-pilot.json` at `e8dbd0c`.
  The 57 raw admission/pilot `result.json` and `build-result.json` files, including
  C101, are preserved with source paths and SHA-256 digests in
  `docs/build-suite-artifacts/MANIFEST.json` at `e1cb5d2`. Board summary means for
  the unequal-cap rows were A:
  $0.056 and 21 s; B: $0.135 and 62 s; C: $0.83 and 78 s. These rows test the
  harness and demonstrate ceiling, but cannot satisfy the requested pilot on an
  admitted task.

The admission falsifier therefore fired. There are no admitted sibling IDs to
substitute for the fail-closed placeholders in the confirmatory command. A purely
illustrative extrapolation of the unequal-cap one-instance means to the planned two
instances is `40 * (0.056 + 0.135 + 0.83) = $40.84`; it is not the projected cost of
a valid confirmatory design. The fixed nominal allocation remains $240 plus possible
last-turn overshoot. A valid realized-cost projection requires a new sibling pair to
pass admission and a common-cap diagnostic pilot. This room does not run seeds
501--520.
