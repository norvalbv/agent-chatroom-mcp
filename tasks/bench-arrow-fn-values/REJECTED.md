# Rejected: bench-arrow-fn-values

Author and pilot: sonnet-1, room swarm-150725-3vny-room. A stamp-family sibling: an invented language (ARROW) with first-class function values; the spec states only the flat scope rule (a call reads its own locals, else globals) and never mentions capture, so a lexical-closure prior gives a different answer at 12 of 22 printed values (make-adder, counter, compose, curry, loop-local read).

Oracle: `fixtures/reference/arrow.py` and `arrow.mjs` (independent) print the same 22 values, equal to `oracle/oracle.json`; `scripts/arrow-task.test.ts` proves the closure reading changes the answer.
Attack (non-author): sonnet-3 wrote a fresh 110-line interpreter from `public/` only; it matched all 22 values. Defect found and fixed before the pilot: the spec did not define `#` comment and blank lines (sentence added).

Arm A, `bench-rq1.ts tasks/bench-arrow-fn-values A <seed> --model sonnet`, after the fix: seeds 1, 2, 3 all task_pass (4, 4, 5 turns; $0.0376, $0.0402, $0.0461), every answer byte-identical to the oracle. 3 of 3 at the screen: retired (above 0.9). Seeds 4-10 not run.

Reason: the seats read the SCOPE rule as written and applied it to function values. In stamp the same rule fails 5 of 10 only at one nested-DEF site; here every site is a function value, and a program whose whole point is function values makes the scope rule the salient question. The prior fires when the construct is incidental (a nested DEF in a long program), not when it is the subject of the program.
