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

## Target · 2026-09-23 — RE-TARGET: under auto, a verified room drops the mandatory challenge

**Context:** This axis's own revisit trigger fired: "a same-model room reaches a wrong conclusion that passed the challenge gate". The swarm-232020-hdju audits (evidence/ritual-audit, evidence/rituals-audit in swarms/swarm-232020-hdju/result.json) found the following. In 38 rq1-confirmatory arm-C rooms, which run with require_challenge, require_verification and supermajority (scripts/bench-rq1.ts), 66 challenges were filed and at least 23 of them conceded in their own text. Printf passed in 5/9 rooms that amended and 5/9 that did not. Of the 9 failing printf rooms, 8 concluded "no further changes needed" under the gate and 1 timed out (seed503). Across 66 swarm rooms, 27% of chat messages coordinate the procedure itself. The paper's arm C gap (printf 6/40 against one agent's 14/40) is not cited as evidence here. It is confounded, because arm C seats share one working tree (scripts/bench-rq1.ts:324-340), and arm C does not measure the deployed swarm config. The challenges that did catch real defects (swarm-140818-f1qy) came from seats that had run something, which is the verify step, not the challenge requirement. That hdju room reached this diagnosis and stalled without merging it. swarm-092653-202z salvaged the build.
**Ruling:** challengeRequired() under 'auto' is false when require_verification is on, because the room already requires a passing verify/* by a non-author. That entry is self-reported and is not a machine check (see Negative). It stays true from two voters when there is no machine check. An explicit require_challenge=true still wins. The swarm ensureRoom for recruit sub-rooms no longer forces it. The challenge tool stays available for real defects, and executable challenges (settle-disputes-by-spec-not-count) still block until rerun. Quote-checked votes, blind openings and one open proposal are unchanged.
**Consequences:**
- Positive: Verified rooms lose one mandatory ritual call per proposal, and the concede-in-the-same-breath challenges that reset votes go with it. The audits found that the defects actually caught were found by seats who ran the work, not by the required challenge.
- Negative: A verified room can now pass a proposal no one argued against. The protection rests on the verify gate, and evidence/verify-gate-audit (swarm-092653-202z) found that gate is mostly a stamp: 3 of 157 heads carried a nonzero exit, and 55% named no commit. In a verified room with no challenge, that stamp is all the mandatory scrutiny left. Hardening it (for example, binding verify/* to a commit the hub can resolve) is open work, not part of this ruling.
**Vision-fit:** n/a — internal tooling
**Researched:** No new literature. Own data: swarm-232020-hdju evidence/ritual-audit and evidence/rituals-audit; hdju verify-notes/conformity-retarget (the arm C shared-tree confound, and the 8 concluded + 1 timeout count); swarm-092653-202z transcript-kind split of swarm-083203-kooz (votes 7.6%, challenges 6.1% of 149k transcript chars).
**Rejected:** (a) drop the challenge gate everywhere. That loses the pair-room protection in the 2026-09-17 re-target when no machine check exists. (b) keep it and prompt for better challenges. The tool description already says not to concede-challenge, and 23+ of 66 did anyway.
**Revisit-when:** a verified room with no challenge concludes on something a later run shows wrong that a challenge would have caught; or the machine-oracle bench shows arm C with the gate beating arm C without it
**Scope:** src/hub.ts,src/index.ts,src/server.ts,src/spawner.ts,prompts/*.md,scripts/challenge-verification-regression.ts,scripts/smoke.ts
**Source:** manual
**Evidence-change:** The 2026-09-17 ruling assumed the challenge was where scrutiny happened. The 38-room audit shows challenges mostly conceding caveats with no association to pass rate, while the verify step caught the real defects.
