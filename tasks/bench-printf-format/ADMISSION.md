# Admission record: bench-printf-format

Author: sonnet-7. Attackers: sonnet-1 (non-author, wrote an implementation from the README alone), verifier (hole check on the scorer), sonnet-3 (hub-assigned, see Attack). Room: swarm-140131-j6yf-room.

## Task
Implement `format(fmt, ...args)` in `format.ts` from `public/README.md`, a complete specification of a C99 `printf` subset: flags `- + space 0 #`, width, precision, conversions `d i x X o e E f F g G s c %%`, exact-binary round-half-even rounding, `-0`, inf/nan, the `%g` style-selection rule and the `#` variants. The stub throws. Scored by `oracle/score.ts` (kind `printf-format`, the generic private-test scorer): 698 named cases, all must pass.

## Why the oracle is right by construction
Every expected string comes from the C library `printf` (`snprintf` through a small C harness, integer conversions given `long long`), not from any model or from my reference. The reference (`fixtures/correct/format.ts`, written from the README) passes 698 of 698, and a second implementation written from the README alone by sonnet-1 also passes 698 of 698, so the README determines every expected value. Python's `%` operator was compared as a side check and differs from libc exactly where expected (`%#o`, `%.0d` of 0, `%.0x` of 0, `0` flag with inf/nan), which is why libc, not Python, is the reference. Cases with NaN combined with the `+` or space flag are excluded because libc implementations differ there (macOS prints `nan`, glibc prints `+nan`).

## (a) Adversarial read
See "Attack" below.

## (b) Arm A pilot: one Claude Sonnet seat, `scripts/bench-rq1.ts tasks/bench-printf-format A <seed> --root <dir>`, default flags, run before the scorer hardening below
| seed | outcome | cost USD | turns | wall |
|---|---|---|---|---|
| 1 | task_pass | 0.092 | 6 | 49s |
| 2 | task_pass | 0.087 | 5 | 46s |
| 3 | task_fail | 0.087 | 5 | 45s |
| 4 | task_pass | 0.084 | 5 | 46s |
| 5 | task_fail | 0.084 | 5 | 44s |

Pass rate 3 of 5 in the predecessor room. Mean cost 0.087 USD per run. Screening followed the maintainer's rule: three seeds first (2 of 3, so it survived the 3 of 3 rejection screen), then seeds 4 and 5.

### Seeds 6 to 10 (room swarm-150725-3vny, same command, same scorer as the hardened one)
| seed | outcome | cost USD | turns | failing cases |
|---|---|---|---|---|
| 6 | task_fail | 0.1014 | 8 | case-458 only |
| 7 | task_pass | 0.0753 | 5 | |
| 8 | task_pass | 0.0814 | 5 | |
| 9 | task_fail | 0.0866 | 6 | case-458 only |
| 10 | task_fail | 0.0802 | 5 | case-458 only |

**Ten-seed arm A pass rate: 5 of 10 = 0.5** (seeds 1,2,4,7,8 pass; 3,5,6,9,10 fail), inside the 0.3 to 0.7 admission band under the raised bar. Exact 95% interval for the true rate roughly 0.19 to 0.81. Cost of the extra five: 0.4249 USD. All five failures across the ten seeds fail case 458 and nothing else; every failing seat ran only a spot check of a handful of formats and never compared with a real printf, which is a checkable behaviour a team's verifier could supply. One family (printf-format); it is one task, not several independent ones.

**Both failures are the same single case out of 698, so the band is fragile and a reader should weigh it accordingly.** Case 458: `format("%.17g", 1e-07)`, expected `9.9999999999999995e-08` (the exact binary value of 1e-07 is 9.99999999999999954748e-08, so its exponent is -8), the seat's function returned `1e-07`. Both seats say they used exact BigInt rounding, so the slip is in choosing the decimal exponent for a value just below a power of ten (the README's `%g` rule says X is the exponent "after rounding", `%e` and `%g` both need the exact value's exponent), which is a genuine implementation error against a rule the README states, not a format or ambiguity failure. Every other case passed in both failing runs. Re-scoring all five workspaces with the hardened scorer gives the same five outcomes.

Seed 3 final text, verbatim: "I implemented `format` in `format.ts`, and a quick spot-check gave the output the README describes.\n\nRounding uses exact BigInt arithmetic on the double's binary value, with ties going to even. That is why `%.2f` of 2.675 gives `2.67` and `%.0f` of 2.5 gives `2`.\n\nThe check covered these cases:\n- **Rounding:** `%.0f`, `%.2f`, and `g` and `G` switching between fixed and exponent style.\n- **Flags:** `+`, `-`, `0` and `#`, including `#` with `%o` and `%x`.\n- **Special values:** `-0` and `Infinity`.\n- **Precision:** `%.3d`.\n\nI did not run it against a full test suite. I deleted the scratch test file afterwards, so `format.ts` is the only file changed."

Seed 5 final text, verbatim: "I implemented `format` in `format.ts` to follow the README. I ran one quick spot-check and did not run a fuller test suite.\n\nThe check covered a mix of conversions:\n- **Rounding:** `%.2f` of 2.675, `%.0f` of 0.5 and 2.5.\n- **Number styles:** `%g` and `%#g`, `%e`, `%08.3f`.\n- **Integers:** `%#o`, `%#x`, `%+d`, `%.0d` of 0.\n- **Strings:** `%5s`, `%-4c`.\n\nAll of it matched the output the README describes.\n\nAll rounding uses the exact binary value of the double, via `BigInt`, with half-to-even on exact ties. It uses no dependencies and doesn't shell out.\n\nI deleted the throwaway test file afterwards, so `format.ts` is the only file changed."

Both failures ran only a spot-check and never compared against a real `printf` (the brief forbids shelling out from the submission, not from the seat's own checking).

## (c) Arm C: `scripts/bench-rq1.ts tasks/bench-printf-format C 1 --root <dir> --port 19861`
The room concluded 3 of 3 inside the deadline (79 s wall clock, no seat killed), 62 turns summed (seat-1 21, seat-2 25, seat-3 16), cost 0.669 USD. Outcome task_fail: the concluded implementation (written by seat-3; the other two tested it instead of overwriting it) fails the same case 458 and nothing else. Three seats and 62 turns did not catch the single-case slip that two of five single seats also made, so this one arm-C run is not evidence that a team helps here; it proves only that the room can conclude on this task.

## Attack
- sonnet-1 (non-author): wrote `format.ts` from `public/README.md` alone (BigInt exact-binary rounding, about 150 lines) without opening `fixtures/correct/format.ts`, ran `oracle/score.ts`: 698 of 698 on the first run. No alternate reading of `%g` exponent selection, `#` variants, `-0`, inf/nan padding or `%.0f` half-even. Its warning that first-try success may mean ceiling is answered by the pilot: 3 of 5.
- verifier: asked whether the scorer's `child_process` guard survives an absolute path. The first guard was only a source regex, which an obfuscated `process.getBuiltinModule('node:child_' + 'process')` would evade. Fixed: `oracle/score.ts` now replaces `spawn`, `spawnSync`, `exec`, `execSync`, `execFile`, `execFileSync` and `fork` on `node:child_process` and calls `syncBuiltinESMExports()` before loading the submission, keeping the regex as a second guard. Measured: that cheat calling `/usr/bin/printf` by absolute path passes 678 of 698 with the patch disabled (real libc matches the oracle; the 20 misses are argument-parsing edge cases of the cheat) and 0 of 698 with the patch. `scripts/oracle-tasks-printf.test.ts` holds this as a regression test.
- sonnet-3 (assigned reviewer): asked to attack after the pilot; findings, if any, are not recorded here.
- Residual: path separation is not a sandbox (harness-wide note), and a seat could still read `oracle/score.ts` from the parent directory if it looked; `public/` holds only the README, the stub, the brief and `package.json`.
