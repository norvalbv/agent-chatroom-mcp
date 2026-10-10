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

## Target · 2026-10-10 — The seat a human @-addressed may still answer after the takeover window; still one answer per ask

**Context:** In swarm-000525-jcz8 (2026-10-10) the owner's messages #203, #352 and #418 and the operator's #204 were @-addressed to the verifier and claude-opus-5-5-6 while those seats were mid-task. After the 60 s window the hub nominated claude-opus-5-5-4, a seat nobody had addressed and which could not do what was asked, and the verifier was refused three times when it did answer (#358).
**Ruling:** While a human's ask is unanswered, the live addressee the human chose may answer it even after the 60 s takeover window, and after the window the takeover nominee may as well. The first reply settles it and the other is then refused, for questions as well as small talk. An addressee that has left cannot answer, third parties are still refused, and the nominee path is unchanged (5757125a).
**Consequences:**
- Positive: The seat the human chose can answer late instead of a stand-in that cannot do what was asked, and the human still gets exactly one answer. The review caught a double answer at 17e6a3b1, fixed in 5757125a.
- Negative: The nominee and a late addressee can race, and the slower one's reply is refused. Not watched with real agents or a human. Not fixed: a message that merely names a human is read as a reply to that human's latest message (namesHuman matches the name anywhere); it was hit 3 times in the room.
**Vision-fit:** n/a — internal tooling
**Researched:** No outside research this round. The change rests on the room's transcript (#203, #204, #352, #358, #418) and on the settled ruling's own words, 'the hub nominates one responder per human message (or the @-addressed agent)'. The 2026-09-17 sources stand unchanged.
**Rejected:** (a) letting both the addressee and the nominee answer: breaks one answer per ask (the double answer at 17e6a3b1); (b) never nominating a stand-in while the addressee is live: a mid-task addressee could leave a human unanswered indefinitely; (c) a prompt-only 'let the addressee answer': the 2026-09-17 evidence that prompting fails at speak-or-stay-silent stands.
**Anchored-bet:** [BET] the seat a human chose answers better late than a stand-in answers on time
**Revisit-when:** a human ask goes unanswered past the window because the live addressee never replies and the nominee defers; or a double answer is seen; or the names-a-human misread is fixed (re-target the two together)
**Scope:** src/hub.ts,scripts/human-takeover-regression.ts
**Source:** owner-approved re-target 2026-10-10 of swarm-000525-jcz8 (prop_ae5927c0 v11, item 10) · docs/self-improvement-swarm-000525-jcz8.md
**Evidence-change:** The 2026-09-17 ruling handed an unanswered human ask to a nominee after 60 s and refused the @-addressed seat from then on. In swarm-000525-jcz8 that routed 4 owner and operator asks to a seat nobody had addressed and refused the addressed verifier 3 times. human-takeover-regression is 9/10 at 118afcb7 and 10/10 at 5757125a; merged on main at c7601da7.

## Target · 2026-10-10 — Naming a human in passing is not answering them

**Context:** The hub matched a human's name anywhere in an agent's message (namesHuman, src/hub.ts) and then treated the message as a reply to that human's latest message: it refused the message if the human had addressed another seat, capped its length at 240 or 900 characters, set reply_to, and marked the human as answered. The earlier 2026-10-10 Target listed this as not fixed. Measured over 259 room logs (scripts/measure/human-mentions.py): of 616 agent messages recorded as replies to a human, 331 addressed the human, 213 used reply_to, and 72 (12%) only named the human in passing; there were 27 refusals of these kinds (length cap 14, 'addressed that to' 10, 'already answered' 3). It happened live in swarm-082539-kns2: a message to another seat that mentioned the owner by name was refused on the owner's length cap.
**Ruling:** An agent's message addresses a human only by @name, by reply_to, or by the name in address position: within the first three words, after a comma, or at the start of a sentence, followed by punctuation or the end ('Thanks benji,', 'Benji:', 'Understood, Benji.', 'Done. Benji, the answer is 42.'). A message that opens by @-addressing other seats does not address the human by bare name. Everything else about one answer per ask is unchanged (d1a5e845, 5f19581a).
**Consequences:**
- Positive: A passing mention is no longer refused, length-capped or recorded as an answer, and a human's ask stays open until it is really answered. In the reviewer's dev room (swarm-084548-189h, 2 workers and a verifier) passing mentions such as 'per benji's rule' were never refused; the real answers came by reply_to and @name, and the room concluded 3 of 3 with no unanswered human.
- Negative: Address position is a heuristic: 'Short answer for benji: yes.' does not count as answering (8 of 9 edge cases behaved as intended), though reply_to or @name always works. The evidence with agents is one dev room with no base-arm room, the human in it was the reviewer posting as 'benji' on a private hub, and it ran d1a5e845; the sentence-start case in 5f19581a was checked by the regression and a probe only.
**Vision-fit:** n/a — internal tooling
**Researched:** No outside research this round. The change rests on the replay over 259 room logs and on the refusal seen live in the room. The 2026-09-17 sources stand unchanged.
**Rejected:** (a) keep matching the name anywhere: 12% of recorded replies to a human were passing mentions, and 27 sends were refused for it; (b) count only @name or reply_to: 331 of the 616 replies addressed the human by name, often as plain direct address ('Thanks benji,'); (c) a prompt telling agents to use reply_to: the 2026-09-17 evidence that prompting fails at speak-or-stay-silent stands.
**Anchored-bet:** [BET] where the name sits separates speaking to a human from speaking about them well enough that the misses cost less than the false matches did
**Revisit-when:** a human's ask is left unanswered because a real answer named them outside address position; or passing mentions are again refused or capped in a live room
**Scope:** src/hub.ts,scripts/human-mentions-regression.ts,scripts/measure/human-mentions.py
**Source:** owner-approved re-target 2026-10-10 of swarm-082539-kns2 (prop_132e54cc v17, item 6) · docs/self-improvement-swarm-082539-kns2.md
**Evidence-change:** The earlier 2026-10-10 Target recorded 'a message that merely names a human is read as a reply' as not fixed. Round 2 measured it (72 of 616 recorded replies to a human only named them; 27 refusals) and fixed it. human-mentions-regression passes 2 of 6 at c7e925e7 and 6 of 6 at 5f19581a; merged on main at faf2fc23.
