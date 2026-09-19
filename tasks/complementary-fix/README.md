# Two independent boundary-inclusivity bugs (RETIRED at the 3-seed screen: 3 of 3 arm-A passes, see ADMISSION.md)

Only `public/` is copied into a seat's workspace. `public/scheduling.ts` and
`fixtures/broken/scheduling.ts` are identical: two independent planted defects,
`cur.start < last.end` (should be `<=`, in `mergeIntervals`) and
`quantity > t.min` (should be `>=`, in `tierRate`). `fixtures/correct/scheduling.ts`
fixes both. `fixtures/only-merge-fixed` and `fixtures/only-tier-fixed` each fix
exactly one bug, leaving the other broken -- they exist to prove the two
invariant groups are independent (fixing one changes only its own group's
result) and are used only by tests, never by any arm.

The private `oracle/score.ts` imports the workspace's `scheduling.ts` and
checks ten frozen cases split into two named, independently-scored groups
(`merge`, `tier`; five cases each). It emits deterministic JSON
`{score, group_results, oracle_results}`; `score` is 1 only if every case in
both groups passes. Group results are never surfaced to any seat or agent --
only to the harness's own result.json, for post-hoc design analysis.

Independent fixture commands (from repository root, no hub or ports needed):

```sh
node --import tsx tasks/complementary-fix/oracle/score.ts tasks/complementary-fix/fixtures/broken
# exit 1; group_results {merge:false, tier:false}
node --import tsx tasks/complementary-fix/oracle/score.ts tasks/complementary-fix/fixtures/only-merge-fixed
# exit 1; group_results {merge:true, tier:false}
node --import tsx tasks/complementary-fix/oracle/score.ts tasks/complementary-fix/fixtures/only-tier-fixed
# exit 1; group_results {merge:false, tier:true}
node --import tsx tasks/complementary-fix/oracle/score.ts tasks/complementary-fix/fixtures/correct
# exit 0; group_results {merge:true, tier:true}
node --import tsx --test scripts/complementary-fix-task.test.ts
```

## Why this task family exists

RQ1's admitted suite (`stamp-interpreter`, `stamp-2`, `bench-printf-format`) is
two families, both "single shared trap": every failure on an admitted task is
the *same* wrong answer, so a k-independent-vote arm (arm K) does about as
well as the chatroom (arm C) when the shared-trap answer is a minority, and
both do worse than a single agent when it's a majority (`paper/amendments.md`,
`docs/decisions/proposed/arm-k-*.md`). Neither family can show a case where
coordination *specifically* (not sampling-and-selecting) helps, because there
is only one thing to get right or wrong per program.

This task instead has two independently-discoverable, non-nested defects.
Arm K picks one whole attempt's patch; if no single seed happens to find and
fix both, K fails even when, across the k attempts, "merge fixed" and "tier
fixed" were each found by *someone*. Arm C's three seats already run in one
*shared, live workspace* directory (`scripts/bench-rq1.ts`: `cwd: workspace`
identical across seats) -- if seat 1 fixes the merge bug and seat 2 fixes the
tier bug, both edits land in the same file with no explicit merge script
needed, simply because they are editing the same file on disk. That makes
this task a test of whether a shared workspace (not necessarily the full
challenge/verification gate) recovers complementary partial fixes that
independent, non-communicating sampling structurally cannot.

## Status: retired

The 3-seed arm-A screen passed 3 of 3 (ceiling); `screen/seed{1,2,3}-result.json` are the raw results and ADMISSION.md is the record.
The text above is the design as written before the screen, kept so the rejection is reproducible.
