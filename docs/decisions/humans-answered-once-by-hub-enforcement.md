---
slug: humans-answered-once-by-hub-enforcement
created: 2026-09-17
---

# humans-answered-once-by-hub-enforcement

## Target · 2026-09-17 — A human message gets exactly one short reply, enforced by delivery, not by prompting

**Context:** In live-7 a human 'hello team' drew three replies of 464/1228/1175 chars and 'tell me a joke' drew three jokes, even after the hub told two agents 'X is answering, you don't need to'. Agents treat any user-tagged message as addressed to them personally and bundle their debate into the reply; prompt-level instructions were ignored.
**Ruling:** The hub nominates one responder per human message (or the @-addressed agent), withholds the message from everyone else until it is answered, caps replies to the human's register (240 chars for small talk, 900 for questions), refuses second greetings, and blocks propose (once) while a human is unanswered.
**Consequences:**
- Positive: live-8: one 58-char reply to 'hello team', one 84-char joke, @all answered once each; zero unanswered human messages. Humans can interject without derailing the room.
- Negative: Non-responders see the human message only after the reply (up to 20s/60s later); register caps occasionally refuse a legitimately long answer, which the agent must shorten or split.
**Vision-fit:** n/a — internal tooling
**Researched:** Multi-party dialogue response obligation (Traum & Allen 1994; Traum 2004); addressee recognition surveys arXiv:2505.18845, arXiv:2501.16643, arXiv:2607.15648; when-to-speak: MultiLIGHT arXiv:2304.13835, MUCA arXiv:2401.04883, HUMA arXiv:2511.17315, Time to Talk arXiv:2506.05309; benchmarks showing prompting fails at speak/stay-silent: When2Speak arXiv:2605.05626, Speak-or-Stay-Silent arXiv:2603.11409, MP-Bench arXiv:2609.13076; user-assistant bias arXiv:2508.15815; RLHF length bias arXiv:2310.03716, arXiv:2406.17744. AutoGen speaker selection arXiv:2308.08155; MetaGPT pub-sub arXiv:2308.00352.
**Rejected:** (a) prompt-only 'reply only if addressed' — measured to fail (live-7) and shown to fail across 8 models in arXiv:2603.11409; (b) random reply delay — reduces but does not prevent duplicates; (c) hard block on all replies but one — would silence a needed correction.
**Anchored-bet:** [VALIDATED]
**Revisit-when:** a model family reliably stays silent under a prompt-only rule in the benchmarks above
**Scope:** src/hub.ts,src/server.ts
**Source:** arxiv · docs/swarm-protocol-spec.md
