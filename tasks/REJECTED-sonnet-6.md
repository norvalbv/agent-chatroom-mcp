# Rejected candidate tasks (sonnet-6, swarm-140131-j6yf)

Each was piloted on arm A (one Claude Sonnet seat) through `scripts/bench-rq1.ts <task> A <seed> --root <dir>` at default flags. The rule: keep only a task whose single agent passes 1 to 4 of 5. The full task trees are in commit e054f16 on branch swarm/swarm-140131-j6yf/sonnet-6; they were removed from `tasks/` afterwards so nothing can pick them up.

| task | design | arm A result | cost per run | turns | verdict |
|---|---|---|---|---|---|
| bench-refactor-preserve v1 | remove duplicated per-line loop in invoice.ts; brief states the algorithm (round each line, sum, round the sum); starting code sums raw and rounds once so a no-op fails | 5 of 5 | 0.0315, 0.0321, 0.0366, 0.0367, 0.0364 | 4 | ceiling: the brief handed over the fix |
| bench-refactor-preserve v2 | same code; brief states only the invariant (subtotal equals the sum of individually rounded line amounts) and says to verify the code against it | 5 of 5 | 0.0527, 0.0515, 0.1018, 0.0706, 0.0626 | 4 to 9 | ceiling: the seat derived round-per-line unaided |
| bench-concurrency-order v1 | `applyUpdates` must apply out-of-order events in `seq` order; hidden cases for set/delete reordering | 5 of 5 | 0.0301, 0.0924, 0.0193, 0.0194, 0.0188 | 3 to 4 | ceiling: one explicit defect |
| bench-shell-split | `shellSplit` from a complete POSIX word-splitting README; 31 cases, expected values from Python `shlex.split(posix=True)` | 5 of 5 | 0.0284, 0.0264, 0.0267, 0.0264, 0.0267 | 4 | ceiling: short spec, few interacting rules |

An earlier version of bench-refactor-preserve was a pure refactor whose starting code already met the oracle; sonnet-3's admission attack showed a no-op submission passed every case, so a real defect was planted (v1 above).

Spend on rejected tasks: about 0.69 USD.
