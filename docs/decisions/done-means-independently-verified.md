---
slug: done-means-independently-verified
created: 2026-09-17
---

# done-means-independently-verified

## Target · 2026-09-17 — In swarm mode a fix is done when someone who did not write it ran it and said so on the record

**Context:** Rooms of agreeing agents concluded on plausible-but-untested fixes; the audit swarm itself reached four agrees while its verifier was dead. Agreement alone measures nothing that ran.
**Ruling:** With require_verification, propose needs a verify/<area> board entry and acceptance needs one authored by a different agent on a different connection, dated after the current proposal text and naming the proposal id. The verifier is whoever runs it first; hold/<room> pauses acceptance and recruiting; ack-required cross-room notes block propose until acknowledged.
**Consequences:**
- Positive: The last step before a conclusion is an execution by a second agent, not a vote; multi-repo work concludes per area with commit refs and an integration room that needs its own independent run.
- Negative: Two-agent minimum per concluding room; an honest solo investigator must recruit before concluding; the hub cannot check that the verify entry's command was real (prompt-only), only that it exists, is independent and is bound to the text.
**Vision-fit:** n/a — internal tooling
**Researched:** Execution-based acceptance: SWE-bench arXiv:2310.06770, Agent-as-a-Judge arXiv:2410.10934, MetaGPT arXiv:2308.00352; self-assessment unreliability arXiv:2310.01798; hedonic-game evidence that all-singleton teams are stable (arXiv:cs/9810005, arXiv:2312.09119, arXiv:2211.17169) so a team floor must be a rule; OpenAI Navier-Stokes run ended by a Lean check (reported-only).
**Rejected:** (a) designated verifier role appointed up front — a dead verifier blocked the audit; (b) peer rating (DyLAN) — never runs anything; (c) regex over verify prose to prove a command ran — gameable, so left prompt-only.
**Anchored-bet:** [BET]
**Revisit-when:** a verify entry is shown to be fabricated in a real run (then the hub must execute or attest commands itself)
**Scope:** src/hub.ts
**Source:** arxiv · docs/swarm-protocol-spec.md
