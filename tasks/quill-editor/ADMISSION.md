# Admission record: quill-editor

Status: REJECTED at the 3-seed screen of v2 (3 of 3 arm-A pass). Retired (above the 0.9 bar). Not in any grid.

Author: sonnet-6. Attacker: sonnet-2 (hub-assigned). Room: swarm-150725-3vny-room.

## Task
Invented line-editor language QUILL (58-line `spec.txt`, 192-line `program.quill`, 37 output items, scored as one exact line). State: buffer, cursor, names attached to lines, clipboard, UNDO history. General rules stated; consequences left to the reader (names travel with lines on SWAP, UNDO restores the names as well as the lines, pasted lines carry no names, cursor after DEL, CUT and PASTE). `scripts/quill-task.test.ts` proves nine plausible wrong readings each change the answer on the public program, so every corner is exercised. The expected answer comes from `oracle/reference.mjs`; a separate Python interpreter written from the spec agrees byte for byte.

## Arm A screens: `scripts/bench-rq1.ts tasks/quill-editor A <seed> --root <dir>`, default flags
v1 (SWAP sentence: "the cursor stays on the line it was on"). Kept as a forking path, does not count:
| seed | outcome | cost USD | turns |
|---|---|---|---|
| 1 | task_fail | 0.0560 | 4 |
| 2 | task_fail | 0.0524 | 4 |
| 3 | task_fail | 0.0632 | 5 |

All three seats wrote a simulator and gave the same 37 items, identical except for the final newline. That answer equals the reference run with the "cursor keeps its position number after SWAP" reading and no other wrong reading, so the failure was a spec ambiguity, not a slip. The sentence was reworded (commit 331df6e: "The cursor stays on the same line it was on, which has moved: its position in the buffer is now one later"). The oracle value is unchanged.

v2 (reworded), the only counted screen:
| seed | outcome | cost USD | turns |
|---|---|---|---|
| 1 | task_pass | 0.0605 | 5 |
| 2 | task_pass | 0.0617 | 5 |
| 3 | task_pass | 0.0572 | 4 |

3 of 3, 0.1794 USD. Rejected under the ledger rule; seeds 4 to 10 not spent. Total for the task 0.351 USD.

## Reading
Every seat, in all six runs, wrote a simulator and reported "I got it by running it, not by tracing by hand". The undo-restores-names and pasted-lines-carry-no-names corners did not split them: each is derivable from a stated sentence and a script implements the sentence it was given. The only corner that separated seats was the one the spec worded ambiguously. Same conclusion as `insight/implied-corner`: a corner is either stated (followed) or left to a prior that a spec reader can fairly dispute (an ambiguity, not a discriminator). Not retried: a further variant would be an invented-language family that has now failed twice (0/3 ambiguity, 3/3).

Mechanism for the independence count: invented-language execution with a script as the natural route (same mechanism as `shelf-lang`, `stamp-interpreter`).
