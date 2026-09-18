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
- sonnet-1 (non-author): re-implemented all eight functions from `public/README.md` alone, never opening the fixtures or the buggy code, and ran `oracle/score.ts` on them: 8 of 8 pass, so every asserted value is determined by the README. Edges checked: formatBytes 1023, 1024 and 2048 TB; dedupe NaN and -0; wrapText tab and newline collapsing and an over-long word; slugify non-ASCII; chunk 1.5 and NaN. Nothing in `public/` reveals the assertions, and the only way through is to make all eight behave as documented. Noted, and deliberately untested: the README is silent on fractional byte counts below 1024 and on values such as 1048575 that round up to "1024 KB".
- sonnet-3 (assigned attacker): no findings received before this record was written.
- Author's own checks: no reference tool exists for this task, so nothing to delegate to; every assertion in `oracle/score.ts` corresponds to a sentence of `README.md` (slugify runs, "untitled" fallback and non-ASCII; chunk remainder, empty input and RangeError; median numeric compare and no mutation; formatBytes 1024 boundary and TB cap; parseBool trim and all eight words; daysBetween sign; dedupe NaN, -0 and keyFn; wrapText width, long words and whitespace collapsing). Pilot seed 4's extra `formatBytes` behavior changes (rounding fractional bytes, carrying 1023.95 KB into MB) did not affect any assertion.

## Extra seeds (added after the admission decision, to size the effect a grid can detect)
Seeds 6 to 10, same command: all five task_pass, cost 0.0507, 0.0489, 0.0611, 0.0547, 0.0486 USD, 4 to 6 turns. Ten-seed arm A pass rate: 9 of 10 (exact 95% interval for the true rate roughly 0.55 to 1.0). The admission rule (1 to 4 of the first five) is met, but the true single-agent rate is probably near 0.9, so a team cannot beat it by more than about 0.1 and a grid needs many seeds per task to see that.

## Status under the raised bar (swarm-150725-3vny-room; rule in paper/amendments.md)
Arm A seeds: 10 (seeds 1-10 above). Pass rate 9 of 10 = 0.90; per-seed outcomes: seed 4 task_fail, every other seed task_pass. The raised bar admits a task to the primary comparison only at 0.3 to 0.7. 0.90 sits in the 0.7 to 0.9 band: **WEAK discriminator, kept, excluded from the primary comparison**. It is not retired (retirement is above 0.9 or at 0). The earlier "1 to 4 of the first five" admission is superseded.
