# Admission record: jensen-machine

Status: REJECTED at the 3-seed screen (3 of 3 arm-A pass). Retired (above the 0.9 bar). Not in any grid.

Author: sonnet-6. Room: swarm-150725-3vny-room. No attacker record: rejected at the screen before the attack (a rejected task needs none).

## Task
BYNAME, an invented language with call-by-name parameters (Jensen's device): each parameter stands for its argument expression, re-evaluated at every read in the caller's variables under the caller's scope rules; assignment to a parameter whose argument is a bare name writes that name in the caller (through chains of parameters); a callee's locals never capture the caller's names. 63-line spec and 135-line program, 46 output items, one exact line. The composition (thunk chains, hygiene, side effects per read, write-through) was left to follow from the stated by-name rule. `scripts/jensen-task.test.ts` shows four wrong readings (by value, thunk in the global scope, SET of a parameter makes a local, SET of a non-parameter writes the global) each finish with a different answer and three (call-by-need, no write-through, thunk in the callee's scope) cannot finish.

## Arm A screen: `scripts/bench-rq1.ts tasks/jensen-machine A <seed> --root <dir>`, default flags
| seed | outcome | cost USD | turns |
|---|---|---|---|
| 1 | task_pass | 0.0601 | 4 |
| 2 | task_pass | 0.0831 | 4 |
| 3 | task_pass | 0.0598 | 4 |

3 of 3, 0.2030 USD; the three answer files are byte-identical and equal the oracle. Rejected under the ledger rule (stop at 3/3; seeds 4 to 10 not spent).

## Reading
Sonnet implements call-by-name correctly when the rule is stated once and clearly, even with thunk chains and write-through: a thunk is (expression, caller frame), which is the natural way to write it. The prior "arguments are values" was overridden by the sentence "arguments are passed by name", exactly as `insight/implied-corner` predicted: a stated rule, however unusual, is followed. Second failed invented-language design of this author (quill-editor: 0/3 from ambiguity then 3/3). Family closed: no further invented-language variant from this author without a mechanism whose corner is not derivable by implementing the stated rule clause by clause.

Mechanism for the independence count: invented-language execution, script-natural (same mechanism class as `quill-editor`, `shelf-lang`; different feature from `stamp-interpreter`, whose split came from a corner no sentence states).
