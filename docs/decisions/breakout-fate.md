---
slug: breakout-fate
created: 2026-10-26
---

# breakout-fate

## Target · 2026-10-26 — A break-out's fate is stated, logged and tied to its parent

**Context:** Over 36 break-outs in 332 logs: 20 concluded before their parent; 15 were closed by hand within about a second when the owner stopped 3 runs; 1 never concluded. A conclusion the parent could no longer take vanished silently. kcj5's unprefixed break-out was missing from result.json.
**Ruling:** Every carry attempt logs breakout_carry {delivered|late|dropped}, and a dropped one is said in the break-out. A parent's close closes its open break-outs and logs parent_closed. The launcher finds break-outs by parent link. room_status and GET /rooms carry breakout_fate.line. Built in 09371908, c01ae412, fb9db2b6, 362f9147, 3097a86a and 7a937e7f (breakout-fate; reviews by claude-opus-5-5-3, and review/7a937e7f by claude-opus-5-5-4).
**Consequences:**
- Positive: probe/breakout-fate-1 read the fate line and the carry in item 8 and reap-ceiling-1. The launcher logged "breakouts found by parent link, not by name: probe-findings", and result.json lists probe-findings. 2 of 2 dev rooms passed 9/9 checks, with each conclusion carried within 1 ms. The late carry, the dropped carry and the close cascade are regression-only, NOT SHOWN with agents. A conclusion still does not cascade.
- Negative: archive-dead now spares a parent whose break-out still has seats.
**Vision-fit:** n/a — internal tooling: rooms that organise themselves and keep working seats
**Researched:** NEW sources/arXiv:2609.01870; NEW sources/arXiv:2607.28802; NEW sources/vorpus-structured-concurrency; NEW sources/erlang-otp-supervisor.
**Rejected:** auto-archiving concluded break-outs (lingering cost $3.29 over n=15); forwarding post-conclusion board writes; auto-prefixing names.
**Revisit-when:** breakout_carry logs a dropped outcome in a live run, or a stopped run leaves break-outs open.
**Scope:** scripts/breakout-fate-regression.ts,scripts/claude-lean-flags-regression.ts,scripts/offline-runner.mjs,scripts/seat-env-regression.ts,skills/swarm/SKILL.md,src/hub.ts,src/hub/breakouts/lifecycle.ts,src/hub/internal.ts,src/launch/run-rooms.ts,src/swarm.ts,src/ui.ts,src/ui/rooms.ts
**Source:** swarm-005940-77tu (RSI-5) prop_49a4a68e v7; promoted 2026-10-26 by the owner's choice (measured items only)
