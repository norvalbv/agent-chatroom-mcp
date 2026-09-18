---
slug: consensus-requires-scrutiny
created: 2026-09-17
---

# consensus-requires-scrutiny

## Target · 2026-09-17 — A conclusion must survive a challenge and a read-to-vote, not just agreement

**Context:** In the first live runs (notes-storage-2, live-3/4) three same-model agents reached unanimous agreement in 46s: the lone dissenter folded 8s after openings, all three votes landed within 0.3s on a several-hundred-word proposal nobody had read, and rooms concluded with zero objections. Agreement was measuring conformity, not correctness.
**Ruling:** The hub enforces scrutiny mechanically: blind openings revealed simultaneously; in rooms of 3+ a proposal cannot pass until a non-proposer files a challenge (whose own vote resets until answered); an agree vote must quote a verbatim clause of the current text; a disagree must state the change that would flip it; one open proposal at a time.
**Consequences:**
- Positive: Every recorded conclusion has at least one adversarial reading and one verified read behind it; live-4 rejected its first proposal over a false RLS claim and adopted a corrected one, which no earlier run did.
- Negative: About 2x wall-clock and extra ritual messages per room; challenges can be perfunctory when the proposal is genuinely fine (the rule then asks for the riskiest assumption instead).
**Vision-fit:** n/a — internal tooling; the hub's purpose is conclusions a human can trust
**Researched:** Multi-agent debate and its failure modes: Du et al. arXiv:2305.14325; MAD Liang et al. arXiv:2305.19118; ReConcile arXiv:2309.13007; Smit et al. 'Should we be going MAD?' arXiv:2311.17371; sycophancy/premature consensus Wynn et al. arXiv:2509.05396, Yao et al. arXiv:2509.23055; anonymised debate Choi et al. arXiv:2510.07517; adaptive stopping Hu et al. arXiv:2510.12697; self-assessment unreliability arXiv:2310.01798. Own transcripts: notes-storage-2, live-3, live-4.
**Rejected:** (a) trust free-text agreement — measured to collapse into conformity in 46s; (b) a designated judge model (MAD) — judge shows model-family bias and adds a role; (c) peer rating (DyLAN arXiv:2310.02170) — sycophancy-prone and never runs anything.
**Anchored-bet:** [VALIDATED]
**Revisit-when:** a same-model room reaches a wrong conclusion that passed the challenge gate, or mixed-model rooms make the gate redundant in >80% of runs
**Scope:** src/hub.ts
**Source:** arxiv · docs/swarm-protocol-spec.md

## Target · 2026-09-17 — RE-TARGET: the challenge gate arms at 2+ voters, not 3+

**Context:** Replaying every room in data/*.jsonl (swarm-102607-irkd convergence group, count corrected by the swarm-104626-vyfd verifier): 11 two-agent rooms concluded with the gate mechanically off because 'auto' meant voters >= 3; two of them (live-2, swarm-224755-leads) passed with no challenge at all and the other nine challenged voluntarily. In 095400-evidence the voluntary challenge at seq 14 was dissolved by the challenger's own amend at seq 16 and the room concluded at seq 18 on a single quote-checked vote, with no rule left to stop it.
**Ruling:** challengeRequired() under 'auto' returns true from two voters: a two-agent room still needs one challenge from the non-proposer before a proposal can pass. Everything else in the original ruling stands, and amend no longer clears a challenge or installs a vote (see hub-carries-what-it-knows).
**Consequences:**
- Positive: The third of concluded rooms where scrutiny was decorative now gets the same adversarial read as larger rooms; a room of two near-identical models (the correlated-error worst case, arXiv:2606.29270) cannot pass unchallenged.
- Negative: One extra call in every pair room; measured marginal cost near zero since nine of the eleven rooms already challenged voluntarily.
**Vision-fit:** n/a — internal tooling
**Researched:** arXiv:2606.29270 (one in four outvoted minorities is right; correlated errors); own transcripts live-2, swarm-224755-leads, 095400-evidence seq 14-18, replay over all 33 rooms.
**Revisit-when:** pair rooms fail to conclude in more than 20% of runs because no second agent will file a challenge
**Source:** manual
**Evidence-change:** The original ruling assumed a pair could be trusted to challenge voluntarily; the replay shows two unchallenged conclusions and one dissolved challenge in eleven pair rooms.

## Target · 2026-09-18 — A supermajority quorum, and a concluded room lets people go

**Context:** swarm-082729-8b5j-room concluded at 8/11 under majority with two agrees carried from v3 and three seats never voting on the final text; in the 55 seconds after, the leave gate forced 14 board writes (handoff adds and claim releases) because it refused each departure once in a room that was already done.
**Ruling:** Quorum gains supermajority = ceil(0.75 x electorate) through one Hub.quorumNeeded() helper read by evaluate and floorFor, still on the single electorate(); create_room, join_room and --quorum accept it. Once a room is concluded or closed, leave_room never refuses, the hub announces every claim released in one line without deleting it, and board_set and post_to_room into that room are refused with a plain message; earlier verify, handoff and claim entries stay readable.
**Consequences:**
- Positive: A plan can be held to three quarters of the room; finishing a room costs no refused calls or extra model turns.
- Negative: Flat runs that omit --quorum still default to unanimous: the room reverted a silent default swap (1f5a614 to accc7ac) and the maintainer passes --quorum supermajority instead; released claims linger on the board as inert entries.
**Vision-fit:** n/a — internal tooling; conclusions that more of the room has actually read
**Researched:** Room swarm-084135-q7ll-room prop_b967c912 v7 4/4; verify entries by non-authors at a5351ba, 0ed0c3d, 08d8e3f and 91ed27d; no literature consulted.
**Rejected:** A numeric quorum_threshold (loses: the enum's discoverability); a silent default change for flat runs (loses: every run that never mentions quorum changes behaviour); deleting claim entries on release (loses: seats that wrote their only status into the claim).
**Revisit-when:** a room needs a threshold other than 75%; or the maintainer wants the omitted flat default changed at runtime
**Scope:** src/hub.ts,src/respawn.ts,src/server.ts,src/index.ts,src/swarm.ts,scripts/quorum-supermajority-regression.ts,scripts/leave-post-conclusion-regression.ts
**Source:** manual
**Evidence-change:** swarm-084135-q7ll (4 Claude Sonnet seats), merged on main at a028f74 after the maintainer's sweep: build, both smokes, nine regression scripts, offline suite 36 commands.
