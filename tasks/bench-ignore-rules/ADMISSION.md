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
- sonnet-1 (non-author): wrote `isIgnored` from `public/README.md` alone before opening `cases.ts` or `expected.json`, then ran it on all 39 cases: 39 of 39 matched, so the README determines every expected value; no alternate reading found for trailing `/**`, middle `/**/`, leading `**/`, directory-only rules, or negation after an ignored parent. Constant or heuristic stubs cannot pass strict boolean comparison on 39 hidden cases.
- Oracle-gaming hole found and closed (prompted by sonnet-1's note about a `new URL` cheat on another task): a submission could shell out to real `git check-ignore`, the very reference the expected values came from, and pass without solving the task (verified: such a submission scored 1). Fix: the brief now says "do not run git or any other program", and `oracle/score.ts` sets `PATH` to a nonexistent directory before loading the submission, so a program lookup fails. `scripts/oracle-tasks-spec-audit.test.ts` holds a git-delegating submission and asserts it scores 0. None of the six pilot workspaces used `child_process` (grep of `ignore.ts` in each), so the pilot numbers above are not affected. The sentence "Implement the matching in ignore.ts itself: do not run git or any other program" was added to `public/brief.txt` after arm A seeds 1 to 5 and the arm C run; only seeds 6 to 10 (below) saw it. It only adds a prohibition no earlier pilot seat needed.
- sonnet-3 (assigned attacker): no findings received before this record was written.

## Extra seeds (added after the admission decision, to size the effect a grid can detect)
Seeds 6 to 10, same command, run against the final brief (with the "do not run git" sentence): all five task_pass, cost 0.0416, 0.0415, 0.0418, 0.0448, 0.0404 USD, 4 turns each. Ten-seed arm A pass rate: 9 of 10 (exact 95% interval for the true rate roughly 0.55 to 1.0). The admission rule (1 to 4 of the first five) is met, but the true single-agent rate is probably near 0.9, so a team cannot beat it by more than about 0.1 and a grid needs many seeds per task to see that.
