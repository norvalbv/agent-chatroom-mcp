# Admission record: bench-shelf-quiet (REJECTED at the 3-seed screen)

Author: sonnet-3 (also author of the parent bench-shelf-lang). Room: swarm-150725-3vny-room. Same family as bench-shelf-lang and bench-shelf-long: a dial turned on the parent after its 9 of 10 (0.9, weak), so it is a forking path and would have counted as the same family in any admission.

## Change from the parent
Same program semantics and the same frozen oracle (both reference interpreters agree on the changed program, `scripts/shelf-quiet-task.test.ts`). Two salience changes: (1) `public/program.shelf` had comments that announced each rule ("basics: LET copies", "PUSH shares, LET copies structure position by position", "+ shares the nested lists", "FOR binds elements themselves; LET inside breaks the link"); all comments removed. (2) `SPEC.md` had a dedicated "Copying and sharing" section; its rules are folded into the bullet of each statement or expression form they belong to, no section.

## Arm A pilot: one Claude Sonnet seat, `scripts/bench-rq1.ts tasks/bench-shelf-quiet A <seed> --root <dir>`
| seed | outcome | cost USD | turns |
|---|---|---|---|
| 1 | task_pass | 0.0485 | 4 |
| 2 | task_pass | 0.0460 | 4 |
| 3 | task_pass | 0.0456 | 4 |

3 of 3, 0.1401 USD. Rejected at the screen; seeds 4 to 10 not run. All three seats hand-traced the 23 outputs without running anything ("there is no SHELF interpreter here") and got every line right, including every LET deep-copy.

## Reading
Removing the hints and the dedicated section did not move the rate. Hand-tracing a 106-line program under a fully stated 45-line spec is reliable for Sonnet; the 1 slip in 10 on the parent (LET treated as an alias, or `+` result not deep-copied by a later LET) is a low-rate slip, not a salience effect. Family total (shelf-lang 9/10, shelf-long 9/10, shelf-quiet 0/3 below ceiling): the shelf family is at the weak edge and stays labelled weak.
