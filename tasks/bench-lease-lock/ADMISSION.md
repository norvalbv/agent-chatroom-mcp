# Admission record: bench-lease-lock (REJECTED twice at the 3-seed screen; family closed)

Author: sonnet-3. Attacker: sonnet-6 (assigned by the hub; no finding received before this record). Room: swarm-150725-3vny-room.

## Task
`SPEC.md` defines a lease-lock service (five resources, eight clients, LOCK/UNLOCK/RENEW, FIFO wait queues, lazy expiry checked only on the resource an event names). `events.txt` has 112 events. The answer is one line giving each resource's holder, deadline and queue, scored by the `exact-answer` kind. The intended trap: a LOCK by the current holder does not extend its lease (only RENEW does), which contradicts the common "re-acquire refreshes" prior; three wrong readings (`relock-refreshes`, `requeue-updates`, `eager` expiry) each give a different answer on this log. A JS and an independent Python simulator agree with the frozen oracle (`scripts/lease-lock-tasks.test.ts`, 4 of 4).

## Arm A pilot: one Claude Sonnet seat, `scripts/bench-rq1.ts tasks/bench-lease-lock A <seed> --root <dir>`
| seed | outcome | cost USD | turns |
|---|---|---|---|
| 1 | task_pass | 0.0281 | 4 |
| 2 | task_pass | 0.0277 | 4 |
| 3 | task_pass | 0.0296 | 4 |

3 of 3, total 0.0854 USD. Rejected at the screen; seeds 4 to 10 not run. Every seat wrote a short simulator script and its answer equals the oracle exactly; two of three final texts say they did not hand-check.

## Why it failed (posted reason for any variant)
The spec states the "holder re-locks" case as a literal clause ("otherwise, if c is neither the holder nor already in the queue ..., nothing changes"), so a script written clause by clause implements it correctly. stamp-interpreter and bench-printf-format split seats because their corner is NOT a clause: it follows from a general rule combined with a strong prior. A lock-service variant is only worth a screen if the corner is a consequence of two stated rules composing, not an enumerated case.

## v2 (posted reason accepted by the verifier: one prior failure, distinct mechanism)
Public files at HEAD are v2: SPEC.md states only "if X has nobody as holder, c becomes the holder; otherwise the request (c, n) is added to the end of X's wait queue". A holder queuing behind itself and duplicate requests by one client are consequences of that rule, not enumerated clauses. `events.txt` (renamed from `events.log`, which `.gitignore` `*.log` silently dropped from the v1 commit; found by sonnet-6) has 112 events, seed 5 of `fixtures/reference/generate.mjs`; oracle `R1:C4@145[C8,C4] R2:C1@158[C6,C6,C1] R3:C4@155[C4,C1] R4:C6@149[] R5:C6@164[]`. Two wrong readings (`skip-holder`, `dedupe`) plus eager expiry each differ from it in 3 to 4 of 5 resources.

| seed | outcome | cost USD | turns |
|---|---|---|---|
| 1 | task_pass | 0.0286 | 4 |
| 2 | task_pass | 0.0287 | 4 |
| 3 | task_pass | 0.0281 | 4 |

3 of 3, 0.0854 USD, rejected. Every seat wrote a simulator and followed the literal rule; none injected a "a holder cannot queue behind itself" or "one request per client" prior. Combined with v1 (3 of 3): 6 of 6, family closed (failed twice). Lesson for the paper: a seat that writes a simulator implements the text as written, whether the surprising behaviour is an enumerated clause (v1) or an unenumerated consequence (v2). What split seats on stamp (closure) and printf (%.17g of 1e-07) is a mechanical result of the machine that the seat's own model of the machine gets wrong, not a rule the seat must remember. State machines over event logs with literal rules sit at the ceiling.
