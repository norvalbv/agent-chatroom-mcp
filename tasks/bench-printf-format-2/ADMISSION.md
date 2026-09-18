# Admission record: bench-printf-format-2 (scaled sibling of bench-printf-format)

Author: sonnet-7. Room: swarm-150725-3vny-room. Built as a turn of the difficulty dial the maintainer asked for in #163 ("if you scale it, score more hard cases so failures spread"). Same family as bench-printf-format: the same `format(fmt, ...args)` function, the same README with three more rule clusters, and the same oracle source (the C library `printf`).

## Status: BELOW BAND (2 of 10 = 0.20), not admitted to the primary comparison; kept as evidence
The bar (>= 10 arm-A seeds, rate 0.3 to 0.7) is not met from below. This task is not counted as a separate task: it is the same family as bench-printf-format, and its seats fail for the same single reason (see "What the failures are").

## Task
Everything in `../bench-printf-format/ADMISSION.md`, plus in `public/README.md`: length modifiers `hh h l ll` with reduction of the argument to 8, 16, 32 (absent) or 64 bits in two's complement, the `u` conversion, negative arguments for `x X o u`, and `*` for width and precision (consumed before the value; negative width is the `-` flag, negative precision is no precision). `oracle/cases.json` holds 3012 cases: the 698 v1 cases (integer conversions that do not fit in 32 bits gained an `l` modifier; each one's expected text is unchanged and was re-checked against libc) and 2314 new ones (modifiers x conversions x 28 boundary values, flag and width variants, `*` combinations including negative widths and precisions, `*` with `s`, `c` and floats). Every expected string comes from the C library through `oracle/lib2.c` (`oracle/gen-cases.mjs` rebuilds the file); the reference (`fixtures/correct/format.ts`, written from the README) agrees on all 3012. Scored by `oracle/score.ts` (kind `printf-format`), all cases must pass. Hardening as in v1 (`child_process` patched, source regex); the scorer now sets `process.exitCode` instead of calling `process.exit`, because a piped stdout of this size was truncated at 64 KB by an immediate exit.

## Arm A pilot: one Claude Sonnet seat, `scripts/bench-rq1.ts tasks/bench-printf-format-2 A <seed> --root <dir>`, default flags
| seed | outcome | cost USD | turns | cases failed |
|---|---|---|---|---|
| 1 | task_pass | 0.0920 | 5 | 0 |
| 2 | task_pass | 0.0918 | 5 | 0 |
| 3 | task_fail | 0.0801 | 4 | 2 |
| 4 | task_fail | 0.0962 | 5 | 2 |
| 5 | task_fail | 0.0862 | 5 | 2 |
| 6 | task_fail | 0.0875 | 5 | 2 |
| 7 | task_fail | 0.0907 | 5 | 2 |
| 8 | task_fail | 0.0923 | 5 | 2 |
| 9 | task_fail | 0.0848 | 4 | 2 |
| 10 | task_fail | 0.0889 | 5 | 2 |

Pass rate 2 of 10 = 0.20 (exact 95% interval roughly 0.03 to 0.56). Total cost 0.8905 USD (seeds 1-3 screened first, then 4-10). No format failures: every run wrote a loadable `format.ts`.

## What the failures are: one root cause, again
All eight failures fail exactly the same two cases and nothing else: `%.17g` of 1e-07 and `%#.*g` with precision 17 of 1e-07 (expected `9.9999999999999995e-08`). None of the 2314 new cases was failed by any of the ten seats, so the length-modifier, `u`, negative-unsigned and `*` clusters did not add difficulty at all: once the README states a rule, a seat implements it. The failure is the same design decision that failed the v1 seats: the decimal exponent of a value whose exact binary value sits just below a power of ten, at a precision high enough that rounding does not carry into the next power.

An offline re-score of the five v1 seed 6-10 workspaces on an 82,460-case pool of such values (powers of ten from 1e-45 to 1e45, their neighbours one ulp either side, 9.5 / 9.9999995 / 5 / 1.5 times each power, precisions 0 to 25 for `e`, `f`, `g`, `#g`) showed the three failing seats failing the identical 726 cases and the two passing seats failing none. So adding more cases of that kind cannot spread the failures either: a seat either has this bug or it does not. The rate of the printf family is the probability of that one decision.

## Reading the two printf records together
Both tasks are one family with one trap. Pooled over the same seat and the same trap: v1 5 of 10 pass, v2 2 of 10 pass, together 7 of 20 = 0.35 (exact 95% interval roughly 0.15 to 0.59). The difference between 5 of 10 and 2 of 10 is not significant (Fisher exact p about 0.33), so the best estimate of the family's single-agent rate is the pooled 0.35, not either half. Choosing v1 for the primary suite because its ten seeds landed at 0.5 is selection after the fact; if it is used, the paper must say the printf family was piloted twice, report both records, and expect a true single-agent rate nearer 0.35 than 0.5.

## Attack
- Determinism and oracle: independent of any reviewer, ten Claude seats each wrote `format.ts` from `public/README.md` alone; eight of them (seeds 3 to 10) pass 3010 of 3012 cases and the other two pass all 3012, and the two cases the eight miss are explained by the exponent rule the README states ("X is the exponent after rounding"). So the README determines every expected value. The reference agrees with libc on all 3012.
- Gaming: as v1 (the scorer's `child_process` patch and source regex; `public/` holds only the README, the stub, the brief and `package.json`).
- No hub-assigned reviewer has attacked this record; it is not proposed for the primary suite.
