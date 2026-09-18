# Rejected candidate tasks (sonnet-5, swarm-140131-j6yf; recorded in swarm-150725-3vny)

Each was piloted on arm A (one Claude Sonnet seat) through `scripts/bench-rq1.ts <task> A <seed> --root <dir>` at default flags, five seeds per version. Numbers are from the predecessor board (`pilot/bench-data-clean-and-expense-triage`, `pilot/bench-early-constraint`). The task trees were never committed; they sat uncommitted in `.swarm-worktrees/swarm-140131-j6yf/sonnet-5` and are deliberately not carried into `tasks/`. Under the raised bar (at least ten seeds, pass rate 0.3 to 0.7, retire above 0.9) every row below is retired: a rate of 1.0 on five seeds cannot come out at 0.9 or lower on ten in any way worth spending on.

| task | design | arm A result | cost per run | turns | verdict |
|---|---|---|---|---|---|
| bench-early-constraint v1 | 8 candidates, one inclusive ">= 3 years" rule stated early, uniform "field: value" lines | 5 of 5 | about 0.022 | 2 | ceiling |
| bench-early-constraint v2 | strict "> 3 years" plus one exact-3-year near-miss | 5 of 5 | about 0.022 | 2 | ceiling |
| bench-early-constraint v3 | same traps as varied prose (no grep-friendly grammar), experience in mixed years and months | 5 of 5 | about 0.023 | 2 | ceiling |
| bench-early-constraint v4 | 14 candidates, 6 more near-misses in both directions, a double negative | 5 of 5 | about 0.027 | 2 | ceiling; one seed's final text verified the answer unprompted |
| bench-data-clean v1 | 14-row messy CSV: dedupe by id, dozens to units, malformed rows, product filter; exact answer 63 | 5 of 5 | 0.039 to 0.054 | 3 to 5 | ceiling |
| bench-data-clean v2 | v1 plus a quoted-comma lookalike product and a quoted trailing field; exact answer 67 | 5 of 5 | 0.023 to 0.027 | 4 to 5 | ceiling |
| bench-expense-triage v1 | 38 free-text expense claims, 10 precedence rules with invented quirks (EUR at 1.10, per-diner caps, VP cap, 45-day boundary, first match wins); 38-letter answer | 5 of 5 | 0.041 to 0.050 | 3 to 4 | ceiling; zero wrong claims in any seed |

Twenty runs on early-constraint, ten on data-clean, five on expense-triage: 35 arm-A runs, 35 passes. Spend about 1.6 USD in the predecessor room's ledger (not this room's).

Why they ceiling, stated as a hypothesis and not a proved cause: each has one stated rule set applied to a list with no execution corner that contradicts a strong prior, so a careful read (or a short script) gets every item. Volume did not help: 38 items times 10 rules produced no slip in five runs. This matches the room finding that only a stated general rule whose consequence in one corner contradicts a strong prior (stamp-interpreter's nested `DEF`) has produced sub-ceiling rates.

## bench-logic-grid (four zebra-style variants): screened once, retired

`scripts/logic-grid.mjs` (solver, renderer, seeded generator) generated four tasks (`bench-logic-grid` 7 houses 33 clues, `-2` 7 houses 28 clues, `-3` 8 houses 35 clues, `-4` 7 houses 28 clues; exact answer is the drink order, unique by the solver). They were uncommitted and unpiloted in the predecessor room. All four are one family (one generator, one clue grammar), so only the hardest, `-3`, was screened, on arm A with three seeds through `scripts/bench-rq1.ts` at default flags in swarm-150725-3vny:

| seed | outcome | cost USD | turns | wall clock |
|---|---|---|---|---|
| 1 | timeout (killed at the 900 s deadline, no answer.txt) | unknown, partial usage 118 output tokens over 17 assistant messages | - | 900.9 s |
| 2 | task_pass | 0.1089 | 8 | 209.9 s |
| 3 | task_pass | 0.1283 | 9 | 828.9 s |

Two completed runs, two passes, one timeout. The harness records a timeout as `timeout`, not `task_fail`, and `scripts/bench-grid.ts` deletes and retries it, so no run failed on reasoning. The only pressure this family applies is wall clock (seed 3 finished 71 s inside the deadline; seed 1 did not finish): that would hit a three-seat room harder than one seat and is not an accuracy signal. Retired at the screen: correctness is at the ceiling on the runs that finished, and the difficulty that exists is time, which is confounded with arm C's overhead. Spend 0.2372 plus the killed seat's unknown cost. The other three variants are retired unpiloted for being the same family. Sources: `.swarm-worktrees/swarm-140131-j6yf/sonnet-5` (uncommitted); only `scripts/logic-grid.mjs` and `bench-logic-grid-3` are copied into this branch's history so that the screen can be reproduced.
