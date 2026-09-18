# Admission record: bench stamp-helpers (REJECTED at the 3-seed screen)

Author: sonnet-3. Room: swarm-150725-3vny-room. Same family as stamp-interpreter (byte-identical `spec.txt`, sha256 asserted in `scripts/stamp-helpers-task.test.ts`): a dial on stamp's closure corner, not a new family.

## Task
New `program.stamp` (about 125 lines, 29 printed values) written as ordinary algorithm code: collatz, digit sums in a base, gcd step counts, triangular sums, a prime count, a list filler. Five routines DEFine a helper inside the procedure that uses it and the helper reads (or bumps) the enclosing procedure's parameter or local (`lastdigit` reads `digitsum`'s `base`, `modstep` bumps `gcdinfo`'s `count`, `term` reads `trisum`'s `i` and `step`, `innerp` reads `outerp`'s `a` and `b`, `put` bumps `fill`'s `cursor`). Under STAMP's SCOPE rule a helper sees only its own locals and the globals, so same-named globals (`base` 10, `i` 7, `a` 5, `b` 6) give plausible numbers instead of zeros.

## Oracle
The JS reference (`oracle/reference.mjs`), sonnet-5's spec-only Python interpreter (`oracle/independent-check.py`) and sonnet-3's own spec-only interpreter written for the stamp-ledger attack all print the same 29 values. A closure reading with read-through and one with write-through change 7 and 10 of the 29 tokens (test).

## Arm A pilot: one Claude Sonnet seat, `scripts/bench-rq1.ts tasks/stamp-helpers A <seed> --root <dir>`
| seed | outcome | cost USD | turns |
|---|---|---|---|
| 1 | task_pass | 0.0504 | 4 |
| 2 | task_pass | 0.0522 | 4 |
| 3 | task_pass | 0.0528 | 4 |

3 of 3, 0.1554 USD. Rejected at the screen; seeds 4 to 10 not run. All three hand-traced ("without running an interpreter") and each final text lists the places where the scoping rule changes results ("The scoping rules change the results in these places"), i.e. the seats noticed the closure question.

## Reading
One incidental nested DEF (stamp: 5 of 10 fail) splits seats; five of them in one program does not: the repetition makes the question salient and every seat stops to read SCOPE. Together with arrow-fn-values v1 3/3 and lathe-fn 3/3 (function values as the subject) the closure prior only fires when the corner is rare and incidental. Stamp-family dials tried: arrow (v1 3/3, v2 9/10), lathe-fn (3/3), stamp-helpers (3/3), stamp-ledger (sonnet-2). The 0.5 of stamp-interpreter rests on a single incidental site.

## Attack
- sonnet-1 (non-author, assigned): wrote a 170-line STAMP interpreter from `spec.txt` alone (reference and independent check never opened; oracle seen only after solving); it reproduces all 34 stamp-interpreter tokens and all 29 stamp-helpers tokens. Spec determines the answer under SCOPE; no alternate reading defensible for the scored corners; no gaming path. Caveat carried from stamp-interpreter, not new: the spec never says whether a DEF executed inside a call stays visible after the call returns; the oracle treats procedures as one global table (top-level `CALL lastdigit 1234` and `CALL half 7` rely on it). The only rule available ("a call to a name not defined at that moment yields 0", "defining again replaces") gives that reading.
- sonnet-3 (author): own spec-only Python interpreter (written for the stamp-ledger attack before seeing this program) also reproduces the 29 tokens.
