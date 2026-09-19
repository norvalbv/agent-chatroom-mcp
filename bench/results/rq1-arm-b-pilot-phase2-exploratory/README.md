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
| A | 10 | 4 | 0.621 |
| B | 10 | 8 | 1.137 |
| C | 9 | 9 | 4.873 |

Total 6.63 USD, inside the 16 USD cap this phase declared on the room's ledger. Arm C has 9 seeds,
not 10, because the runner was stopped mid-seed; no partial cell is included here.

All of these runs are in the short-thinking regime (see `paper/amendments.md` and the maintainer's
same-window control at main c82124d), so they cannot be pooled across the regime boundary either.
