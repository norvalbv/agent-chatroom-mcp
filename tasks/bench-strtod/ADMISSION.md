# Admission record: bench-strtod

Status: REJECTED at the 3-seed screen (3 of 3 arm-A pass). Retired (above the 0.9 bar). Not in any grid.

Author: sonnet-6. Attacker: verifier (hub-assigned). Room: swarm-150725-3vny-room.

## Task
Implement `strtod(s)` in `strtod.ts` from `public/README.md`: C99 strtod in the C locale returning `{ bits, end }` (the 16-hex-digit binary64 pattern, or `nan`, and the number of characters consumed). Prefix grammar (whitespace set, sign, hexadecimal floats with a binary exponent, `inf`/`infinity`, `nan(...)`, decimal with optional exponent, `0x` alone consuming just the `0`, a dangling `e` or `p` left over) and correct rounding of the exact value in one step (ties to even, subnormals, overflow to infinity, a rounded-to-zero value keeps its sign). Scored by `oracle/score.ts` (kind `strtod`, generic private-test scorer): 543 hidden cases, all must pass.

Oracle: `oracle/gen_cases.py` computes expected values with Python (`float`, `float.fromhex`) under the README grammar and cross-checks each against the real libc `strtod` through ctypes; a case libc disagrees with is dropped. 546 candidates: 543 kept, 2 dropped (`nan(a b)` and `nan(a-b)`: this macOS libc consumes past the `)` for non-n-char content, the README says only `nan` is consumed), 1 duplicate removed. An independent TypeScript reference (`fixtures/correct/strtod.ts`, exact BigInt rounding) passes 543 of 543; the stub passes 0; `scripts/strtod-task.test.ts` shows a naive Number-arithmetic hex implementation and a submission that shells out to python both fail (child_process is disabled before the submission loads).

## Arm A screen: `scripts/bench-rq1.ts tasks/bench-strtod A <seed> --root <dir>`, default flags
| seed | outcome | cost USD | turns |
|---|---|---|---|
| 1 | task_pass | 0.0759 | 4 |
| 2 | task_pass | 0.0677 | 4 |
| 3 | task_pass | 0.0804 | 4 |

3 of 3, 0.2240 USD; 543 of 543 cases in every run. Rejected under the ledger rule (stop at 3/3; seeds 4 to 10 not spent).

## Reading
All three seats implemented the hexadecimal path with BigInt and a single explicit round-half-even step, the exact route the README's "single rounding step" sentence points to, and used the prefix grammar clause by clause. The brief's "do not run any other program" made every seat report "I haven't run it or any tests", so the near-ceiling rate is not a product of self-testing. The trap the design bet on (double rounding through Number arithmetic, a `Number()`-only parse) needs a seat that does not read "in a single rounding step". printf's split (5 of 10, one case, `%.17g` of 1e-07) is not reproduced by a stated-exactly reimplementation of a second libc function: stated exactness is followed. Same mechanism class as `bench-printf-format` (exact floating-point conversion, libc reimplementation); not retried.
