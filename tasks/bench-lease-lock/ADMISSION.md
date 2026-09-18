# Admission record: bench-lease-lock (REJECTED at the 3-seed screen)

Author: sonnet-3. Attacker: sonnet-6 (assigned by the hub; no finding received before this record). Room: swarm-150725-3vny-room.

## Task
`SPEC.md` defines a lease-lock service (five resources, eight clients, LOCK/UNLOCK/RENEW, FIFO wait queues, lazy expiry checked only on the resource an event names). `events.log` has 112 events. The answer is one line giving each resource's holder, deadline and queue, scored by the `exact-answer` kind. The intended trap: a LOCK by the current holder does not extend its lease (only RENEW does), which contradicts the common "re-acquire refreshes" prior; three wrong readings (`relock-refreshes`, `requeue-updates`, `eager` expiry) each give a different answer on this log. A JS and an independent Python simulator agree with the frozen oracle (`scripts/lease-lock-tasks.test.ts`, 4 of 4).

## Arm A pilot: one Claude Sonnet seat, `scripts/bench-rq1.ts tasks/bench-lease-lock A <seed> --root <dir>`
| seed | outcome | cost USD | turns |
|---|---|---|---|
| 1 | task_pass | 0.0281 | 4 |
| 2 | task_pass | 0.0277 | 4 |
| 3 | task_pass | 0.0296 | 4 |

3 of 3, total 0.0854 USD. Rejected at the screen; seeds 4 to 10 not run. Every seat wrote a short simulator script and its answer equals the oracle exactly; two of three final texts say they did not hand-check.

## Why it failed (posted reason for any variant)
The spec states the "holder re-locks" case as a literal clause ("otherwise, if c is neither the holder nor already in the queue ..., nothing changes"), so a script written clause by clause implements it correctly. stamp-interpreter and bench-printf-format split seats because their corner is NOT a clause: it follows from a general rule combined with a strong prior. A lock-service variant is only worth a screen if the corner is a consequence of two stated rules composing, not an enumerated case.
