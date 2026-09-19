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
billing, rules and ledger-v2 runs: `docs/build-suite-admission-runs.json`. The build-rules-s1 row was rerun on the committed instance
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

Nothing here is tuned on confirmatory seeds; no confirmatory run was made.

## Three-arm pilot on build-ledger-s1 (seeds 101 to 104, effort medium, 6-astra-4's runner at 9c37a6b)

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
| C (4 seats) | 101 at M = 0.60 | infrastructure_error, no score | | | | about 0.60 | | | |

Findings.

1. **All three arms are at ceiling.** With the oracle as it should be (below) every scored run caught 9 of 9 with no regression. The
   suite does not separate A, B and C on defects caught or shipped on this task; the only separation is cost: A 0.056, B 0.135,
   C 0.83 USD per run (about 2.4 times and 15 times A), and wall time 21, 62 and 78 s.
2. **A second oracle fault, found by this pilot.** The S12 check compared the backorder queue, and the SPEC sentence (then "nothing removes
   it from the queue") contradicted the reference, which drops a cancelled order from the queue during a retry. Three runs
   fixed S12 correctly by skipping a cancelled order and were marked as misses (B101, C102, C103); arm A run 13 in the ledger v2 screen
   was the same fault, so ledger v2 arm A is really 45 of 45. The scenario now projects only orders, lots and availability, and the
   sentence is "a cancelled order is never reserved again". All rows above were rescored with the fixed oracle; the as-run column keeps
   the original numbers. Lesson for the confirmatory run: every scenario must project only the fields its defect touches, and each
   arm-reported "miss" gets its diff read before it is counted (docs above, evidence/fable-review F5).
3. **A cap of 0.60 starves a four-seat room.** At M/4 = 0.15 USD each, all four seats stopped on their own budget while still reading
   the workspace (C101, infrastructure_error). A room needs about M = 1.6 for the same task a single agent finishes for 0.056, so an
   "equal cap" that lets the room finish is 25 to 30 times what one agent needs. This is the non-binding-cap problem of
   evidence/fable-review P3 made concrete; a binding equal-cap comparison needs either a harder task or a spend-matched single-agent
   baseline (one agent re-invoked until it has spent what the paired room spent).
4. Thinking tokens are reported per seat (about 350 to 450 for A, up to 1200 in a room seat), always under 1.2K: the short-regime
   caveat of paper/amendments.md applies, effort medium does not make these tasks think long.
