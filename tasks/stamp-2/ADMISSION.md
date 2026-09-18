# Admission record: stamp-2

Author and pilots: sonnet-5. Attackers: sonnet-3 (hub-assigned) and sonnet-2; sonnet-5 ran the wrong-reading sweep. Room: swarm-150725-3vny-room. Family: the same STAMP family as `stamp-interpreter` (one mechanism, see Independence).

## Task
`public/spec.txt` and `public/brief.txt` are byte-identical to `tasks/stamp-interpreter` (asserted by `scripts/stamp2-task.test.ts`); only `public/program.stamp` is new: 144 lines, 38 printed values, scored exact-answer on the whole line. The program is ordinary routines (gcd by `SETS`, a price table, factorial, digit sum, a prime list, a counter loop) with these incidental scope corners, each decided by SCOPE's "the call's local of that name if it has one, otherwise the global":
- `configure`/`price`: a `DEF` inside a call reads a name that is the definer's parameter; it must read the global (`price 4` is 12, not 40), used again in a loop (`sum` 45) and in a `REPEAT` with `NEXT` (`r` 255).
- `outer`/`mid`/`deep`: three levels of nested `DEF`; `deep` sees only its own `c`, so `a` and `b` are the globals (3007, 3005, 3008).
- `show`/`wrap` and `peek`/`caller`: a callee does not see its caller's locals (41, 104).
- `morph`: a procedure that redefines itself with another arity inside its own call (104, 24, 9).
- `tick`/`lim`: `NEXT` on a name that is only global creates a local (11, 11, cnt still 10); `GLOBAL` then `SET` changes the global (15).

`oracle/reference.mjs` (author sonnet-2's stamp reference, unchanged) and `oracle/independent-check.py` (spec-only Python interpreter, sonnet-5) print the same 38 tokens as `oracle/oracle.json`.

## (a) Attack
- sonnet-3 (assigned attacker): a 130-line Python interpreter written from `spec.txt` alone for the stamp-ledger attack, unmodified, before it saw this program; oracle and reference not opened first. Prints exactly the 38 oracle tokens. Probed every place a reader could deviate (enclosing-local read, dynamic scope, NEXT on a global-only name, sequential SETS): each needs a sentence the spec lacks. No reading found that keeps every stated sentence true and changes a token. No gaming path.
- sonnet-2 (second attacker): a fresh 90-line JavaScript interpreter written from `spec.txt`, run on `public/program.stamp` only, prints exactly the 38 oracle tokens on the first run, oracle opened afterwards. Caveat it recorded itself: it had read stamp-interpreter's `reference.mjs` earlier in the room, so it was not blind to that implementation.
- sonnet-5 (wrong-reading sweep, changed tokens of 38): closure reading 7, dynamic scope 4, NEXT writes the global 6, sequential `SETS` 2, first-`DEF`-wins crashes. All four non-crashing readings are embedded as failing answers in the test. A `REPEAT` count re-evaluated each pass changes nothing (the program has no such loop): that corner is not scored.
- Caveat inherited from stamp-interpreter (sonnet-1's finding): the spec does not say whether a `DEF` executed inside a call stays visible after it returns. The oracle treats procedures as one global table. This program leans on it in `PRINT CALL mid 3` and `PRINT CALL deep 8` (tokens 10 and 11). All ten seeds printed 3008 for `deep 8` and every failing seed printed a value for `mid 3` consistent with a global table, so no seat read the `DEF` as call-local.

## (b) Arm A pilot: one Claude Sonnet seat, `scripts/bench-rq1.ts tasks/stamp-2 A <seed> --root <dir> --model sonnet`, default flags
| seed | outcome | cost USD | turns | wrong tokens (0-based) |
|---|---|---|---|---|
| 1 | task_fail | 0.0496 | 4 | 9, 10 |
| 2 | task_pass | 0.0513 | 4 | - |
| 3 | task_pass | 0.0517 | 4 | - |
| 4 | task_fail | 0.0489 | 4 | 9, 10 |
| 5 | task_fail | 0.0497 | 4 | 9, 10 |
| 6 | task_pass | 0.0526 | 4 | - |
| 7 | task_fail | 0.0499 | 4 | 9, 10 |
| 8 | task_pass | 0.0534 | 4 | - |
| 9 | task_fail | 0.0507 | 4 | 9, 10 |
| 10 | task_pass | 0.0536 | 4 | - |

**Pass rate 5 of 10 = 0.5** (primary band 0.3 to 0.7; exact 95% interval about 0.19 to 0.81). Mean cost 0.0511 USD per run, 4 turns each. No `parse_failure`, no timeout. Every seat, pass or fail, says it traced by hand and did not run the program.

**Single-trap task.** All five failures are the same two tokens: `outer 1` printed 1027 (oracle 3007) and `mid 3` printed 1008 (oracle 3005), everything else right. 1027 is `2 + (1000 + 20 + 5)`: `deep` read the global `a` correctly but took `b` from `mid`'s parameter. That is not the full closure reading (28 and 9 in the sweep) and not dynamic scope (which would also change `show`/`wrap`, all ten got 41): a hand-trace slip in which the enclosing call's parameter leaks into the innermost body. It cannot be defended from the text (`deep`'s call has only `c`). `deep 8` from the top level (3008) was right in every seed, so seats that fail keep the global reading when the definer is not running. The other corners (dynamic scope, `NEXT`, `morph`, `GLOBAL`) were right in all ten seeds: nothing else in the program discriminates.

## Independence
Same spec text, same mechanism as `stamp-interpreter` (nested `DEF` reading an enclosing call's names), different program and different positions of the corner. For the paper it is the same family: a second instance, not a second family. Across same-spec programs the corner landed in band on two of four (stamp-interpreter 5/10, stamp-2 5/10) and went 3/3 on two (stamp-ledger, stamp-helpers), so this is neither a one-program fluke nor a reliable lever.

## (c) Arm C
One run, `scripts/bench-rq1.ts tasks/stamp-2 C 1 --root /tmp/st2-C1 --port 19883 --model sonnet` (3 seats, no lobby): outcome task_pass, room concluded, seats 17, 18 and 20 turns (55 summed), cost 0.6397 USD, 61.0 s wall clock, no seat killed by the deadline, anti-tamper hash unchanged. The room's answer was the oracle line, so it did not fall into the tokens 9,10 slip. One run is proof that the room can conclude on this task inside the 900 s deadline, not evidence about accuracy. Cost ratio against arm A on this task: 0.6397 / 0.0511 = about 12.5. Raw file: `bench/results/suite-3vny/stamp-2/C-seed1/result.json`.
