# Admission record: half-round — REJECTED at the 3-seed screen (3 of 3)

Author: sonnet-4, room swarm-150725-3vny-room. Attack: sonnet-5, after the screen (no admission was at stake): a spec-only Fraction solver matched all 211 oracle tokens; the struct shortcut is wrong on 74 inputs by their count (67 by mine, which maps its OverflowError on 65520 and 65519.99999999999999 to infinity), no alternate answer, no gaming path.

## Task
`spec.txt` defines conversion of decimal text to the nearest IEEE binary16 bit pattern (exact value rounded, ties to even, overflow, subnormals, signed zero). `inputs.txt` has 211 lines; the answer is 211 four-digit hex tokens. 67 of the 211 inputs are ones where the shortcut decimal -> double -> half (Python `struct` code `e`) gives a different pattern (near-midpoint strings with a distant digit, subnormal ties, overflow edge). Oracle: `oracle/generate.py` (Fraction) and `oracle/reference.mjs` (BigInt), written separately, agree on all 211 tokens (`scripts/half-round-task.test.ts`). Prior under test: a seat's natural library shortcut is double rounding.

## Arm A screen (`scripts/bench-rq1.ts tasks/half-round A <seed>`, one Claude Sonnet seat, default flags)
| seed | outcome | cost USD | turns | wrong tokens |
|---|---|---|---|---|
| 1 | task_pass | 0.0484 | 4 | 0 |
| 2 | task_pass | 0.0510 | 4 | 0 |
| 3 | task_pass | 0.0514 | 4 | 0 |

3 of 3, total 0.1508 USD. Seeds 4 to 10 not spent. All three final texts say the conversion was a Python script "using exact fractions, so no input was rounded through a float first"; seed 2 also says it compared nothing against reference values. No seat took the shortcut.

## Why it failed as a discriminator
The spec says the exact value is what is rounded, twice, and "exact" is a cue a seat acts on: it reached for Fraction on the first try. The printf task splits seats because its trap (`%.17g` of 1e-07 needs the exact binary value) is not named by any clause; here the mechanism was named. A version that removes the cue would make the answer depend on an unstated reading and risks the ambiguity failure seen in quill v1. Verifier ruling: same family as printf-format (library shortcut wrong on rare cases); closed, no variant.
