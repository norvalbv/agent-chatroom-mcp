---
status: blocked
added: 2026-09-23
from: owner approval 2026-09-23 (third pool is frink, harder items)
after: pool-2-game
---
# Pool 3 (frink): curate, lock, validate, run, score

Same steps as pool-2-game, with harder items curated from frink's unbuilt backlog.

Frink's main checkout has a large dirty working tree: never touch it. Curate and run from
worktrees and isolated repos only, and push nothing from them.

Done when pool 3's results are in the pre-registration, scored the same way as pools 1 and 2.

Progress (2026-09-24):
- Source frozen outside Frink (commit f4f7eacdb plus its node_modules; see the pre-registration, "Pool 3 source frozen"). pool.json's repo must be the snapshot.
- 21 items selected (f01-f21) and being built; a top-up round adds f22 onward.
- Hold request sent at about 11:50 BST to the Frink sessions (frink-d3, frink-e4, frink-63, frink-d4, frink-d7, frink-c9, frink-fc, fix-plan-usage-gate, remove-frink-auth-system), listing f01-f21 by title. Still to do: send them the top-up items, and an ALL-CLEAR once pool 3's runs are scored.
- 2026-09-24 18:00: STOPPED after 2 of 8 counted runs (split:2 20/20 $8.71; room15:2 20/20 $68.14). Near-ceiling; recorded in the pre-registration. Owner rule: no rooms or pool runs without an explicit go-ahead. Open question for the owner: send the Frink sessions the all-clear (releases the 24 held items), or keep the hold if pool 3 might resume. Proposed replacement: an off-the-shelf benchmark (SWE-bench Verified/Pro public subset via Harbor, web tools off, solo/split/room3 only, cheap solo difficulty probe first).
