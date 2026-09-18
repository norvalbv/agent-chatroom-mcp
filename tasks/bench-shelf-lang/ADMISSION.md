# Admission record: bench-shelf-lang

Author: sonnet-3 (predecessor room, uncommitted), piloted and recorded by sonnet-1, room swarm-150725-3vny-room. Reviewer/attacker: sonnet-4.

## Task
`SPEC.md` (45 lines) defines SHELF, a list language whose copy/share rules are the point: LET deep-copies by structure, PUSH/SET/`list`/`+`/`idx`/RUN/FOR share. `program.shelf` (106 lines, 23 PRINTs). Answer: the output lines joined by `|`, scored exact (`exact-answer`, hidden `oracle/oracle.json`).

## Oracle
Two independent implementations (`fixtures/reference/shelf.py`, parse-then-evaluate; `shelf.ts`, line-interpreter) print the same 23 lines, equal to `oracle.json` (re-run by sonnet-1: identical).

## Arm A pilot: one Claude Sonnet seat, `scripts/bench-rq1.ts tasks/bench-shelf-lang A <seed> --root <dir> --model sonnet`
| seed | outcome | cost USD | turns |
|---|---|---|---|
| 1 | task_fail | 0.0450 | 4 |
| 2 | task_pass | 0.0452 | 4 |
| 3 | task_pass | 0.0456 | 4 |
| 4 | task_pass | 0.0449 | 4 |
| 5 | task_pass | 0.0498 | 4 |
| 6 | task_pass | 0.0448 | 4 |
| 7 | task_pass | 0.0447 | 4 |
| 8 | task_pass | 0.0443 | 4 |
| 9 | task_pass | 0.0439 | 4 |
| 10 | task_pass | 0.0487 | 4 |

Pass rate 9 of 10 = 0.90, 10 arm-A seeds. Band: 0.7 to 0.9, so a WEAK discriminator, excluded from the primary comparison. Failure (seed 1): outputs 7 and 8 swapped, the seat treated `LET h2 holder` as an alias; the answer file was well formed, a reasoning slip on a rule the spec states.

## Attack
- sonnet-4 (assigned non-author attacker): wrote a fresh 90-line Python interpreter from `SPEC.md` alone (never opening `fixtures/` or `oracle/` first); its output equals `oracle/oracle.json` exactly on both `bench-shelf-lang` and `bench-shelf-long`. No alternate reading found for LET deep-copy per position, PUSH/SET sharing, FOR snapshot or the callee-sees-only-global scope; no oracle-gaming route (long pipe-joined answer, no reference in `public/`, not guessable). The spec determines the answer, so the one arm-A fail is a seat slip, not ambiguity.

Arm C not run (a weak task does not enter the primary comparison).
