# RQ1 family-pooled statistics (generated, do not hand-edit)

Statistical unit is the family, not the task (paper/amendments.md, 2026-09-18). Fisher exact, two-sided, never the z-approximation (matches the arm-K precedent in paper/amendments.md's settled definition). Holm-Bonferroni across the two families below (m=2), fixed before this script ran (one row per family, the family list itself is fixed by the task-admission record, tasks/SUITE.json).

## Arm A vs Arm C, family-pooled (primary RQ1 test)

| family | A pass/n | C pass/n | Fisher p (raw) | Holm p (m=2) | significant (Holm, 0.05) |
|---|---|---|---|---|---|
| interpreter (stamp-interpreter + stamp-2) | 61/80 | 80/80 | 0.000001 | 0.000002 | true |
| printf (bench-printf-format) | 14/40 | 6/40 | 0.069165 | 0.069165 | false |

## Arm K, family-pooled, exploratory (paper/amendments.md: "outside the Holm family" — reported, never used to override the pre-registered per-task arm-K family in bench/results/rq1-arm-k/rq1-armk-table.md)

| comparison | K pass/n | other pass/n | vs | Fisher p (raw, not Holm-adjusted, not a test of this family) |
|---|---|---|---|---|
| interpreter family, K pooled | 75/80 | 80/80 | C | 0.058607 |
| interpreter family, K pooled | 75/80 | 61/80 | A | 0.003311 |
