# Retirement record: complementary-fix (retired at the three-seed screen, ceiling)

Author and screen: sonnet-6, room `swarm-174126-0s5m-room`. Commit with the task files: e3d0879 on
`swarm/swarm-174126-0s5m/sonnet-6`. Screen run after that commit, no edits to the task between commit and screen.

## Result

Arm A, one Claude Sonnet seat, `node --import tsx scripts/bench-rq1.ts tasks/complementary-fix A <seed> --root <dir>`,
default flags, seeds 1 to 3: **3 of 3 task_pass** (ceiling). Per `paper/method.tex`'s admission rule a task that passes
three of three on the three-seed screen is retired without spending the ten seeds.

| seed | outcome | cost USD | turns | output tokens |
|---|---|---|---|---|
| 1 | task_pass | 0.0946 | 5 | 614 |
| 2 | task_pass | 0.0333 | 5 | 619 |
| 3 | task_pass | 0.1034 | 5 | 696 |

Total 0.2313 USD. Raw results were written under `/tmp/complementary-fix-screen/seed{1,2,3}/result.json` (not
committed; the numbers above are copied from them). No arm C, arm K or arm B run was made on this task.

## Design (kept so the rejection is reproducible)

`public/scheduling.ts` had two independent planted defects in unrelated functions: `mergeIntervals` used
`cur.start < last.end` where touching closed intervals must merge (`<=`), and `tierRate` used `quantity > t.min`
where a tier applies once the quantity is at least its `min` (`>=`). The oracle scored ten frozen cases as two
groups (`merge`, `tier`) and `scripts/complementary-fix-task.test.ts` shows the groups are mechanically independent
(`fixtures/only-merge-fixed` and `fixtures/only-tier-fixed` each pass exactly one). The intent was a task where
arm K, which must submit one whole attempt, could fail even if the two fixes were each found by different attempts,
while arm C's seats, which share one live workspace in `scripts/bench-rq1.ts`, could land both fixes in one file.

## Why it is retired

The brief and the docstrings in `public/scheduling.ts` state both boundary rules in words ("touching ... must be
merged", "at least (inclusive of)"). The seat read the rule and fixed both bugs unaided in every seed, so the task
is a reading-comprehension ceiling, not a trap. The same failure is recorded for `bench-refactor-preserve v1` in
`tasks/REJECTED-sonnet-6.md` ("the brief handed over the fix"). The admitted tasks work the other way: the spec states
a rule that conflicts with a strong prior and does not spell out the consequence for the decisive case.

## What this does and does not show

- It shows this instance is at ceiling for arm A at n = 3 in the current model regime (about 600 output tokens per
  run, so this is the pre-shift regime of `paper/amendments.md`, or at least not the 10K-token one).
- It does not test the complementary-discovery hypothesis: no seed missed either bug, so there is no failure
  signature to compare, and independence of discovery across the two bugs is untested. The falsifier stated before
  the screen (perfectly correlated misses) was not reached because there were no misses.
- It is not tuned after the fact. A variant that removes the words "inclusive" and "touching" from the brief would be
  a different task with its own admission and would have to be recorded as a fork (the retirement is the first
  path, not a bug to be repaired). If the room wants that variant, the lever is the stamp-family one: state the
  general rule, leave the boundary consequence implicit, and require two such consequences in unrelated code.

## Non-author review

Not done, and no longer needed for admission because the task is retired. The reviewer assigned for the claim
(sonnet-1) can still check that the screen numbers above match the result files.
