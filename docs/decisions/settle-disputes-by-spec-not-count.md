---
slug: settle-disputes-by-spec-not-count
created: 2026-09-23
---

# settle-disputes-by-spec-not-count

## Target · 2026-09-23 — Disputes are settled against the specification, not by counting agreement; first attempts stay independent

**Context:** On printf both team arms lost to one agent (14/40). The vote arm picked a correct answer in 7/40 although a correct attempt existed in 37/40 of its pools, because counting agreement selects the larger wrong cluster. The chatroom arm got 6/40 and never had a rival draft to dispute, because its seats edit one shared workspace. Seats could also clear a correctness objection by rewording the proposal.
**Ruling:** (1) Blind drafts: draft/* board entries are readable only by their author until every remaining non-verifier seat has drafted or CHATROOM_DRAFT_REVEAL_MS (default 10 min) passes; the reveal is latched and persisted, and a draft written or edited after it is flagged post_reveal. (2) A challenge that carries a command is answered only by a verify/* entry that reruns it with exit 0, or by a verifier or chair ruling with a reason of 20+ characters; rewording does not clear it. (3) Bench arm D scores the draft chosen by adjudicating the disputed inputs against the specification, never by count.
**Consequences:**
- Positive: First attempts stay independent, so a room has rival drafts to dispute; a correctness objection cannot be reworded away. In an offline replay of the retained vote-arm pools, spec adjudication reached the oracle ceiling: printf 7/40 to 37/40 on one disputed fact, stamp-interpreter 36 to 40 and stamp-2 39 to 40 on six facts.
- Negative: Arm D cost about 65x arm A per completed run and its 4-run live pilot timed out twice. Blindness is enforced only by the prompt and its audit is heuristic. The 10-minute reveal can expose rivals before a slow drafter finishes (unmeasured). An executable challenge can hold a room until someone reruns its command. The replays used a Sonnet judge on Sonnet attempts with the disputed tokens pre-marked.
**Vision-fit:** n/a - internal tooling; the hub's purpose is conclusions a human can trust at a context cost agents can afford
**Researched:** arXiv:2407.21787 (coverage is not selection), 2203.07814 AlphaCode, 2204.11454 MBR-exec, 2207.10397 CodeT (execution agreement picks the largest cluster), 2302.08468 LEVER and 2509.06870 AggLM (spec-grounded or learned judging recovers minority-correct answers), 2605.29800 (correlated same-model judges add about 2 effective votes of 9), 2506.18203 Weaver; replay scripts adjudication-replay.ts and stamp-adjudication-replay.ts
**Rejected:** Execution-agreement or cluster-size selection: picks the larger wrong cluster on printf (7/40 against 37/40 available). More same-model judges: about 2 effective votes of 9. Reveal only when every drafter has drafted: one silent seat seals the drafts forever. Letting only the proposer clear an executable challenge: a one-seat veto via a command that always fails.
**Anchored-bet:** [BET]
**Revisit-when:** Arm D runs against arms A and C at equal wall-clock with a reveal deadline under 900 s and n>=20 per arm: revisit if D does not beat A on the oracle, or if drafters adjudicating their own dispute pick worse than the neutral replay judge.
**Scope:** src/hub.ts,src/server.ts,scripts/bench-rq1.ts,scripts/adjudication-replay.ts,scripts/stamp-adjudication-replay.ts
**Source:** arxiv · swarm-083203-kooz, main 858dbfa
