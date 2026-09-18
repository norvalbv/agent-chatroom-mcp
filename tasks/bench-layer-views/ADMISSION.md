# Admission record: bench-layer-views

Status: REJECTED at the 3-seed screen (3 valid runs, 3 of 3 pass; one further run excluded as an output-format failure). Retired (above the 0.9 bar). Not in any grid. Dial turn 2 on the layered-rules family (parent bench-layer-rules 44 keys 3 of 3; turn 1 bench-layer-rules-400 3 of 3): the same family, no new family.

Author: sonnet-6. Attacker: sonnet-1 (hub-assigned). Room: swarm-150725-3vny-room.

## Task
The 400-key, six-layer program of `bench-layer-rules-400` (same generator, `oracle/gen.mjs 7 400 30`) with one added, stated rule: VIEWS. The view of a layer L is the program with every stronger layer (rules and SEALs) removed; a `$k` inside a rule of layer M, in its value or its WHEN condition, reads k in the view of M, whatever view the rule is being considered in; SHOW reads the view of the strongest layer. The spec carries a worked example (`5 11 6`). The design bet: the natural resolver memoises one value per key, and this rule needs a value per (key, view), with each winning rule reading in its own layer's view. Exact answer, 400 integers, all-or-nothing.
`scripts/layer-views-task.test.ts` (6 tests): the reference reproduces the spec example; the global-memo reading and the imperative reading differ from the answer in 262 and 281 of 400 tokens; the oracle differs from the parent's answer in 262 of 400. `oracle/independent-check.py` (resolver over (key, view) written from `spec.txt`, not from the reference) matches all 400 values.

## Arm A screen: `scripts/bench-rq1.ts tasks/bench-layer-views A <seed> --root <dir>`, default flags
| seed | outcome | cost USD | turns | note |
|---|---|---|---|---|
| 1 | task_fail, EXCLUDED as invalid | 0.1524 | 5 | answer.txt holds 401 values: the first 400 equal the oracle exactly, a stray trailing `400` (a count printed by its script) makes the line wrong |
| 2 | task_pass | 0.1454 | 4 | |
| 3 | task_pass | 0.1453 | 4 | |
| 4 (replacement) | task_pass | 0.1502 | 5 | |

Counted screen: seeds 2, 3, 4 = 3 of 3, 0.4409 USD; with the excluded run the task cost 0.5932 USD. Ruling by the verifier (message #293): a format failure is never counted as a reasoning failure; a task admitted on a stray print would be a format-hygiene test. Seed 1 is kept in the table, not in the rate. For the paper: a seat's script can sink a 400-token exact answer with one stray print, and the harness scores that as `task_fail`; on this task 1 of 4 runs did.

None of the four seats applied the whole-program-view reading (which would differ in 262 of 400 tokens): the views rule, stated once with a worked example, was implemented correctly by every seat that produced a well-formed answer.

## Attack
- sonnet-1: to be recorded from the room (hub-assigned attacker for the parent, `bench-layer-rules-400`, was sonnet-1: fresh solver matched all 400 values; this task adds the VIEWS section, re-derived by the author's independent check).

## Reading
A stated rule that names the construct, even one that defeats the natural architecture (one global value per key), is followed: seats wrote a resolver keyed by (key, view). Same diagnosis as jensen-machine (call-by-name), lode-values, arrow-fn-values, gleam-machine. Combined with the parent's two turns (44 to 400 keys, then a contextual-read rule) the layered-rules family has four screened variants, all at ceiling; closed.
