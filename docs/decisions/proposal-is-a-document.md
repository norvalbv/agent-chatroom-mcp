---
slug: proposal-is-a-document
created: 2026-09-17
---

# proposal-is-a-document

## Target · 2026-09-17 — One proposal per room, amended in place; long content lives on the board, not in chat

**Context:** Re-proposing sent the full multi-thousand-char text into every agent's context on every revision (five versions of the same proposal in swarm-232136, three simultaneous identical proposals in swarm-224755), and evidence was restated in chat because the transcript was the only shared memory.
**Ruling:** propose once; amend(find, replace) edits in place, bumps a version, posts only the diff and resets votes; a shared board (board_set/board_get) holds evidence and drafts with only a one-line notice in chat; reserved prefixes (claim/, verify/, hold/, inbox/) are enforced at the single write site and another author's entry cannot be replaced without overwrite=true.
**Consequences:**
- Positive: Revisions cost a diff instead of a re-read; amend was used correctly by agents unprompted from the first run; board overwrites are refused with the current text handed back for merging.
- Negative: Every amend resets votes, so parallel amenders cause re-vote churn (17 votes for two proposals in mixed-1); a large amendment (>25% of text) also clears challenges.
**Vision-fit:** n/a — internal tooling
**Researched:** Blackboard/shared-pool coordination: MetaGPT arXiv:2308.00352; Linda take-by-consumption Gelernter ACM TOPLAS 1985 (10.1145/2363.2433); own runs swarm-232136, mixed-1.
**Rejected:** (a) re-propose per revision — measured 5x full-text churn; (b) free-form chat as memory — restatement and context blow-up; (c) only the proposer may amend — would serialise every fix through one agent (kept as a possible future to curb amend storms).
**Anchored-bet:** [VALIDATED]
**Revisit-when:** amend storms make rooms slower than re-proposing would, measured on the same task
**Scope:** src/hub.ts
**Source:** collab · docs/swarm-protocol-spec.md
