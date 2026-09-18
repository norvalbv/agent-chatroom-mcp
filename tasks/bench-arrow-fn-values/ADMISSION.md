# Admission record: bench-arrow-fn-values

Author and pilot: sonnet-1, room swarm-150725-3vny-room. Attackers: sonnet-3 and sonnet-2 (non-authors).

## Task
A stamp-family sibling. ARROW is an invented language with first-class function values (`fn`, `call`, procedures as global variables). The spec states only the flat scope rule (a call reads its own locals, else globals; a SET in a call is local; GLOBAL) and never mentions capture, so a lexical-closure reading gives a different answer at 12 of the 22 printed values (make-adder, counter, compose, curry, a loop-local read). Answer: the 22 printed integers, exact (`exact-answer`).

Oracle: `fixtures/reference/arrow.py` and `arrow.mjs` (independent, different structure) print the same 22 values, equal to `oracle/oracle.json`; `scripts/arrow-task.test.ts` (registered) proves the references agree and that the flat rule, not the closure or dynamic-scope reading, gives the frozen answer.

## Attack
- sonnet-3: fresh 110-line Python interpreter from `public/` only (reference and oracle unopened until after); all 22 values matched. Found a spec gap (`#` comment and blank lines undefined; fixed, sentence added). Also observed that the program's own comments announced the corner ("functions built inside procedures", "a counter whose state lives in a local").
- sonnet-2: fresh 60-line JS interpreter from `public/` only, oracle unseen until after; 22 of 22 matched, no alternate reading, no gaming path.
No defect remains.

## Arm A pilots: one Claude Sonnet seat, `scripts/bench-rq1.ts tasks/bench-arrow-fn-values A <seed> --root <dir> --model sonnet`
**Forking path, kept on the record:** v1 (program with corner-announcing comments) was piloted first; v2 removed the comments and is the task as shipped. The rate for the admission rule is v2's ten seeds; v1's seeds are excluded.

v1 (comments present), seeds 1-3: task_pass x3 (4, 4, 5 turns; $0.0376, $0.0402, $0.0461). Screen 3 of 3, retired; then the salience dial was turned.

v2 (comments removed, oracle unchanged), seeds 11-20:
| seed | outcome | cost USD | turns |
|---|---|---|---|
| 11 | task_pass | 0.0382 | 4 |
| 12 | task_fail | 0.0366 | 4 |
| 13 | task_pass | 0.0390 | 4 |
| 14 | task_pass | 0.0375 | 4 |
| 15 | task_pass | 0.0397 | 4 |
| 16 | task_pass | 0.0373 | 4 |
| 17 | task_pass | 0.0385 | 4 |
| 18 | task_pass | 0.0372 | 4 |
| 19 | task_pass | 0.0397 | 4 |
| 20 | task_pass | 0.0385 | 4 |

Pass rate 9 of 10 = 0.90, 10 arm-A seeds. Band 0.7 to 0.9: **WEAK discriminator, excluded from the primary comparison**. The one failure (seed 12) is a single token: output 14 was 44 for 43 (`PRINT (call cnt)` after the GLOBAL-writing `bumpc`), a hand-trace slip on a well-formed answer, not a format failure and not an alternate reading of the scope rule.

Reading: removing the comments moved the rate from 3 of 3 to 9 of 10 (a forking path, small samples: the difference is not established). A function-value-centred program makes the scope rule the salient question, which is why the closure prior does not fire the way it does at stamp's incidental nested DEF. Same family as `stamp-interpreter` (flat-scope prior); a task for the bar, one family for the statistics.
Arm C not run (weak, outside the primary comparison).
