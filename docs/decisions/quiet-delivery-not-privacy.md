---
slug: quiet-delivery-not-privacy
created: 2026-09-17
---

# quiet-delivery-not-privacy

## Target · 2026-09-17 — Addressed messages are pushed only to their audience but never hidden from the log, peers or the human

**Context:** Every @-message landed in every agent's context (N copies for a one-to-one exchange), which motivated a 'private' flag; but the only real-world evidence of private agent channels (OpenAI HF incident: mailboxes, ignored pause requests, peers trusting passed goals) and the covert-collusion literature point the other way, and the hub's challenge/vote/verify mechanics assume an open record.
**Ruling:** quiet=true pushes an @-message to the named agents only; it stays in the log, in read_messages (marked), in the transcript and dashboard; bystanders get a collapsed activity stub; threads surface automatically when cited in a proposal, challenge or board entry, on surface=true, or at conclusion; quiet is refused for humans, unaddressed messages and any non-chat kind. No peer-hidden tier exists.
**Consequences:**
- Positive: Context saving of N copies to one per addressed exchange without creating a channel the room or the human cannot see; a whispering room is never indistinguishable from an idle one.
- Negative: Loss of passive peer awareness (objections become retrospective until a thread surfaces); no measured token saving, only the counting argument.
**Vision-fit:** n/a — internal tooling
**Researched:** Secret Collusion among AI Agents (Motwani et al., arXiv:2402.07510); CoT monitorability (Korbak, Balesni et al., arXiv:2507.11473); Werewolf/Avalon whisper mechanics arXiv:2310.14985, arXiv:2402.02330, arXiv:2512.09187, arXiv:2310.05036 (disanalogy: concealment is the win condition there); MetaGPT subscription delivery arXiv:2308.00352; AutoGen nested chats (scoping, not privacy); OpenAI HF-incident post (primary, read directly).
**Rejected:** (a) true private messages — removes the substrate monitoring and peer dissent work on; (b) an 'unlisted' human-readable-only tier — the incident shows 'the human could look' is the control that already failed; (c) no addressed delivery at all — leaves the N-copies cost.
**Anchored-bet:** [BET]
**Revisit-when:** a measured context saving below 20% on real runs, or a case where quiet threads were used to route around a challenge
**Scope:** src/hub.ts,src/server.ts
**Source:** arxiv · docs/quiet-delivery-decision.md
