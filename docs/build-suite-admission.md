# Planted-defect build suite: admission record (retired at ceiling)

Room `swarm-191133-4hqx-room`, author sonnet-1. Generators: `scripts/bench-build-gen.ts` (billing), `scripts/bench-build-rules-gen.ts`
(rules), `scripts/bench-build-ledger-gen.ts` (ledger). Offline proof of the oracles: `scripts/bench-build-task.test.ts`
(broken passes its public tests and catches 0; correct scores 1; fixing exactly one planted defect flips exactly its own check and no
regression; no comment in `src/`).

## Status of these screens

Every row except the three-arm pilot (effort pinned to medium by the native runner) ran at the default effort with `bench-rq1.ts`, so
they are **exploratory ceiling rejections**, not admission runs at a pinned effort; the 'low' row and the medium pilot both show the
same ceiling on the ledger task. Task directories were regenerated in place while designing (build-rules-s1 changed draw, ledger v0 to
v2); the runs recorded above name the commit they ran on, and older versions are recoverable from git history only. Labels 1 to 5, 11 to
15 are consumed development labels; the pilot used 101 to 104.

## Method

Arm A, one Claude Sonnet seat, `node --import tsx scripts/bench-rq1.ts <task> A <n> --root <dir> --max-budget-usd 2..3`, five runs launched
together for the admission gate (three for the 120-rule instance). Scoring: the task's own `oracle/score.ts` on `<root>/workspace`
(`defect/<id>` per planted defect, `regression/<id>` for behaviour that already conformed). Default effort unless stated. Raw results
under `/tmp/sb*/` (not committed); the numbers below are copied from them. Admission bar (paper/amendments.md and the room brief):
mean caught between 30 and 70 per cent over at least five runs.

Raw per-run records (rescored with the committed oracle, cost, tokens, turns, wall time, per-seat `model_usage`, run roots) for the
billing, rules and ledger-v2 runs: `docs/build-suite-admission-runs.json`. The underlying raw `result.json`/`build-result.json` files
are committed at `bench/build-suite-evidence/sonnet-1-runs/` (same content as `docs/build-suite-artifacts/`, kept in both places:
the latter is this room's evidence trail, the former matches the room's converged archive path under `bench/`). The build-rules-s1 row was rerun on the committed instance
(55781dc) because a later generator edit changed which rules are drawn; the earlier 10 of 10 x5 on the previous draw is kept as
history. The first ledger runs (v0, v1) and the low-effort run were scored with the oracle of their day and are recorded only here.
Total real-model spend for admission: about 4.0 USD; with the three-arm pilot below about 7.7 USD.

## Results (all at ceiling; none admitted)

| task | shape | planted | runs | caught per run | task_pass | cost USD per run | wall s |
|---|---|---|---|---|---|---|---|
| build-billing-s1 | 9 modules, ~230 lines, SPEC 46 lines; boundary, spec-vs-code, one-hop cross-module, one misleading public test | 9 | 5 | 9,9,9,9,9 | 5 of 5 | 0.075 to 0.085 | 39 to 47 |
| build-rules-s1 | 24 rules over 8 modules, ~120 lines, one SPEC row per rule, 2 public tests encode the bug | 10 | 5 | 10 x5 | 5 of 5 | 0.057 to 0.072 | 28 to 33 |
| build-rules-l3 | 120 rules over 20 modules, ~570 lines, 12 KB SPEC | 36 | 3 | 36, 35, 36 | 2 of 3 | 0.136 to 0.156 | 39 to 53 |
| build-ledger-s1 | stateful warehouse, 6 modules, prose-only SPEC, missing rollback, leaked counter, wrong retry trigger, zombie backorder | 9 | 5 | 9 x5 | 5 of 5 | 0.053 to 0.072 | 28 to 35 |
| build-ledger-s1 v2 (same-shape defects, S13 multi-lot return and S14 duplicate-sku lines planted, child-process oracle; seeds 11 to 15) | as above, 9 of 14 catalogued plants | 9 | 5 | 9,9,8,9,9 as run (the 8 is the S12 oracle fault below; 45 of 45 after the fix) | 4 of 5 as run | 0.056 to 0.060 | 25 to 28 |
| build-ledger-s1 at `effortLevel: low` (settings file in the workspace) | same | 9 | 5 | 9 x5 | 5 of 5 | 0.050 to 0.059 | 27 to 28 |

Per-defect catch tables: every planted defect was caught n of n on billing, rules-s1 and ledger-s1. On rules-l3 one defect
(`exportLimit`, a clamp upper-limit off by one) was missed once in three; every other defect was caught 3 of 3.

A first ledger run scored 9,7,7,7,7 of 9. All misses were an oracle fault, not a hard defect: the correct build left a stale
`remaining` map on a cancelled order, the seats cleared it, and the snapshot comparison marked their (arguably right) behaviour as a
miss and a regression (`R05`). The correct build now clears it in every variant; the five reruns above are on that version. This
is an oracle repair, not tuning of the catch rate, and the first run's numbers are kept here.

## Why it is at ceiling (and what was tried)

The seat reads the whole codebase and SPEC in one pass and diffs them clause by clause in about 30 seconds. Levers tried, each still
100 per cent: more defects and a plain giveaway-free style (billing), volume up to 120 rules (rules-l3: catch rate did not fall with
size), prose-only spec with state-machine defects that need a call path across modules (ledger), a misleading public test (billing D10,
rules), lower effort (ledger, low). This matches `tasks/complementary-fix/ADMISSION.md` and the roughly 45 earlier rejected candidates.

fable-reviewer (evidence/fable-review) attacked the first ledger version and was right on five counts, all fixed in v2 (commit 55781dc): excision residue (blank lines, `&& true`), two unplanted bugs in the reference tree (repeated returns over a multi-lot shipment restocked the wrong lot; duplicate-sku lines leaked a reservation) now planted as S13 and S14 after fixing the reference, an in-process oracle that a workspace could spoof by patching `JSON.stringify` (now a child process, plain-data comparison, tested), whole-snapshot string equality (now subset deep-equal, SPEC declares the shape frozen, tested) and a SPEC sentence missing for S12. v2 arm-A result is the fifth row above: still at ceiling (44 of 45 plants caught).

Reviewer findings on the first billing generator (sonnet-3, evidence/generator-review-s1) were correct and are why later families avoid
the excision scars: unused imports and parameters left behind by the defect (`let cut` never reassigned, `roundHalfUp` imported but
unused, `as any` with a snake_case property), and spec section names equal to module names. The ledger family keeps a defect the same
shape as correct code.

## What was not tried (levers for a future round)

1. Defects that only running code reveals (numeric drift under random inputs, ordering under concurrency) with the spec stating
   invariants instead of values.
2. A codebase beyond one context (over 50K tokens) where a single reader has to skim; volume of independent rules did not do it at
   570 lines.
3. A spec that is silent on the consequence and only a worked example implies it (the stamp-family lever in paper/amendments.md).
4. Public tests hidden from the arm so it has no green run to lean on.

sonnet-3 (room review) proposed concrete instances of lever 1 that a diff-a-spec-row reader cannot see: a conservation invariant
across a multi-step flow where each stage is locally correct but roundings disagree (a sum of prorated parts does not equal the
prorated whole); a helper that mutates an input a later stage reads (order-dependent result, invisible to a test that calls each
stage alone); state kept across calls (a cache keyed on a subset of the inputs, or idempotency broken on a second call); a worked
example in the spec whose numbers only match a derived constant or order, not a stated rule. Each would need a scenario hidden
check, not a per-function call.

6-astra-7 proposed a concrete lever built from the same family the ledger already uses (ABA staleness): a reservation gets
replaced for the same order/sku, and a delayed completion of the OLD attempt must not debit or release the NEW allocation;
the spec would state exactly-once effects per attempt and conservation, not per-helper values, and hidden checks would be
deterministic event schedules exercising redelivery and reordered completion while ordinary happy-path tests stay green.

## A finding worth recording precisely: giving the rule away in SPEC erased the one sub-ceiling signal found

fable-reviewer (evidence/fable-review-2, non-author, zero spend, read-only against the /tmp/sb4-6 ledger v1 pilot workspaces I
had already produced) found that of the two unplanted reference-tree bugs later fixed and turned into S13/S14 (see "Why it is
at ceiling" above), one of them -- duplicate order lines for the same sku leaking a reservation -- was fixed by only 6 of 15
Sonnet seats (40%), inside the 30-70% admission band, while the other (repeated returns over a multi-lot shipment) was fixed
15 of 15. The duplicate-sku case differed in kind from every other defect in this suite: nothing in the SPEC or the code named
the triggering input (two order lines with the same sku); a seat had to invent that scenario, not diff a sentence against a
function. This was, on that evidence, the first and only sub-ceiling signal this room produced.

Once it was formalized as the S14 plant, the SPEC gained the sentence "Order lines may repeat a sku; their quantities add up"
so the fix could be scored deterministically. Every run since (14 of 14 observed: the ledger v2 five-seed screen and the
three-arm pilot) caught S14. Stating the rule in the SPEC, which admission and giveaway review both require, removed exactly
the difficulty that made it sub-ceiling. This is the same shape as `complementary-fix`'s retirement (the fix sat in the words
of the brief) but caught prospectively rather than after a wasted screen, and it sharpens the future-work list above: the
next family needs defects whose SPEC states an invariant or a worked example without naming the exact input shape that
breaks it, so a seat must construct the case rather than look it up.

Nothing here is tuned on confirmatory seeds; no confirmatory run was made.

## Three-arm pilot on build-ledger-s1 (seeds 101 to 104, effort medium, 6-astra-4's runner at 9c37a6b)

**This is an unequal-cap diagnostic, not the pre-registered equal-cap comparison**, and it is a mixed one: most C rows (102-104)
ran at M = 1.60 (four seats at M/4 each) because the wrapper misreported the first same-cap attempt (C101, M = 0.60) as a
failure when the room had actually finished — see finding 3, corrected after a non-author caught it. So one same-cap (M = 0.60)
C data point does exist (C101) alongside three higher-cap ones (C102-104); none of this is the paired, equal-cap-for-every-cell
confirmatory design, which is left to paper/prereg-build-suite.md.

Command shape: `node --import tsx scripts/bench-build.ts tasks/build-ledger-s1 <A|B|C> <seed> --root <dir> --max-budget-usd <M> --expected-task-sha256 <hash of the task tree>`
(arm C also `--port <free>`). Raw rows: `docs/build-suite-pilot.json`. Caps: M = 0.60 for A and B, M = 1.60 for C (a room of four
seats at M/4 each).

| arm | seed | caught / 9 (as run) | caught / 9 (S12 oracle fixed) | shipped | regressions failed | cost USD | thinking tokens per seat | wall s | turns |
|---|---|---|---|---|---|---|---|---|---|
| A | 101 | 9 | 9 | 0 | 0 | 0.055 | 452 | 21 | 5 |
| A | 102 | 9 | 9 | 0 | 0 | 0.057 | 347 | 21 | 5 |
| A | 103 | 9 | 9 | 0 | 0 | 0.056 | 420 | 22 | 5 |
| B | 101 | 8 (S12) | 9 | 0 | 0 | 0.133 | 529, 916, 73 | 65 | 12 |
| B | 102 | 9 | 9 | 0 | 0 | 0.115 | 424, 867, 53 | 51 | 10 |
| B | 103 | 9 | 9 | 0 | 0 | 0.158 | 433, 856, 635 | 71 | 12 |
| C (4 seats) | 102 | 8 (S12) | 9 | 0 | 0 | 0.716 | 1154, 573, 881, 949 | 76 | 74 |
| C (4 seats) | 103 | 8 (S12) | 9 | 0 | 0 | 0.950 | 946, 1132, 1180, 597 | 85 | 94 |
| C (4 seats) | 104 | 9 | 9 | 0 | 0 | 0.836 | 549, 847, 973, 1000 | 74 | 78 |
| C (4 seats) | 101 at M = 0.60 | wrapper: infrastructure_error; workspace rescored directly: 9 | 9 | 0 | 0 | 0.622 (complete) | 818, 710, 515, 815 | 139 | 62 |

Findings.

1. **All three arms are at ceiling.** With the oracle as it should be (below) every scored run caught 9 of 9 with no regression,
   once C101 is corrected (finding 3). The suite does not separate A, B and C on defects caught or shipped on this task. The
   cost picture is mixed rather than monotone: the M = 1.6 room runs (C102-104) cost 0.72-0.95 (about 13-17x A's 0.056), but
   C101 at the SAME M = 0.60 cap as A and B finished for 0.622 (about 11x A, comparable to or cheaper than the M=1.6 rooms) —
   so cost is not simply "room costs N times more" at a fixed sample; it varies with what a room's own coordination overhead
   happens to cost on a given seed, and the single M=0.60 same-cap room data point does not by itself rule out equal-cap
   parity on this ceiling task. Wall time: A ~21s, B ~62s, C 74-139s.
2. **A second oracle fault, found by this pilot.** The S12 check compared the backorder queue, and the SPEC sentence (then "nothing removes
   it from the queue") contradicted the reference, which drops a cancelled order from the queue during a retry. Three runs
   fixed S12 correctly by skipping a cancelled order and were marked as misses (B101, C102, C103); arm A run 13 in the ledger v2 screen
   was the same fault, so ledger v2 arm A is really 45 of 45. The scenario now projects only orders, lots and availability, and the
   sentence is "a cancelled order is never reserved again". All rows above were rescored with the fixed oracle; the as-run column keeps
   the original numbers. Lesson for the confirmatory run: every scenario must project only the fields its defect touches, and each
   arm-reported "miss" gets its diff read before it is counted (docs above, evidence/fable-review F5).
3. **CORRECTED (was wrong in an earlier version of this doc): a cap of 0.60 does not necessarily starve a four-seat room.**
   fable-reviewer (evidence/fable-review-pilot, non-author) scored C101's actual workspace directly with the committed oracle
   and got 9 of 9, 0 regressions, at a real cost of 0.622 USD (4/4 seats, complete coverage) — the room finished the work and
   even reached a verified conclusion (a proposal, three challenges, three agree votes, per fable's read of `build.jsonl`)
   before its seats individually exited 1 on their own remaining per-seat share. `scripts/bench-build.ts` labels any nonzero
   seat exit as `infrastructure_error` regardless of when it happens, so a room that finishes and then runs out of budget
   during its own wrap-up is misclassified as producing no result at all, rather than being scored on the (correct) work it
   already did. This is a real defect in the wrapper (owned by 5-6-terra-6/6-astra-4, not this room's task generators): a
   confirmatory run must score the workspace as it stands and record cost/outcome separately, or a starved room's genuinely
   good work silently leaves the primary analysis (reopening prereg point P1). The earlier claim "C needs M >= 1.6" is
   retracted; C101 at M = 0.60 is direct evidence C can finish at the same cap as A and B on this task. The corrected row is
   in the table above; the wrapper defect itself needs a fix and a regression test, which is 6-astra-4/terra-6's to add.
4. Thinking tokens are reported per seat (about 350 to 450 for A, up to 1200 in a room seat), always under 1.2K: the short-regime
   caveat of paper/amendments.md applies, effort medium does not make these tasks think long.
