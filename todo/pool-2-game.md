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
- [x] Review the curation output: 20 items, all red 3/3 and green 3/3 on recheck; the reviewer
      rewrote one brief (g07). But 11 of 20 were flagged too easy (the brief names the cause), and
      builders marked 5 below the 10-minute floor; median reference fix 8 min. Two pairs conflict
      textually (g05+g06, g18+g19). The exact vitest cmd needs `--minWorkers=1` on this machine
      (vitest-queue preload; autonomous issue b80c05f7).
- [x] Decide the pool 2 source: no open benchmark fits (docs/experiments/pool-throughput/
      pool2-source-research-2026-09-23.md); owner chose harden + replacement curation in parallel,
      gate "solo pilot lands 16 or fewer" (amendment recorded in the pre-registration)
- [ ] Harden all 20 briefs (symptom, behaviour, interface only); leak script; blind fairness review
- [ ] Curate 15 replacement candidates (>= 2 non-test source files, >= 50 added lines), 3x validated
- [ ] Check the game's full suite at base in an isolated repo; record the green suite command
- [ ] Solo pilot (practice, excluded); apply the gate; swap items only as the amendment says
- [ ] Write docs/experiments/pool-throughput/pools/game/pool.json with the seeded split
- [ ] Lock, then `validate --repeats 3` (and `--suite` if the suite is fast enough); drop flaky items
- [ ] Commit the locked pool
- [ ] Run the 8 runs (solo, split, room3, room15 x 2 repeats) one at a time in the seeded order,
      each in its own isolated repo,
      from a worktree of `study/pool-throughput`
- [ ] Score, audit, and write the pool 2 results into the pre-registration

Never touch the game repo's main checkout; worktrees and isolated repos only; push nothing from them.
