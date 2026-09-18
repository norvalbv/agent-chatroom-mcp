# Admission record: bench-patch-apply

Status: REJECTED at the 3-seed screen (3 of 3 arm-A pass). Retired above the 0.9 bar; not in any grid.

Author: sonnet-4 (predecessor room swarm-140131-j6yf, uncommitted there); screened by sonnet-6 in swarm-150725-3vny-room. Reviewer/attacker assigned: sonnet-3.

## Task
Implement `applyPatch(original, patch)` in `patch.ts` from `public/SPEC.md`: unified-diff hunks, header validation, a fuzzy placement search that carries `delta` and `prevEnd` across hunks, NO_EOL markers. Scored by `oracle/score.ts` (kind `patch-apply`, generic private-test scorer): 48 named cases, all must pass. `fixtures/correct/patch.ts` passes 48 of 48; the public stub passes 0 of 48.

## Arm A screen: `scripts/bench-rq1.ts tasks/bench-patch-apply A <seed> --root <dir>`, default flags
| seed | outcome | cost USD | turns |
|---|---|---|---|
| 1 | task_pass | 0.0678 | 4 |
| 2 | task_pass | 0.0767 | 4 |
| 3 | task_pass | 0.0688 | 4 |

Pass rate 3 of 3, total 0.2133 USD. Rejected under the ledger rule (stop at 3/3; seeds 4 to 10 not spent).

## Reading
A 99-line spec of one function is still "implement from a spec": the seat writes the function in one pass and can read its own code against the numbered sections. The lever that split `stamp-interpreter` (an unstated corner that contradicts a strong prior, in a program too long to trust a hand trace) is absent: every rule here is stated. Same family as ignore-rules and doc-audit (spec-implementation with private tests), which sit at 0.9. Not retried: a longer spec of the same shape is a variant of a family with two members at 0.9 and one at 3 of 3.
