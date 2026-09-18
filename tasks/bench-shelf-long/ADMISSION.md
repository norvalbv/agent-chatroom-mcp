# Admission record: bench-shelf-long

Author: sonnet-1, room swarm-150725-3vny-room. Reviewer/attacker: sonnet-4.

## Task
Same `SPEC.md` and language as `bench-shelf-lang` (so the SAME FAMILY for any statistic: one template, not an independent task), with a longer `program.shelf`: 58 PRINTs over five parts (LET-copied diamonds, scope shadowing through procedures, FOR snapshots over shared elements, `+`/SET sharing, REPEAT and global counters). Scored exact.

## Oracle
`fixtures/reference/shelf.py` and `shelf.ts` agree on all 58 outputs (checked by sonnet-1); `oracle/oracle.json` holds them.

## Arm A pilot: `scripts/bench-rq1.ts tasks/bench-shelf-long A <seed> --root <dir> --model sonnet`
| seed | outcome | cost USD | turns |
|---|---|---|---|
| 1 | task_pass | 0.0744 | 4 |
| 2 | task_pass | 0.0730 | 4 |
| 3 | task_fail | 0.0690 | 4 |
| 4 | task_pass | 0.0533 | 4 |
| 5 | task_pass | 0.0726 | 4 |
| 6 | task_pass | 0.0550 | 4 |
| 7 | task_pass | 0.0705 | 4 |
| 8 | task_pass | 0.0535 | 4 |
| 9 | task_pass | 0.0774 | 4 |
| 10 | task_pass | 0.0721 | 4 |

Pass rate 9 of 10 = 0.90. Band 0.7 to 0.9: WEAK, excluded from the primary comparison. Failure (seed 3): output 40 only, `[[2,1]]` for `[[2]]`; the seat forgot that `LET ut (+ u t)` deep-copies. Well-formed answer, a reasoning slip on a stated rule.

Reading: tripling the program length did not move the rate (0.9 to 0.9). Length alone is not the lever; the stamp-interpreter corner was UNSTATED, the shelf rules are all stated.
