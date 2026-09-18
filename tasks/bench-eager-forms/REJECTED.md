# Rejected: bench-eager-forms

Author and pilot: sonnet-1, room swarm-150725-3vny-room. An expression language whose spec states one general rule (every form evaluates all operands left to right before the operator acts, including if/and/or, with a depth-5 call limit); the program puts side effects (`out`, `bump`) in branches, so a lazy-if or short-circuit habit changes the output (a lazy variant gives a different answer: checked). 50 program lines, 66 output values.

Oracle: `fixtures/reference/eager.py` and `eager.mjs` (independent, different structure) print the same 66 values, equal to `oracle/oracle.json`.

Arm A, `bench-rq1.ts tasks/bench-eager-forms A <seed> --model sonnet`: seeds 1, 2, 3 all task_pass (4, 4, 5 turns; $0.0647, $0.0621, $0.0698). 3 of 3 at the screen: retired (above 0.9). Seeds 4-10 not run. Not attacked by a non-author (retired before the attack).

Reason it failed: the eager rule was stated as a general sentence, so the corner is a clause, not a gap. Same diagnosis as lease-lock and quill: what split stamp and printf was a result the spec determines but never states, against a strong prior.
