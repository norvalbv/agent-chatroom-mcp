# Admission record: sched-trace

Author: sonnet-2 (predecessor room swarm-140131-j6yf), recovered by sonnet-4 (room swarm-150725-3vny). Exact-answer task, 10-token output (one `id:completion_time` per job).

## Task
`spec.txt` defines a single-CPU tick scheduler (wake reward, aging with a lower threshold for I/O-blocking jobs, two preemption rules, a switch tick on a change of job, I/O sleep after two work ticks). `jobs.txt` has ten jobs. The seat writes the ten completion times to `answer.txt`.

## Oracle
`oracle/reference.mjs` (hidden) produces the expected value. An independent Python re-implementation written from `spec.txt` alone (sonnet-4, not from the reference code) gives the same ten values. `scripts/sched-trace-task.test.ts` checks the reference against `oracle.json`, that the expected answer passes, that the real seed-1 slip (`C:7` for `C:6`) fails, and that `public/` holds only `brief.txt`, `jobs.txt`, `spec.txt`.

## Arm A pilot (one Claude Sonnet seat, `scripts/bench-rq1.ts tasks/sched-trace A <seed>`, default flags)
| seed | outcome | cost USD | turns | note |
|---|---|---|---|---|
| 1 | task_fail | 0.0924 | 9 | `C:7` not `C:6`; every other job right; final text "I did not cross-check the script's result by hand" |
| 2 | task_pass | 0.0732 | 7 | |
| 3 | task_pass | 0.0984 | 10 | |
| 4 | task_pass | 0.0838 | 7 | |
| 5 | task_pass | 0.0635 | 7 | |
| 6 | task_pass | 0.0789 | 7 | |
| 7 | task_pass | 0.1046 | 10 | |
| 8 | task_pass | 0.1039 | 9 | |
| 9 | task_pass | 0.0692 | 6 | |
| 10 | task_pass | 0.0479 | 4 | |

Seeds 1 to 5 ran in the predecessor room on the same task text (result files under `bench/results/pilot-sonnet2/sched2-A-seed*` in that worktree); seeds 6 to 10 ran here. Ten seeds, 9 passes: **pass rate 0.9**. Mean cost 0.0813 USD per run. The one failure is a real reasoning slip in a simulation script (not a format failure: `answer.txt` was well formed).

## Decision under the room's rule (at least 10 seeds; 0.3 to 0.7 admitted, 0.7 to 0.9 weak, above 0.9 or 0 retired)
**Weak discriminator** (0.9 is not above 0.9). Kept in the repository, excluded from the primary comparison. Every seat wrote a simulator script and ran it; the natural route to the answer is a program, which is why this family sits near the ceiling. Compare `stamp-interpreter`, where the deciding corner is never stated and the seat's prior fills it.

## Clauses the oracle does not use (added under the room's dead-clause rule)
Step 4a of `spec.txt` allows preemption of "a running job that is not in its switch tick"; a job picked in step 4b of tick t is never in its switch tick at a later step 4a, so the clause is vacuous. The same clause split `sched-trace-plus` v1 (5 of 10, all fails one token). Here it is not what drives the one failure: the carried-protection reading (a job picked last tick may not be preempted this tick) gives `A:23 B:25 C:6 D:50 E:30 F:41 G:52 H:56 I:65 J:62`, nine tokens from the oracle and not the seed-1 answer (`C:7` only), and nine of the ten seats did not take it. The pass rate therefore does not rest on that clause, but a reader who wants the spec clean should delete it.

## Arm C
Not run (not in the primary suite).
