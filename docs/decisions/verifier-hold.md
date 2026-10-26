---
slug: verifier-hold
created: 2026-10-26
---

# verifier-hold

## Target · 2026-10-26 — A quoted disagree stands across amends that keep its clause

**Context:** On 319 logs, 1,416 amends dropped 267 disagrees and carried 0; the same seat re-cast 106 of them. The vote tool already promised a disagree "stands until ... that text is amended". The 9f66 verifier re-cast its hold 4 times. While its disagree stood, its waits returned after a median 9.1 s (n=26), against 55 s for the other seats (n=81).
**Ruling:** vote(disagree) takes an optional quote. An amend keeps that disagree while the quote survives, and it still counts as standing. A carried disagree stands only while its author is present. Telemetry: the amend event carries carried_disagrees; scripts/vote-recast.ts replays any log. Built in dd4195b8, dea5937a, 4177dd94 and 37cfc35c (claude-opus-5-5-2; review/dd4195b8, review/dea5937a, review/4177dd94 and review/37cfc35c, all by claude-opus-5-5-3).
**Consequences:**
- Positive: Driven by the verifier on private hubs (evidence/verifier-drive): at base the disagree was dropped by an "pears"→"plums" amend; at 0f13d23b it carried ("cast at v1; its quoted clause is unchanged in v2") and blocked_by named it. A disagree that quotes only inside its reason, without the quote field, still resets. With agents (probe/verifier-hold-1; author-read, 3 rooms on 0f13d23b): 2 of 2 disagrees set quote; the amend replaced the clause, the disagree dropped, and each seat agreed with 0 re-casts. A carry with agents, and a verifier holding on a pending input, are NOT SHOWN.
- Negative: A carried disagree whose point was answered elsewhere in the text stands until its author re-votes. For seats still in the room, what blocks does not widen; only the label changes.
**Vision-fit:** n/a — internal tooling: rooms that organise themselves and keep working seats
**Researched:** NEW sources/gerrit-config-labels; NEW sources/github-protected-branches; NEW sources/arXiv:2609.14767.
**Rejected:** a new "hold" vote kind; carrying the verifier's agree across amends.
**Revisit-when:** vote-recast.ts on new rooms still shows the same seat re-casting disagrees whose quote survived, or a carried disagree blocks a room after its author's point was met.
**Scope:** prompts/verifier.md,scripts/breakout-carry.ts,scripts/breakout-verified-carry-regression.ts,scripts/disagree-carry-regression.ts,scripts/offline-runner.mjs,scripts/vote-recast.ts,skills/swarm/SKILL.md,src/hub.ts,src/hub/consensus/votes.ts,src/server.ts
**Source:** swarm-005940-77tu (RSI-5) prop_49a4a68e v7; promoted 2026-10-26 by the owner's choice (measured items only)
