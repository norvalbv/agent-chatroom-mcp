---
slug: hands-for-unowned-ideas
created: 2026-10-26
---

# hands-for-unowned-ideas

## Target · 2026-10-26 — An idea nobody is free to take gets one owed ask

**Context:** The old idea_no_free_seat hint fired 9 times in 5 rooms across all logs, and 0 recruits followed. It showed only on idle waits, only to a busy author, and ended "carry on and ignore this". 73 of 81 idea/* entries were never claimed.
**Ruling:** After 10 min, with every worker holding a live claim, the idea's author gets one owed "hands" ask: recruit, claim it after the current claim, or drop it. The active chair is asked if the author has left. Telemetry: hands_asked and hands_resolved {how}, plus a run-metrics line. Off with CHATROOM_HANDS_AFTER_MS=0. Built in 203a9a94..a2339633 (8 commits), plus f26a2ef5, 34d0cb74, d094b19b and 3eb6bc58 (claude-opus-5-5-4; review/203a9a94 and review/a2339633 for the 8-commit range, plus review/f26a2ef5, review/34d0cb74, review/d094b19b and review/3eb6bc58, all by claude-opus-5-5-2).
**Consequences:**
- Positive: Replay (reproduced): 42 would-be asks in 332 logs, 4 resolved within 20 min. probe/hands-3 (n=1, watched): the ask was answered with a claim in 7 s. The live rescue rate is UNMEASURED; the planned main-vs-branch A/B was not run.
- Negative: One chat line and one reply per idea. Claims are expected to outnumber recruits.
**Vision-fit:** n/a — internal tooling: rooms that organise themselves and keep working seats
**Researched:** NEW sources/anthropic-multi-agent-research-system; NEW sources/arXiv:2603.12229; the 332-log replay (scripts/hands-replay.ts).
**Rejected:** a trigger for "pairs talking at length" (60-95% of agent chat is pair exchanges); auto-spawning recruits without asking.
**Revisit-when:** the run-metrics "Ideas nobody was free to take" line shows resolved within 20 min at or below the replay's 10% over 2+ runs, or the ask draws complaints of noise.
**Scope:** scripts/hands-ask-regression.ts,skills/swarm/SKILL.md,src/hub.ts,src/hub/asks/hands.ts,src/hub/internal.ts,src/hub/open-work.ts,src/hub/steer.ts,src/hub/types.ts,src/run-metrics.ts
**Source:** swarm-005940-77tu (RSI-5) prop_49a4a68e v7; promoted 2026-10-26 by the owner's choice (measured items only)
