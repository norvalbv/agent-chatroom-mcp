---
slug: breakout-verification
created: 2026-10-26
---

# breakout-verification

## Target · 2026-10-26 — A break-out's verification reaches its parent

**Context:** 6 of 6 verified break-outs lost their verification on the way to the parent's inbox (9f66 5/5, kcj5 1/1). The parent verifier reran everything.
**Ruling:** The inbox/<breakout>/conclusion head carries the verification line, or "Not verified by the hub: ...". verifier.md (6e6c5e67) tells the parent verifier to check that the numbers and caveats were carried and to rerun only what the note left unverified. Telemetry: scripts/breakout-carry.ts. Built in c2933768 and 4177dd94 (claude-opus-5-5-2; review/c2933768 and review/4177dd94, by claude-opus-5-5-3), plus SKILL.md 5c8a0bf0 (claude-opus-5-5-4; in review/203a9a94's range).
**Consequences:**
- Positive: The regression shows 0 lost. With agents, probe/breakout-verified-1: 2 unverified break-outs (item 8 and reap-ceiling-1) carried the "Not verified" head, and the seats read it. A parent verifier's rerun cost with the line present is UNMEASURED.
- Negative: The head grows by one line.
**Vision-fit:** n/a — internal tooling: rooms that organise themselves and keep working seats
**Researched:** the 9f66 bk2/bk4/bk5 reruns; scripts/breakout-carry.ts over all parents (20 notes).
**Rejected:** a verifier seat per break-out (it would have caught nothing in n=5, and adds a seat and machine load per break-out).
**Revisit-when:** a parent verifier reruns a break-out whose note says it was verified, or a carried caveat is dropped from the parent's text.
**Scope:** prompts/recruit.md,prompts/verifier.md,scripts/breakout-carry.ts,scripts/breakout-verified-carry-regression.ts,scripts/claude-lean-flags-regression.ts,scripts/conduct-guidance-regression.ts,scripts/disagree-carry-regression.ts,scripts/hands-ask-regression.ts,scripts/offline-runner.mjs,scripts/seat-env-regression.ts,skills/swarm/SKILL.md,src/hub.ts,src/hub/asks/hands.ts,src/hub/consensus/votes.ts,src/hub/internal.ts,src/hub/open-work.ts,src/hub/steer.ts,src/hub/types.ts,src/result.ts,src/run-metrics.ts,src/swarm.ts
**Source:** swarm-005940-77tu (RSI-5) prop_49a4a68e v7; promoted 2026-10-26 by the owner's choice (measured items only)
