# Admission record: bench-layer-rules-400

Status: REJECTED at the 3-seed screen (3 of 3 arm-A pass). Retired (above the 0.9 bar). Not in any grid. Dial turn 1 on bench-layer-rules (sonnet-7, 44 keys, 3 of 3, source recovered from commit 62e4074 of swarm/swarm-150725-3vny/sonnet-7); the same family as its parent, and as `bench-layer-views` (turn 2).

Author of the scaling: sonnet-6. Attacker: sonnet-1 (hub-assigned). Room: swarm-150725-3vny-room. Maintainer directive #163: scale a task that landed 3/3, do not invent a new family.

## Task
LAYERS, a layered-configuration language (`LAYER n r`, `SET`/`UNSET` with optional `WHEN`, `SEAL`, `$k` references, later layers of stronger rank win, ties by first opening, a reopened layer keeps its first rank, the latest line wins inside a layer, a seal discards the candidates of weaker layers). Every rule is stated in `spec.txt`, unchanged from the parent. Dial: 44 keys to 400, five layers to six (a rank tie between `region` and `user`), reference window 12 to 30, so the program is 1265 lines and the answer 400 integers on one line, all-or-nothing. Generator: `oracle/gen.mjs 7 400 30` (checked-in output is what seats see, `scripts/layer-rules-400-task.test.ts` checks that). The imperative top-to-bottom distractor differs in 313 of 400 tokens. `oracle/independent-check.py` is a resolver written from `spec.txt` alone and matches all 400 values.

## Arm A screen: `scripts/bench-rq1.ts tasks/bench-layer-rules-400 A <seed> --root <dir>`, default flags
| seed | outcome | cost USD | turns |
|---|---|---|---|
| 1 | task_pass | 0.1453 | 5 |
| 2 | task_pass | 0.1588 | 5 |
| 3 | task_pass | 0.1437 | 5 |

3 of 3, 0.4477 USD. Rejected under the ledger rule; seeds 4 to 10 not spent. Every seat wrote a resolver script, ran it, and reported all 400 values from it.

## Attack
- sonnet-1: wrote a fresh 80-line memoised Python solver from `public/` alone; oracle.json seen only after solving. It reproduced all 400 values on the first run. Mutant readings each changed the answer (a later LAYER rank overriding, earliest line winning inside a layer, equal-rank ties to the last-opened layer, SEAL ignored, WHEN ignored). Not exercised by this program: strongest versus weakest seal when several layers seal one key. Gaming: 400 integers, nothing leaked in `public/`, unguessable.

## Reading
Scale (nine times the scored items, a longer reference chain, an extra layer) did not move the rate: every rule is one stated clause and a memoised resolver implements clauses. Same diagnosis as lease-lock, eager-forms, gleam-machine. The parent's independent lesson stands: literal-rule simulators are at ceiling however long the program.
