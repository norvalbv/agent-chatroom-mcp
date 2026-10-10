# Proposed decision: settle-disputes-by-spec-not-count

From swarm-083203-kooz (concluded); report: swarms/swarm-083203-kooz/report.md. A human promotes this into docs/decisions/ with `guard-decisions add`; nothing is adopted automatically.

DECISION RECORD**

- **slug:** settle-disputes-by-spec-not-count
- **context:** On printf, both team arms lost to one agent (14/40). Arm K (independent attempts, voting) picked right in 7/40, although a correct attempt existed in 37/40 of its pools: counting agreement picked the larger wrong group. Arm C (live room) got 6/40 and never had a rival draft, because its seats edit one shared workspace (bench-rq1.ts:340). Three earlier rooms on this framing shipped nothing. In this room, inbox starvation behind notices and peer @-asks caused at least three duplicate builds and one reverted integration.
- **ruling:** Blind `draft/*` entries, readable only by their author until every remaining seat has drafted or `CHATROOM_DRAFT_REVEAL_MS` passes; the reveal is latched and persisted, and later edits are flagged `post_reveal`. A challenge that carries a command is answered only by a rerun with exit 0, or by a verifier/chair ruling with a reason. An advisory claim-overlap notice that never refuses. Hub-authored @-notices retire once delivered. A peer's @-ask is delivered first with the queue behind it, while a human's message stays exclusive. Bench arm D selects the scored draft by spec adjudication, never by count.
- **consequences:** First attempts stay independent. A correctness objection cannot be reworded away. No seat's inbox is hidden behind a notice or a peer's ask. In replay, spec adjudication reaches the oracle ceiling: printf 7→37/40 (one fact) and stamp 36→40 and 39→40 (six facts).
- **tradeoff:** Arm D costs about 65× arm A per completed run, and the pilot timed out 2 of 4 times. Blindness is enforced only by the prompt, and the audit of it is heuristic. The claim-overlap notice's precision is unmeasured. Tests that pinned ask-only delivery were rewritten. Unanswered peer asks are re-sent at the head of every wait.
- **researched:** Sources checked this run and not on the SETTLED AXES list:
  - Checked by me: arXiv:2605.29800 (Nine Judges), arXiv:2509.06870 (AggLM), arXiv:2606.15376 (CoAgent), arXiv:2606.00953 (Co-Coder).
  - Checked by seat 11: arXiv:2506.18203 (Weaver). Seat 11 also confirmed the ids for the rest.
  - Cited by seats, not fetched by me: arXiv:2407.21787, 2203.07814, 2204.11454, 2207.10397, 2302.08468.
- **rejected:**
  - Execution-agreement or cluster-size selection (AlphaCode, MBR-exec, CodeT): it picks the larger wrong cluster on printf.
  - More same-model judges: about 2 effective votes out of 9 (2605.29800).
  - A hard lock on overlapping claims: some overlaps are deliberate splits, and CoAgent argues for notify-and-repair instead.
  - Reveal only when every drafter has drafted, with no deadline: one silent seat seals the drafts forever.
  - Letting only the proposer clear an executable challenge: a one-seat veto via `command:"false"`.
- **revisit-when:** Arm D is run against arms A and C at equal wall-clock with a reveal deadline under 900 s and n≥20 per arm. Revisit if D does not beat A on the oracle, or if the drafters, acting as their own adjudicators, pick worse than the neutral replay judge.
- **RE-TARGET self-organising-teams-by-claims-and-recruitment:** replaying the persisted room logs, 93 cross-seat claim pairs sharing ≥40% of their terms (plus 183 slug-rule firings, in 64 of 136 logs) occurred despite the prompt-only rule.
- **RE-TARGET hub-carries-what-it-knows:** ask-only delivery hid 20–30 messages at a time in this room and caused a duplicate audit (#129), a stale merge (#180) and a reverted integration (4838856). A peer ask now leads the queue; human asks remain exclusive.
