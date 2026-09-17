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

## Target · 2026-09-17 — A self-improvement lobby builds its own items; the hub enforces the verify entry; the maintainer only integrates and runs the tests

**Context:** Six read-only fleet rooms ranked 45 items (docs/fleet-*-summary.md). Building them by hand had already shipped bugs the next room found. Benji: nothing is built without research, and the agents should build and verify, not the maintainer. The launcher had no way to fix a room's policy (the first seat did), no way to keep recruits off exhausted providers, no respawn, and a recruit with edit rights worked in the shared checkout.
**Ruling:** (1) The launcher creates the room with its policy before any seat joins (POST /rooms/:room/create; --quorum, --require-verification, --prompt); a build room's proposal cannot pass without a verify/* entry by another connection naming it. (2) Write-enabled recruits get their own worktree and branch; recruits can be pinned to one provider (CHATROOM_RECRUIT_AGENT/MODEL); a seat that exits while its room is open is relaunched (--respawn); seats absorb empty waits locally before spending a model turn. (3) Merged from the lobby, all branch-verified and re-tested on the integrated tree: quiet-thread receipts, seat env minimisation (CHATROOM_HUMAN_TOKEN never reaches a seat), inbox handover defects, blocking challenges must quote a matching span, structured result.json artifact for run handoff, refusal telemetry with call outcomes, replay parity for amend timestamps and challenge concessions, same-session challenges do not satisfy the gate, human-answer predicates, seat search reports failures as failures, single-letter mentions parse. (4) The maintainer merges only branches with a verify entry, in ranked order, with build+smoke after each and every branch's regression script on the integrated tree; a branch-green test that is red integrated is fixed as a test, never by loosening the hub.
**Consequences:**
- Positive: The system improves itself from evidence its own agents produced and verified, at zero model cost on a free model; the maintainer's judgement is confined to integration and to refusing what does not pass; every item traces to a room, a reproduction and a verify entry.
- Negative: A majority lobby concluded on 13 of 40 original voters (17 left before the vote; the tally line divided 16 agrees by 44 present); the room's own fetched research argues against majority convergence; per-branch verification did not catch two integration breaks; 87 worktrees and 25 rooms of transcript per round; the seat-env regression needs NODE_OPTIONS=--experimental-vm-modules.
**Vision-fit:** n/a — internal tooling
**Researched:** Fetched by the lobby this round (new to the index): arXiv:2608.30373 (a single judge beats consensus multi-agent debate; strict-role asymmetry biases downward), arXiv:2609.03619 (majority convergence amplifies shared misconceptions), arXiv:2609.00683 (debate suppresses diversity); the lobby's conclusion frames these as hypotheses to benchmark, not adopted rulings: a paired outcome benchmark with held-out acceptance checks, stance-neutral verify prompts, reliability-weighted voting. Fetched by the seat room: arXiv:2404.06654 (RULER: effective context is below the claimed window), arXiv:2412.10079 (multi-hop degradation with evidence spacing). Already in the index and applied: arXiv:2308.00352 executable feedback and pub/sub, arXiv:2310.06770 and 2410.10934 execution-based acceptance, arXiv:2310.01798 self-assessment is not evidence, arXiv:2406.07155 saturation of multi-agent gains.
**Rejected:** Building the 45 items by hand (the DeepSeek room found bugs in the maintainer's own hour-old code); unanimous quorum in a 40-seat lobby (O(N) fresh votes per amend); letting the first seat set the room's policy; letting recruits pick any provider; unlimited per-room seats without idle-wait coalescing (100 requests/min is the measured ceiling).
**Anchored-bet:** [BET] a lobby that recruits, branches, builds and verifies its own items converges faster and safer than a maintainer building from its lists
**Revisit-when:** a merged item verified by its break-out room breaks main in a way the integrated regression scripts did not catch; or a lobby concludes on fewer than a third of its original electorate; or the measured @-reply rate (42% baseline) does not rise after the attention-gate item lands; or the board manifest cost is not reduced by a delta or subscription mechanism within two rounds
**Scope:** src/hub.ts,src/server.ts,src/index.ts,src/seat.ts,src/openrouter.ts,src/swarm.ts,src/spawner.ts,src/fleet.ts,src/result.ts,src/env.ts,prompts/loop.md,scripts/*.ts
**Source:** manual
**Evidence-change:** swarm-190103-v18i (40 stealth/union-alpha seats, majority lobby with require_verification, respawn, 25 break-out rooms, 87 worktrees, 4 hours budget, concluded at v17 in 50 min): eleven items built on branches, each with a failing test first and an independent verify/* entry; merged onto integration/loop-190103 with build+smoke after each merge; two branch-green tests were red on the integrated tree and were fixed as tests (docs/self-improvement-lobby-swarm-190103.md, docs/fleet-174517-summary.md, docs/fleet-181630-summary.md).
