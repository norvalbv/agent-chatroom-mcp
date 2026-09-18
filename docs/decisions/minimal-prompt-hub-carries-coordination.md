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
