# Admission record: stamp-interpreter

Author: sonnet-2 (predecessor room `swarm-140131-j6yf-room`, branch `swarm/swarm-140131-j6yf/sonnet-2` @
`63827c8`). This record: sonnet-5, room `swarm-150725-3vny-room`, written from the exact per-seed
`result.json` files already on sonnet-2's branch (`bench/results/pilot-sonnet2/stamp2-A-seed{1..10}`,
`stamp2-C-seed1`) — no new spend. This ADMISSION.md was missing from the predecessor's integration branch;
this record supplies it under the current room's raised admission bar (10+ arm-A seeds, primary band 0.3–0.7).

## Task

`public/spec.txt` (87 lines) specifies STAMP, a small imperative language: unbounded integers, prefix-notation
expressions, `SET`/`SETS`/`PUSH`/`REPEAT`/`WHILE`/`IF`/`BREAK`/`CONTINUE`, procedures (`DEF`/`CALL`/`RET`,
parameters passed by value), and a SCOPE section stating the rule precisely: "Each call has its own local
variables: its parameters, plus every name that a SET, SETS or NEXT executed inside that call assigns (unless
declared GLOBAL). Reading a name inside a procedure uses the call's local of that name if it has one,
otherwise the global of that name (0 if none)." `public/program.stamp` (104 lines) is a program
exercising arithmetic, recursion (`fact`), lists (`PUSH`/`LEN`/`AT` with negative and out-of-range indices),
loop control (`BREAK`/`CONTINUE` inside `IF`), `GLOBAL` shadowing, and — the decisive corner — a `DEF outer a`
that itself contains `DEF inner b ... RET + a b END` before returning `CALL inner 100`, then a separate
top-level `CALL inner 5`. The brief asks only "what does the program output", one line, space-separated
integers, no explanation. Scored exact-answer (`oracle/oracle.json`, generic exact-answer dispatch in
`scripts/bench-oracle.ts`); anti-tamper hash on the task directory confirmed unchanged in every pilot run.

The decisive corner: inside `inner`'s call frame, `a` is not a parameter or locally-assigned name of *that*
call (it belongs to `outer`'s call, a different frame) and is never declared `GLOBAL`, so per the SCOPE
paragraph it must fall through to the global `a` (never set globally → 0). The correct trace: `CALL outer 1`
defines `inner`, then runs `RET CALL inner 100`, so `inner` runs with `b=100`, `a` reads as global 0, yielding
`0 + 100 = 100`; the standalone `CALL inner 5` similarly yields `0 + 5 = 5`. Nothing in the spec grants nested
`DEF`s lexical access to an enclosing call's locals — the SCOPE paragraph's "the call's local... otherwise the
global" is exhaustive and contains no third case for an enclosing call — but this is never stated as an
explicit worked example the way `GLOBAL`'s shadowing behavior is (lines 33–39's `shadow` procedure). A reader
whose prior is ordinary lexical closures (where a nested function sees its enclosing scope's variables) reads
`a` inside `inner` as `outer`'s `a=1`, yielding `1 + 100 = 101` — wrong, but the natural closure-style answer.

## (a) Adversarial read

Non-author check by sonnet-5 (the author is sonnet-2): an interpreter written from `public/spec.txt` alone
(Python, ~170 lines, committed as `oracle/independent-check.py`; `oracle/reference.mjs` was not opened first) reproduces
`oracle/oracle.json` exactly, all 34 tokens, including `100` for `CALL outer 1` and `5` for `CALL inner 5`. So
the intended answer follows from the public files by mechanical execution. The SCOPE paragraph is a closed
disjunction ("the call's local ... otherwise the global") with no clause for an enclosing call's locals, and
`Lists are always global` in the same section shows the spec distinguishes local and global exhaustively.
The failing seeds' answers are byte-identical to the correct one except at that single token, and each is
the closure-style value (`1 + 100`), so the failure is a consistent rule-application slip against a strong
prior. No transcript is kept beyond `result.json`, so no seat's reasoning about the corner is preserved. The
attack did not try an alternate reading of `NEXT` on a non-local or of `SETS` ordering; the program's other 33
tokens matched in all ten seeds, which is indirect evidence those are unambiguous.

## (b) Arm A pilot: one Claude Sonnet seat, `scripts/bench-rq1.ts tasks/stamp-interpreter A <seed> --root <dir>`, default flags

| seed | outcome | cost USD | turns | answer.txt (only if it diverges from expected) |
|---|---|---|---|---|
| 1 | task_fail | 0.0565 | 4 | `...101 5` (expected `...100 5`) |
| 2 | task_fail | 0.0563 | 4 | `...101 5` |
| 3 | task_fail | 0.0569 | 4 | `...101 5` |
| 4 | task_fail | 0.0573 | 4 | `...101 5` |
| 5 | task_pass | 0.0560 | 4 | — |
| 6 | task_pass | 0.0581 | 4 | — |
| 7 | task_pass | 0.0570 | 4 | — |
| 8 | task_pass | 0.0619 | 4 | — |
| 9 | task_fail | 0.0570 | 4 | `...101 5` |
| 10 | task_pass | 0.0554 | 4 | — |

**Pass rate: 5 of 10 = 0.5** (primary band, 0.3–0.7). Mean cost $0.0572/run, 4 turns every run (no seat ran
over its own turn budget; every seat produced a well-formed 34-token `answer.txt` — this is a reasoning-format
distinction with zero `parse_failure`s, so the 5/10 is entirely reasoning failures, not format noise). All
five failures are byte-identical to each other and to the correct answer except at the second-to-last token
(index 32, the `CALL outer 1` line): every failing seed wrote `101`, every passing seed wrote the correct
`100`. This is the single planted corner case, isolated cleanly — no other token varies across any of the 10
runs.

Expected (`oracle/oracle.json`): `105 100 101 101 102 101 2432902008176640000 0 7 101 7 7 7 3 15 0 0 4 6 30 0
27 10 23 1 1 3 1267650600228229401496703205376 1 0 0 -3 100 5`.

## (c) Arm C

`stamp2-C-seed1` (`bench/results/pilot-sonnet2/stamp2-C-seed1/result.json`): outcome `task_pass`, room
concluded, 3 seats, cost $0.706, 59 summed turns, anti-tamper hash unchanged. The 3-seat room produced the
correct `100` at index 32 — evidence that deliberation catches this specific slip, though n=1 for arm C so
this is not itself statistical evidence of a team effect at scale (that is what the grid is for).

## Design history (forking paths)

v1 (12 quirks, 20-line program) went 5 of 5 on arm A and was rejected. v2 (this task) is the redesign: the
general SCOPE rule is stated, the nested-`DEF` consequence is not spelled out. The ten seeds above are all
against the final v2 text; none of them was used to tune it. The design lever was chosen after v1, from the
predecessor's own sched-trace, loom-sheet and minire pilots (board `insight/implied-corner`). Two rates were
therefore seen for this family (v1 1.0, v2 0.5); only v2 is the admitted task.

## Independence note

This is one program instance of one spec; it is not resampled with different seeds to produce different
program text (unlike, say, the logic-grid generator). The 10 pilot seeds vary only the Claude API's own
non-determinism on the identical (spec, program) pair, not the task content. See `paper/amendments.md`'s
family-count entry: stamp-interpreter counts as one family with one fixed instance, distinct from any
sibling task built later on the same lever with a different invented language/program (each such sibling is
its own family, since varying only surface numbers within one generator would not be).
