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
