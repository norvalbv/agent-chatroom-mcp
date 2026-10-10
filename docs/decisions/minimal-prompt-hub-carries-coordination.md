---
slug: minimal-prompt-hub-carries-coordination
created: 2026-09-17
---

# minimal-prompt-hub-carries-coordination

## Target · 2026-09-17 — Agents get the goal and the tools; coordination lives in the hub, not in a scripted protocol

**Context:** Guided prompts (numbered protocol, hint-driven loop, assigned lenses) produced robotic agents: identical 1.7-2.3k-char openings, ritual challenges, protocol boilerplate instead of answers. An A/B on the same topic (live-5 guided vs live-6 minimal) showed the minimal prompt self-organised (agents assigned each other steelman roles unprompted), reached the same answer, and the lenses changed nothing.
**Ruling:** Default prompt states only the goal, who is in the room and that a board exists; every coordination rule that must hold (stale-send guard, one open proposal, challenge gate, register caps, share guard) is enforced by the hub and explained in tool descriptions. Guided (participant.md) and terse (terse.md) registers remain opt-in.
**Consequences:**
- Positive: Natural conversation with the same convergence; behaviour differences between models (Codex terse, Claude verbose) become visible instead of being flattened by the prompt.
- Negative: Roughly 2x time and 50% more chat than the guided prompt on the same task; register is the model's default and can read as colleagues role-playing.
**Vision-fit:** n/a — internal tooling
**Researched:** Own A/B live-5 vs live-6; self-improvement swarm swarm-232136 (its spec is docs/ and README); role diversity ChatEval arXiv:2308.07201 (diversity matters more than count) — but assigned lenses did not produce it here.
**Rejected:** (a) keep the guided protocol — produced the robotic register Benji rejected; (b) per-agent lenses — no measurable effect on openings; (c) OpenAI incident-style terse tokens as a target register — that style was a channel artefact (directory names), not free choice.
**Anchored-bet:** [BET]
**Revisit-when:** a task where minimal-prompt rooms fail to converge in 2x the guided time, or a mixed-model room needs protocol scaffolding to include a weaker model
**Scope:** prompts/**,scripts/debate.sh
**Source:** collab · docs/swarm-protocol-spec.md

## Target · 2026-09-18 — RE-TARGET: the minimal prompt carries one sentence of quiet guidance

**Context:** Guidance to use quiet=true for working exchanges lived only in prompts/loop.md and the send_message description. The loop.md lobby sent 66 quiet messages; every minimal.md room sent 0, and in swarm-082729-8b5j-room 55 of 72 chat messages were @-addressed yet pushed to all 11 seats, a full-context turn each for ten seats with no use for them.
**Ruling:** minimal.md, recruit.md and worker.md carry one short sentence: working exchanges with named seats are quiet; claims, evidence pointers, proposals, challenges, votes and anything someone must act on are public. scripts/quiet-guidance-regression.ts fails if a flat-run prompt lacks it. The read-digest convention stays out of minimal.md.
**Consequences:**
- Positive: Addressed working chatter stops costing every other seat a turn.
- Negative: A narrow exception to 'tool descriptions alone are enough', paid in a few prompt words on every turn; the hub still delivers public @-messages to everyone.
**Vision-fit:** n/a — internal tooling; the hub carries coordination, the prompt carries only what the hub cannot
**Researched:** Measured on the hub's own quiet counters across swarm-214936-s3jy-room and four rooms of 2026-09-18; built as item 3 of swarm-084605-6m31 (7a57cb7, verify/item3 by a non-author).
**Rejected:** Leaving it to the tool description (loses: measured 0 quiet messages in every minimal-prompt room).
**Revisit-when:** minimal-prompt rooms still send no quiet messages on the next run, which would argue for quiet-by-default delivery of @-messages in the hub instead of prompt words
**Scope:** prompts/minimal.md,prompts/recruit.md,prompts/worker.md,prompts/loop.md,scripts/quiet-guidance-regression.ts
**Source:** manual
**Evidence-change:** Maintainer note #77 in swarm-084605-6m31-room with the counts above; merged on main at da412ce.

## Target · 2026-10-10 — Two-seat working exchanges go quiet by default in the hub; the prompt sentence did not do it

**Context:** The 2026-09-18 Target put one sentence of quiet guidance into the minimal prompt and named its own trigger: if rooms still sent no quiet messages, deliver @-messages quiet by default in the hub instead. Across every room log, claude seats sent 495 of 6433 chat messages quiet (7.7%), codex seats 41.9% and openrouter seats 18.9%, with the same sentence and tool description. Before and after the sentence claude went from 5% to 9% (a comparison of two periods with different rooms and tasks; codex went 3% to 44% on 35 against 3784 messages). In swarm-082539-kns2, claude seats sent 0 of their first 43 messages quiet. The owner raised it, noting that rooms with codex seats use quiet messages constantly.
**Ruling:** When the sender does not pass quiet (unset, not false), the hub delivers an agent's message quiet only if all of these hold: the sender is an agent in a free-mode room and no human is named or replied to; the audience is one or two other agents; neither side is the verifier, a lead or a chair; and the text carries nothing the room acts on (no coordination board key, proposal id, commit-like token, settled-axis slug, RE-TARGET, or first-person commitment such as 'I'll take'). The send result tells the sender it went quiet and that quiet=false makes it public. Explicit quiet=true is unchanged, and quiet-delivery-not-privacy stands (832d405b).
**Consequences:**
- Positive: Who hears a working exchange is the hub's default, not the sending model's habit, and it errs public. On replay 16% of claude chat messages flip (median room 15.4%, interquartile range 9.5% to 25.9%), about 2.58M bystander characters across the logs.
- Negative: Near-zero effect on an all-opus fleet: 0 of 7 messages flipped in the live dev room, and 1 of 217 and 3 of 116 on replay of rooms like it, because opus seats put a board key, a commit or a commitment in nearly every addressed message. The live saving is unmeasured. The cost of a wrongly quieted message is invisible, since a seat that never learned something does not say so. A message naming two seats in a four-seat room goes quiet to three of four.
**Vision-fit:** n/a — internal tooling
**Researched:** arXiv:2406.11776 (sparse communication topology in multi-agent debate: accuracy held at about 40% less input cost at moderate sparsity, and a strong agent at a low-degree node loses information); arXiv:2410.02506 (AgentPrune: pruning redundant inter-agent messages cut tokens 28.1% to 72.8% at comparable accuracy); arXiv:2308.00352 (MetaGPT: a shared pool with subscription, so the hub and not the sender decides delivery). Read before building.
**Rejected:** (a) more prompt words: the sentence moved claude seats from 5% to 9% at most, and round 1 found prompting barely moves them (recruiting 2% to 3%); (b) quiet for every @-message: commitments and evidence pointers are what stop duplicate work, and 458 of 1389 messages that would have flipped carried a first-person commitment; (c) quiet to or from the verifier: asks to merge or verify are the whole room's business.
**Anchored-bet:** [BET] who hears a message is better decided by the hub from what the message carries than by the model that sends it
**Revisit-when:** a seat is shown to have duplicated or missed work because a message it needed was auto-quieted; or auto-quiet's share of agent chat stays under 2% in live rooms across the next three rounds (then remove it); or a measured before and after on a mixed-model fleet shows no saving
**Scope:** src/hub.ts,src/hub/types.ts,src/server.ts,scripts/quiet-default-regression.ts,scripts/quiet-candidates-measure.py,scripts/offline-runner.mjs
**Source:** owner-approved re-target 2026-10-10 of swarm-082539-kns2 (prop_132e54cc v17, item 13) · docs/self-improvement-swarm-082539-kns2.md
**Evidence-change:** The 2026-09-18 Target's own revisit condition was met: with the sentence in the prompt, claude seats still sent 9% of chat quiet (codex 44%) and 0 of 43 in this room. Round 2 moved the choice into the hub. quiet-default-regression fails at c7e925e7 and passes at 832d405b; merged on main at faf2fc23.
