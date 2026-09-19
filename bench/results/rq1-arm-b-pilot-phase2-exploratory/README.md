# Arm-B pilot, phase 2 — EXPLORATORY, outcome-adaptive, do not pool

Run by sonnet-7 in room swarm-174126-0s5m, harness commit 31824de (the same per-stage-deadline
build as phase 1, not the shared-deadline build that was later integrated). Copied here from that
seat's worktree by the verifier after the runner exited, because the seat left the cells
uncommitted; the bytes are unmodified.

**Why this is not evidence on its own.** Phase 2 (seeds 406-415) was launched *after* phase 1's
outcome was known, specifically because phase 1's arm A passed only 1 of 5. It is therefore
outcome-adaptive: the decision to extend, and the arm it was aimed at, depend on the result being
extended. It must not be pooled with the pre-declared phase 1 cells in
`bench/results/rq1-arm-b-pilot`, and any use of it needs its own pre-registration.

**Counts, for the record only** (verifier, from the committed result.json files):

| arm | n | pass | cost USD |
|---|---|---|---|
| A | 11 | 5 | 0.6861 |
| B | 11 | 9 | 1.3001 |
| C | 10 | 10 | 5.4475 |

Total 7.4337 USD, inside the 16 USD cap this phase declared on the room's ledger. Seeds 406-416.
Arm C has ten cells, not eleven: seed 416's arm-C run was still in flight when the runner's range
ended, and its directory in the seat's worktree has no `result.json`, so it is excluded rather than
counted as a failure. The arms are therefore not seed-balanced at 416; that is a further reason not
to read anything into these counts.

The verifier first copied these cells while the runner was still going, mistaking a gap between
seeds for the end, and said so in the room; this directory is the corrected copy, taken after
`pgrep` showed no `run-arm-b-pilot` or `bench-rq1.ts` process left.

All of these runs are in the short-thinking regime (see `paper/amendments.md` and the maintainer's
same-window control at main c82124d), so they cannot be pooled across the regime boundary either.

## INTERRUPTED-C-seed416

The arm-C run for seed 416 was killed when 6-astra-11 stopped the phase-2 process group
(wrapper, launcher, bench child, hub and three Claude seats; no SIGKILL needed). Its directory is
preserved here as `INTERRUPTED-C-seed416` exactly as the kill left it, minus the `spawned/` seat
logs, and it has no `result.json`: it is neither a pass nor a fail and is excluded from the counts
above. It is kept so that the truncation is visible in the artifact rather than only in prose.
