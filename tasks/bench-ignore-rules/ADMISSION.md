# Admission record: bench-ignore-rules

Author: sonnet-6. Attacker: sonnet-3 (assigned by the hub). Room: swarm-140131-j6yf-room.

## Task
Implement `isIgnored(rules, path)` in `ignore.ts` from `public/README.md`, a complete specification of gitignore-style matching (anchoring, directory-only rules, negation, `**` forms, and the rule that a file cannot be re-included once a parent directory is ignored). The stub throws. Scored by `oracle/score.ts` (kind `ignore-rules`, generic private-test scorer): 39 named cases, all must pass.

## Why the oracle is right by construction
`oracle/verify-against-git.ts` runs every case through real `git check-ignore --no-index` in a temporary repository and compares with the reference implementation (`fixtures/correct/ignore.ts`): 39 of 39 agree. `oracle/expected.json` holds the git-verified values (25 ignored, 14 not). `scripts/oracle-tasks-spec-audit.test.ts` re-runs the git cross-check (skipped when git is absent) and asserts constant answers and a substring shortcut fail.

## (a) Adversarial read
See "Attack" below.

## (b) Arm A pilot: one Claude Sonnet seat, `scripts/bench-rq1.ts tasks/bench-ignore-rules A <seed> --root <dir>`, default flags
| seed | outcome | cost USD | turns |
|---|---|---|---|
| 1 | task_pass | 0.0428 | 4 |
| 2 | task_pass | 0.0447 | 4 |
| 3 | task_pass | 0.0427 | 4 |
| 4 | task_fail | 0.0556 | 5 |
| 5 | task_pass | 0.0446 | 4 |

Pass rate 4 of 5 (in the 1 to 4 band). Mean cost 0.0461 USD per run.

Failure, seed 4: oracle cases `anchored-leading-slash-hit` and `anchored-dir-only` failed. The seat's own regex escaping turned `/` into `\/` and it then removed the first character of the escaped source to drop the leading slash, which removed the backslash instead. The code loaded and returned booleans, so this is a reasoning slip, not a format failure. Its final text: "I implemented `isIgnored` in `ignore.ts` following the README rules. I haven't run it or any tests." It also noted that the README does not cover `a/**/**/b`, a form no oracle case uses.

## (c) Arm C: `scripts/bench-rq1.ts tasks/bench-ignore-rules C 1 --root <dir> --port 19876`
outcome task_pass, room concluded, 51 turns summed (seat-1 18, seat-2 19, seat-3 14), cost 0.5717 USD, 64 s wall clock, no seat killed by the deadline.

## Attack
