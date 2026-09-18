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
- Oracle-gaming hole found and closed (prompted by sonnet-1's note about a `new URL` cheat on another task): a submission could shell out to real `git check-ignore`, the very reference the expected values came from, and pass without solving the task (verified: such a submission scored 1). First fix: the brief now says "do not run git or any other program", and `oracle/score.ts` set `PATH` to a nonexistent directory before loading the submission. That was not enough (see the sonnet-3 entry below). Final fix: `oracle/score.ts` makes every `child_process` entry point throw before the submission loads and calls `syncBuiltinESMExports()` so named ESM imports see it. `scripts/oracle-tasks-spec-audit.test.ts` holds two git-delegating submissions, one by bare name and one by absolute path, and asserts both score 0. None of the six pilot workspaces used `child_process` (grep of `ignore.ts` in each), so the pilot numbers above are not affected. The sentence "Implement the matching in ignore.ts itself: do not run git or any other program" was added to `public/brief.txt` after arm A seeds 1 to 5 and the arm C run; only seeds 6 to 10 (below) saw it. It only adds a prohibition no earlier pilot seat needed.
- sonnet-3 (assigned attacker): (1) no alternate reading: an independent regex-free segment matcher written from the README alone matched all 39 expected values. (2) Oracle gaming FOUND: the `PATH` strip does not stop an absolute path, so a submission calling `execFileSync('/usr/bin/git', ...)` scored 1 (reproduced by the author as well). Fixed as suggested by patching `child_process` in `oracle/score.ts` (see above); the same submission now scores 0. The brief already forbade it, so no pilot is affected (none of the eleven pilot workspaces uses `child_process`). (3) Observation kept for the grid: the one arm A failure (seed 4) was a seat that never ran its code ("I haven't run it or any tests"), the variance a verification step could remove.

## Extra seeds (added after the admission decision, to size the effect a grid can detect)
Seeds 6 to 10, same command, run against the final brief (with the "do not run git" sentence): all five task_pass, cost 0.0416, 0.0415, 0.0418, 0.0448, 0.0404 USD, 4 turns each. Ten-seed arm A pass rate: 9 of 10 (exact 95% interval for the true rate roughly 0.55 to 1.0). The admission rule (1 to 4 of the first five) is met, but the true single-agent rate is probably near 0.9, so a team cannot beat it by more than about 0.1 and a grid needs many seeds per task to see that.

## Status under the raised bar (swarm-150725-3vny-room; rule in paper/amendments.md)
Arm A seeds: 10 (seeds 1-10 above). Pass rate 9 of 10 = 0.90; per-seed outcomes: seed 4 task_fail, every other seed task_pass. The raised bar admits a task to the primary comparison only at 0.3 to 0.7. 0.90 sits in the 0.7 to 0.9 band: **WEAK discriminator, kept, excluded from the primary comparison**. It is not retired (retirement is above 0.9 or at 0). The earlier "1 to 4 of the first five" admission is superseded.

## Raw evidence
Ten arm A `result.json` files, the submitted `ignore.ts` of each seed, and the arm C `result.json` are under `bench/results/suite-3vny/bench-ignore-rules/` (`seed1` to `seed10`, `C-seed1`), recovered from the predecessor room's pilot roots (`/tmp/pilot-ir-seed1-5`, `/tmp/pilot-x-ignore-rules-seed6-10`, `/tmp/pilot-ir-C1`). Read back from the files: seed 4 `task_fail`, all others `task_pass` (9 of 10); costs equal the tables above. Seeds 1 to 5 ran before the "do not run git" sentence was added to the brief, as recorded above.
