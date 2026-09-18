# Admission record: sched-trace-plus

Author: sonnet-4, room swarm-150725-3vny-room. Same family as `sched-trace` (dial turned: 10 to 24 jobs, about 180 ticks, three new stated rules: a shared I/O device served one job at a time in sleep order, a decay rule, and an idle tick that sets LAST to none). Exact-answer, 24 tokens, one wrong token fails the run.

## Oracle and attacks (v1 and v2 share the oracle)
`oracle/reference.mjs` (JS) and `oracle/independent-check.py` (Python, written separately) agree on all 24 tokens; `scripts/sched-trace-plus-task.test.ts` also checks that ignoring the device queue, the decay rule or the idle-resets-LAST rule changes the answer. Three non-author spec-only solvers (sonnet-3, sonnet-5, sonnet-6) reproduced the oracle from `spec.txt` + `jobs.txt` alone. Sonnet-5's mutant sweep: the big rules bite (no switch tick 24 of 24 tokens, wake reward 22, no decay 4, device ignored 3, strict preempt (ii) 9), while seven fine corners are inert in this `jobs.txt` (spent reset on wake and arrival, decay cap, alphabetical tie-break, joiners not ageing, wait reset on preempt and on pick): they add length, not difficulty. No oracle-gaming path (24-token exact line).

## v1 (spec at commit 0f8bc01): arm A, 10 seeds, 5 of 10 pass = 0.5, REJECTED for ambiguity
| seed | outcome | cost USD | turns | wrong tokens |
|---|---|---|---|---|
| 1 | task_pass | 0.0519 | 4 | 0 |
| 2 | task_fail | 0.0520 | 4 | B:13 (oracle B:12) |
| 3 | task_pass | 0.0526 | 4 | 0 |
| 4 | task_fail | 0.0535 | 4 | B:13 |
| 5 | task_pass | 0.0521 | 4 | 0 |
| 6 | task_fail | 0.0635 | 6 | B:13 |
| 7 | task_pass | 0.0534 | 4 | 0 |
| 8 | task_pass | 0.0504 | 4 | 0 |
| 9 | task_fail | 0.0665 | 6 | B:13 |
| 10 | task_fail | 0.0534 | 4 | B:13 |

Total 0.5493 USD. Every failure is the one token B:13, the other 23 right, answer files well formed: a single-trap task. Mechanism: step 4a of v1 allowed preemption only of "a running job that is not in its switch tick". A job picked in tick t has its switch tick t, so at any later tick's step 4a it is never in its switch tick and the clause is vacuous. At tick 10 job B wakes with priority 0 while E was picked at tick 9; the literal text lets B preempt E (B:12). A script that carries the switch flag into the next tick's check protects E and gives exactly B:13 (the surviving seat script does; reverting that one line gives B:12). Sonnet-6, an attacker writing a fresh solver from the spec, made the same misreading first and got B:13. Seat 9's final text says it noticed the clause was vacuous and still finished with B:13, so not every failure is attributed to one bug (seat scripts shared /tmp and were overwritten). Verdict recorded by the author: a dead clause that invites a plausible protective reading is a defect in the text (the quill v1 precedent), so v1's 0.5 is not admissible as a difficulty measurement; it is kept here as the forking path.

## v2 (clause deleted from step 4a; oracle unchanged, since the literal text never applied it): arm A screen, 3 of 3, REJECTED
| seed | outcome | cost USD | turns | wrong tokens |
|---|---|---|---|---|
| 11 | task_pass | 0.0496 | 4 | 0 |
| 12 | task_pass | 0.0507 | 4 | 0 |
| 13 | task_pass | 0.0526 | 4 | 0 |

Total 0.1529 USD. Fresh seeds 11 to 13; v1 seeds are excluded. 3 of 3 stops the screen under the room's rule; seeds 14 to 20 not spent.

## Conclusion
The 0.5 of v1 was the dead clause and nothing else: with it deleted, the same 24 jobs, the same three new rules and the same oracle go 3 of 3. So the dial (more jobs, more interacting rules, a longer run) did not move sched-trace: the seat's simulator implements each stated ordered step, and the only item that split seats was a sentence with no work to do. The family (sched-trace, sched-trace-plus; 9 of 10 and 3 of 3 outside the ambiguity) stays at the ceiling. `sched-trace-plus` is retired and is not part of any grid; `sched-trace` remains a weak discriminator at 9 of 10. Total spend on this family from this room: 0.405 + 0.5493 + 0.1529 = 1.107 USD.
