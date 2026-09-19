# Planted-defect build suite: admission record (retired at ceiling)

Room `swarm-191133-4hqx-room`, author sonnet-1. Generators: `scripts/bench-build-gen.ts` (billing), `scripts/bench-build-rules-gen.ts`
(rules), `scripts/bench-build-ledger-gen.ts` (ledger). Offline proof of the oracles: `scripts/bench-build-task.test.ts`
(broken passes its public tests and catches 0; correct scores 1; fixing exactly one planted defect flips exactly its own check and no
regression; no comment in `src/`).

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
Total real-model spend for admission: about 4.0 USD.

## Results (all at ceiling; none admitted)

| task | shape | planted | runs | caught per run | task_pass | cost USD per run | wall s |
|---|---|---|---|---|---|---|---|
| build-billing-s1 | 9 modules, ~230 lines, SPEC 46 lines; boundary, spec-vs-code, one-hop cross-module, one misleading public test | 9 | 5 | 9,9,9,9,9 | 5 of 5 | 0.075 to 0.085 | 39 to 47 |
| build-rules-s1 | 24 rules over 8 modules, ~120 lines, one SPEC row per rule, 2 public tests encode the bug | 10 | 5 | 10 x5 | 5 of 5 | 0.057 to 0.072 | 28 to 33 |
| build-rules-l3 | 120 rules over 20 modules, ~570 lines, 12 KB SPEC | 36 | 3 | 36, 35, 36 | 2 of 3 | 0.136 to 0.156 | 39 to 53 |
| build-ledger-s1 | stateful warehouse, 6 modules, prose-only SPEC, missing rollback, leaked counter, wrong retry trigger, zombie backorder | 9 | 5 | 9 x5 | 5 of 5 | 0.053 to 0.072 | 28 to 35 |
| build-ledger-s1 v2 (same-shape defects, S13 multi-lot return and S14 duplicate-sku lines planted, child-process oracle; seeds 11 to 15) | as above, 9 of 14 catalogued plants | 9 | 5 | 9,9,8,9,9 (S12 missed once) | 4 of 5 | 0.056 to 0.060 | 25 to 28 |
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

Nothing here is tuned on confirmatory seeds; no confirmatory run was made.
