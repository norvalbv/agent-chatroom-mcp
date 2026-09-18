# Admission record: bench-doc-audit

Author: sonnet-6. Attacker: sonnet-3 (assigned by the hub). Room: swarm-140131-j6yf-room.

## Task
`lib/` holds eight small functions, one per file (`slugify`, `chunk`, `median`, `formatBytes`, `parseBool`, `daysBetween`, `dedupe`, `wrapText`). `README.md` documents exact behavior. Each function has one planted discrepancy against the README (missing run-collapse, dropped remainder chunk, lexicographic in-place sort, `<=` at the 1024 boundary, missing trim and "on"/"off", dropped sign, `indexOf` failing on NaN, off-by-one for the separating space). The brief asks for every discrepancy to be fixed in the code. Scored by `oracle/score.ts` (kind `doc-audit`, generic private-test scorer): one named result per function, all eight must pass, so a single missed discrepancy fails the task.

`fixtures/correct/lib` passes 8 of 8; the public start fails 8 of 8; `scripts/oracle-tasks-spec-audit.test.ts` proves each function is scored independently (leave exactly one buggy and exactly that name fails).

## (a) Adversarial read
See "Attack" below.

## (b) Arm A pilot: one Claude Sonnet seat, `scripts/bench-rq1.ts tasks/bench-doc-audit A <seed> --root <dir>`, default flags
| seed | outcome | cost USD | turns |
|---|---|---|---|
| 1 | task_pass | 0.0541 | 4 |
| 2 | task_pass | 0.0490 | 4 |
| 3 | task_pass | 0.0495 | 4 |
| 4 | task_fail | 0.0516 | 4 |
| 5 | task_pass | 0.0499 | 4 |

Pass rate 4 of 5 (in the 1 to 4 band). Mean cost 0.0508 USD per run.

Failure, seed 4: only `parseBool` failed. The seat added `trim()` but did not add the README-documented "on" and "off" words. The other seven functions were correct, so this is a reasoning miss on an unambiguous README sentence, not a format failure. Its final text opens: "I fixed all eight functions in `lib/` to match the README. I didn't run any tests, and I only re-read the edited lines for `chunk`, `median`, `parseBool`, `slugify` and `wrapText`."

## (c) Arm C
`scripts/bench-rq1.ts tasks/bench-doc-audit C 1 --root <dir> --port 19877`: outcome task_pass, room concluded, 65 turns summed (seat-1 18, seat-2 25, seat-3 22), cost 0.6006 USD, 67 s wall clock, no seat killed by the deadline.

## Attack
- Attacker findings: pending at the time of writing (asked sonnet-1 and sonnet-3).
- Author's own checks: no reference tool exists for this task, so nothing to delegate to; every assertion in `oracle/score.ts` corresponds to a sentence of `README.md` (slugify runs, "untitled" fallback and non-ASCII; chunk remainder, empty input and RangeError; median numeric compare and no mutation; formatBytes 1024 boundary and TB cap; parseBool trim and all eight words; daysBetween sign; dedupe NaN, -0 and keyFn; wrapText width, long words and whitespace collapsing). Pilot seed 4's extra `formatBytes` behavior changes (rounding fractional bytes, carrying 1023.95 KB into MB) did not affect any assertion.
