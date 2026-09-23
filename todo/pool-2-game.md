---
status: doing
added: 2026-09-23
from: owner approval 2026-09-23 ("do three pool ... one pool at a time"); docs/experiments/2026-09-23-pool-throughput.md
after: opus-price-row-before-pool-2
---
# Pool 2 (game): lock, validate, run, score

Curation workflow finished 2026-09-23: 20 harder items with hidden acceptance tests and reference
fixes, base 4193133.

- [x] Curate 20 harder items (workflow pool-game-curation)
- [ ] Review the curation output
- [ ] Write docs/experiments/pool-throughput/pools/game/pool.json with the seeded split
- [ ] Lock, then `validate --repeats 3` (and `--suite` if the suite is fast enough); drop flaky items
- [ ] Commit the locked pool
- [ ] Run the 8 runs (solo, split, room3, room15 x 2 repeats) one at a time in the seeded order,
      each in its own isolated repo
- [ ] Score, audit, and write the pool 2 results into the pre-registration

Never touch the game repo's main checkout; worktrees and isolated repos only; push nothing from them.
