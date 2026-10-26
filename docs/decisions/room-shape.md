---
slug: room-shape
created: 2026-10-26
---

# room-shape

## Target · 2026-10-26 — Start flat and break out by item; no automatic grouping at init

**Context:** Shape changed the headline answer in 0 of 4 families that asked one question both ways (confounded). Grouped cost 1.1-6x per useful result. Grouped did conclude long open research 4 of 4 times.
**Ruling:** runs-table --by-run gives each run's launch shape and its break-outs with opener roles. SKILL.md: choose flat or groups from the records, with planned stated as the no-flag default. Built in 8b73d0ed, 7bd31ac9, ce6347a9, ad996e23 and 548aaa17 (room-shape; reviews by room-size and recruit-timing).
**Consequences:**
- Positive: Operator check, 24 calls: a 6 h research brief moved from --groups 2/2 to flat 2/2, and "when to propose" went from 0/2 to 2/2. Room outcomes are NOT SHOWN.
- Negative: No same-brief flat vs grouped run over hours.
**Vision-fit:** n/a — internal tooling: rooms that organise themselves and keep working seats
**Researched:** NEW sources/arXiv:2512.08296; NEW sources/arXiv:2502.02533.
**Rejected:** automatic grouping at init by launcher, planner or chair.
**Revisit-when:** a same-brief flat vs grouped run over hours shows grouped landing a better scored answer, or the owner changes the CLI default from planned.
**Scope:** scripts/offline-runner.mjs,scripts/run-shape-regression.ts,scripts/runs-table.ts,skills/swarm/SKILL.md,src/metrics/run-shape.ts
**Source:** swarm-005940-77tu (RSI-5) prop_49a4a68e v7; promoted 2026-10-26 by the owner's choice (measured items only)
