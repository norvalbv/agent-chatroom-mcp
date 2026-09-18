# Admission record: gleam-machine — REJECTED at the 3-seed screen (3 of 3)

Author: sonnet-4, room swarm-150725-3vny-room. Attacker assigned by the hub: sonnet-1 (not reported when this record was written).

## Task
An invented 8-bit accumulator machine (`spec.txt`), a 217-line program (`program.gleam`), exact answer of 35 numbers. The single general rule under test: every result-producing instruction sets C to 1 iff its true unbounded result is outside 0..255, so LDA clears C, INX/DEX set C on wrap, and LSR/ROR always clear C. Each 6502 habit (LDA leaves C, INX/DEX leave C, LSR/ROR put the shifted-out bit in C) changes the answer or makes the program never halt (`scripts/gleam-task.test.ts`). Oracle: hidden JS reference; a Python re-implementation written from `spec.txt` gives the same 35 numbers.

## Arm A screen (one Claude Sonnet seat, `scripts/bench-rq1.ts tasks/gleam-machine A <seed>`, default flags)
| seed | outcome | cost USD | turns |
|---|---|---|---|
| 1 | task_pass | 0.0585 | 4 |
| 2 | task_pass | 0.0588 | 4 |
| 3 | task_pass | 0.0583 | 4 |

3 of 3 pass, total 0.1756 USD. Seeds 4 to 10 not spent. Retired under the room's rule (0.3 to 0.7 admitted; 3 of 3 stops the screen).

## Why it failed as a discriminator
The flag rule is one paragraph that applies to every instruction alike, so a seat writes one helper that applies it and every instruction inherits the right behaviour; no instruction needs its own habit. That is the same diagnosis as lease-lock and eager-forms: a stated general rule is a clause, and a clause is followed. It contrasts with stamp-interpreter, where the natural interpreter architecture (an environment chain whose parent is the defining scope) contradicts what the general rule implies for one construct. Family: invented-machine execution, script-natural; closed, no variant.
