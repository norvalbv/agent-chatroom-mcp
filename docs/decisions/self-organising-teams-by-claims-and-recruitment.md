---
slug: self-organising-teams-by-claims-and-recruitment
created: 2026-09-17
---

# self-organising-teams-by-claims-and-recruitment

## Target · 2026-09-17 — Teams form by first-come claims and in-chat recruitment with lineage and caps, not by auction

**Context:** The planner-assigned shape (one opus planner splitting the task, fixed rooms) could not let an agent ask for help, join another team, pass information across teams, or bring in a specialist; and a single agent per area is exactly the pattern OpenAI's grouped runs avoided.
**Ruling:** claim/<area> is a first-come atomic board claim (if_absent) that only a team of 2+ distinct agents can mark fixed/verified; post_to_room passes notes to a room you are not in without touching its vote; request_agent lets any member spawn recruits (claude or codex, chosen model) into the room or a new sub-room of two, with parent/depth lineage, briefs treated as requests not orders, and caps on depth (2), fan-out (3 live), room (12 live), run (24 live, 40 cumulative), rooms per run (12) and a 45-minute wall clock.
**Consequences:**
- Positive: Rooms recruit help in seconds (recruit-live: 24s from request to a finished haiku recruit); cross-team information flows through the board without broadcast; runaway spawning is bounded by counters the hub owns.
- Negative: Recruits are extra processes and tokens; briefs are a prompt-injection surface (mitigated by lineage and the human veto, not eliminated); near-duplicate area names are prompt-only.
**Vision-fit:** n/a — internal tooling
**Researched:** Contract Net Protocol (Smith, IEEE TC 1980) and why bidding fails for LLMs (self-reported competence unreliable, arXiv:2310.01798; bid storms); Linda take-by-consumption (10.1145/2363.2433); AgentVerse arXiv:2308.10848; DyLAN arXiv:2310.02170; AutoGen nested chats arXiv:2308.08155; CAMEL arXiv:2303.17760; MacNet logistic scaling arXiv:2406.07155; Optima arXiv:2410.08115; Self-Organized Agents arXiv:2404.02183; OpenAI HF-incident post (help request was the first board use; HOLD/GO/VETO norms; ignored pause requests).
**Rejected:** (a) contract-net bidding tool — bids are self-reported competence; (b) planner-only assignment — cannot adapt mid-run; (c) uncapped recruitment — Self-Organized Agents offers no ceiling and MacNet shows gains saturate.
**Anchored-bet:** [BET]
**Revisit-when:** a run where first-come claims leave the best-placed agent without the area, or caps block a run that would have converged
**Scope:** src/spawner.ts,src/hub.ts,prompts/recruit.md
**Source:** arxiv · docs/swarm-protocol-spec.md
- 2026-09-17 — request_agent and the swarm launcher gained a third seat kind, openrouter: src/openrouter.ts is itself the CLI (one process = one MCP session = one identity), converting the hub's MCP tools into OpenAI-style function tools and running the tool loop, plus four local tools (read_file, list_dir, search, run_command) that are read-only unless --write. Routing an existing CLI at OpenRouter was tried first and rejected: codex 0.154 reserves its built-in model_providers and no longer exposes wire_api, so a chat-completions gateway cannot be configured, and claude -p speaks the Anthropic Messages API which OpenRouter does not serve. Seats are allocated from one alt-provider queue (--codex k plus --openrouter m over the non-lead seats), and both the launcher and the spawner refuse an OpenRouter seat without OPENROUTER_API_KEY rather than leaving a dead seat in the quorum.

## Target · 2026-09-17 — Recruitment is bounded by the room, the machine and the run, not by a per-agent quota

**Context:** The original ruling rejected uncapped recruitment because Self-Organized Agents offers no ceiling and MacNet shows gains saturate; six caps were coded, only three of which express that argument (12 live per room, 24 live machine-wide, 40 cumulative per run). The per-requester quota of 3 expressed nothing in the research and blocked the one agent whose job is to recruit independent reviewers.
**Ruling:** The per-requester cap is off by default (CHATROOM_MAX_RECRUITS_PER_AGENT can set one); depth, per-room, machine-wide, cumulative-per-room and cumulative-per-run caps stay as the saturation ceilings; a request still spawns at most 3 at a time.
**Consequences:**
- Positive: A verifier or integrator can recruit as many reviewers as the room and run ceilings allow, which is what a rebuild run needs; runaway spawning is still bounded by counters the hub owns.
- Negative: One agent can now consume a room's whole recruit budget alone; the room-level cumulative cap (12) is the only thing stopping that, so a bad brief loop costs up to 12 seats rather than 3.
**Vision-fit:** n/a — internal tooling
**Researched:** MacNet (saturation of multi-agent gains) as cited in the original entry; no source supports a per-requester number.
**Rejected:** Raising the quota to another guess (5, 6): still a number without evidence; making the verifier exempt only (the integrator hit the same need).
**Anchored-bet:** [BET] room and run ceilings alone bound runaway recruitment in practice
**Revisit-when:** a run where one agent's recruits exhaust a room's cumulative cap and block others from recruiting; or a measured run where recruits beyond three per requester added nothing
**Scope:** src/spawner.ts
**Source:** manual
**Evidence-change:** swarm-160711-etdp (ten stealth/union-alpha seats + Claude verifier rebuilding the dashboard with --full-access): the verifier was refused its fourth recruit ('may have at most 3 recruits running (has 3)') while spawning reviewers into a break-out room; Benji asked whether the 3 was research-backed. It was a code default (spawner.ts maxPerRequester ?? 3) with no evidence behind it; the original entry's revisit-when ('caps block a run that would have converged') fired.

## Target · 2026-09-17 — The launcher replaces a seat only when the room still needs it

**Context:** With --respawn the launcher relaunched every seat that exited while its room was open. In the two 20-seat runs of 2026-09-17 evening (swarm-200839-g81x, swarm-200859-kdgq) seats finished a slice, handed over on the board and left as the brief allows once leaving_would_block is false; each was replaced by a seat that read the board, found nothing to inherit, said so and left. 70 respawns in 30 minutes, every one a board read and a few requests under the 100 req/min account cap, and five of the exits were rate-limit deaths the churn itself caused. Both runs ranked it as remaining work (evidence/launcher-respawn-code-u16r2, evidence/launcher-respawn-churn, evidence/respawn-churn-crosscheck-u7r1) and Benji raised it independently.
**Ruling:** src/respawn.ts decides from the room summary the launcher already polls: replace the seat only if its exit code was not 0 (a crash or provider death is not completion), or it left a claim/* with no handoff/* of its own, or it is the verifier, or the room's active non-human seats are below the floor (majority quorum: max(3, ceil(expected/2)); unanimous: expected). Otherwise log 'not respawning: completed …' and stop. Retries stay bounded at three and never in the last five minutes; the replacement's brief names the reason.
**Consequences:**
- Positive: Positive: a finished seat's exit is final, so a lobby's request budget goes to seats with work; a crashed seat, an orphaned claim, a thin room or a missing verifier is still repaired without a teammate noticing. Negative: a seat that finishes without writing handoff/* for its claim is replaced once more than necessary; a seat that crashes after finishing is replaced although nothing is owed.
- Negative: The floor is a fixed rule of thumb from the quorum, not the hub's frozen electorate for an open proposal; a claim/* whose text says it is done but has no handoff/* still counts as orphaned because the launcher reads only key and author.
**Vision-fit:** n/a — internal tooling; a self-regenerating room must regenerate what it needs, not everything that moves
**Researched:** The board run's attrition slice: arXiv:2609.03619 (majority convergence amplifies shared misconceptions, so a room should not be padded with fresh seats that inherit the board's consensus), arXiv:2402.05120, arXiv:2608.26081, arXiv:2605.28334 (attrition and quorum in long-running groups); the run's own reproduction of 51 recorded respawns at its time cut; the OpenAI Navier-Stokes post (via mirror) shows groups persisting for the run and a consolidator carrying results forward, not per-agent replacement.
**Rejected:** Unconditional replacement while the room is open (the churn); no respawn at all (a rate-limited-to-death seat then holds its claim and a unanimous room its vote); asking teammates to recruit replacements (the seat that would have recruited is often the one that died); reading the claim's text for a 'done' marker (the launcher would need board_get per claim and a text convention).
**Anchored-bet:** [BET] exit code, orphaned claim, verifier and a quorum floor are enough to tell a finished seat from a lost one
**Revisit-when:** a room stalls with an unowned claim that the launcher declined to replace; or a run again shows more respawns than seats; or the hub exposes the frozen electorate for open proposals so the floor can read it instead of the quorum rule of thumb
**Scope:** src/respawn.ts,src/swarm.ts,scripts/respawn-regression.ts
**Source:** manual
**Evidence-change:** Built by the maintainer from the two runs' ranked remaining item (both concluded lists, item 4) with scripts/respawn-regression.ts written first and shown red (module missing), then green (11 cases); npm run build, tsc clean, SMOKE OK; integrated in the same commit as the runs' branches on main after c945fba.

## Target · 2026-09-18 — Rooms outlive seats: revive, do not restart; a lobby's end is a consolidator's job

**Context:** OpenRouter withdrew the free model at 23:00Z mid-run; every seat and each respawn died within a minute while nine rooms kept their boards, handoffs and worktree branches. Seats hit their context window at 90-130 steps (4-6M prompt tokens) and left via handoff; the three that never handed off died in the withdrawal at 203-411 steps. The lobby's conclusion waited on one nominated drafter under context pressure while seven seats idled, and a busy seat doing local work could not be told from a dead one.
**Ruling:** (1) dist/revive.js puts fresh seats into an existing room with a read-the-board-first brief, a predecessor's worktree for builders and crash-only respawn (SIGTERM is an operator stop). (2) Seats heartbeat step, tool and detail over HTTP; the People tab shows a live feed per seat; the idle sweep trusts a fresh heartbeat. (3) Remaining, ranked by the lobby and queued for a room, not the maintainer: proactive handoff on context pressure (top), a spawned consolidator that assembles the ranked list when the last child concludes, heartbeat replies that carry what the hub waits on from a seat doing local work, structured usage telemetry, fail-closed worktree isolation and controller-owned authority, agent kick by human or vote.
**Consequences:**
- Positive: Positive: a dead model or a killed launcher no longer loses a run; a room can be resumed in one command. Negative: a heartbeating seat that never calls the hub now holds its electorate seat until its budget ends, which the queued heartbeat-reply item addresses.
- Negative: Revival costs each seat its working memory; handoff quality decides how much is lost. The maintainer built revive, heartbeats and the boot sweep directly under time pressure; from 00:40Z on 2026-09-18 nothing is built outside a room.
**Vision-fit:** n/a — internal tooling; a self-regenerating room regenerates what it needs
**Researched:** Coordination room (prop_659f2937): arXiv:2508.06433, arXiv:2601.18285, arXiv:2510.11967 on procedural memory and context folding (reversible compaction stays prototype-only); telemetry room (prop_4f14dcb3): 77 seat logs, 4,590 steps, 211M prompt tokens with usage reaching no artifact; lobby verify/context-pressure-logs: 75 seats, 4,631 steps, 222,747,995 prompt tokens, handoff cluster at 90-130 steps.
**Rejected:** Restarting the hub to recover a run (loses: every seat's session; rooms did not need it); treating any non-zero exit as a crash (loses: an operator's kill relaunched a seat three times into the repo root with write access); judging liveness by message count (loses: a builder on step 71 looked dead).
**Anchored-bet:** [BET] board handoffs plus fresh seats recover more of a run than any attempt to keep seats alive through a provider failure
**Revisit-when:** a revived room re-does work its handoffs already recorded; or a seat holds a unanimous vote for more than its budget while heartbeating; or context-pressure handoff lands and the 90-130 step cliff moves
**Scope:** src/revive.ts,src/respawn.ts,src/seat.ts,src/hub.ts,src/index.ts,src/ui.ts,scripts/respawn-regression.ts,scripts/liveness-regression.ts,scripts/session-identity.test.ts,scripts/leave-regression.ts
**Source:** manual
**Evidence-change:** 2026-09-17 23:00Z model withdrawal, six rooms revived with 17 seats, all nine children and the lobby concluded by 00:52Z on 2026-09-18; lobby ranked list prop_658c9541 v4 4/0 names R1-R9 and contradictions C1-C6; report docs/measurement-swarm-214936.md.

## Target · 2026-09-18 — A lobby's end is spawned, recruits stay in their run, and a seat cannot touch shared git config

**Context:** The previous lobby waited 25 minutes on one nominated drafter under context pressure while seven seats idled and burned tokens polling; break-out rooms named without the run prefix fell outside the run's report; a seat ran git config in a worktree and renamed the repository's commit author for an hour (and did so again in this run, before the guard landed).
**Ruling:** (1) Consolidator spawn (6a119cf): when a child room concludes the hub fires a room-state hook and the launcher/spawner starts exactly one consolidator seat for the parent lobby whose only brief is to assemble and propose the ranked list; a refused spawn never breaks the concluding vote; never fired twice. (2) Recruit run prefix (acedaab): an unprefixed new_room from request_agent is created as <requester's run prefix>-<name> and counted against that run's caps. (3) Git-config refusal (22ae36d): the seat's run_command guard order is LETHAL, then GITCONFIG, then MUTATING; every form of `git config`, including -c, -C and --no-pager variants, is refused on write and read-only seats alike; seat identity comes from GIT_AUTHOR_NAME/GIT_COMMITTER_NAME.
**Consequences:**
- Positive: Positive: a lobby no longer needs a seat to notice it is time to conclude; a run's report gathers all its rooms; the repository's identity cannot be rewritten by a seat. Negative: a consolidator is one more seat per lobby; a sudo escape of the git-config guard is documented and not blocked (LETHAL has the same precedent).
- Negative: The consolidator marks itself fired before the request is made, so a throwing request suppresses the retry (accepted by the room's verifier). Built while the previous lobby shape was still burning credit: 234M prompt tokens in 40 minutes, mostly lobby polling, ended this run early.
**Vision-fit:** n/a — internal tooling; a room's conclusion should be a job, not a hope
**Researched:** Reproductions on the board: lobby-15's 25-minute stall (verify/consolidator-spawn-lobby case 8 encodes it), recruit rooms outside the report (evidence/recruit-room-run-prefix), the git-config incident (docs/measurement-swarm-214936.md; the bypass ch_2b6b8505 proved by recruit-17 and closed at 22ae36d). OpenAI Navier-Stokes consolidator role (sources/openai-navier-stokes) as the shape.
**Rejected:** Nominating a lobby drafter (loses: one seat's context decides when the room ends); sanitizing unprefixed names instead of inheriting the prefix (the 032ef9c variant, corroboration only); blocking only global git config forms (the bypass proved -c/-C/--no-pager forms slipped).
**Anchored-bet:** [BET] one spawned consolidator per lobby ends more lobbies, sooner and cheaper, than any number of waiting seats
**Revisit-when:** a consolidator proposes a list that omits a concluded child; or a lobby concludes without one having fired; or a seat finds another way to change shared repository state
**Scope:** src/index.ts,src/spawner.ts,src/hub.ts,src/seat.ts,scripts/consolidator-spawn-regression.ts,scripts/recruit-prefix-regression.ts,scripts/spawner-run-prefix.test.ts,scripts/seat-git-config-regression.ts
**Source:** manual
**Evidence-change:** swarm-010513 (24 deepseek-v4-flash-0731 seats + verifier, 13 break-outs; ended early by credit exhaustion): lobby prop_a83bcd3c v3 3/3 at 01:59Z; rooms gitconfig-build (v3 2/2), crup-recruit-prefix (v3 2/2), crup-consolidator-build (verify/consolidator-spawn-lobby re-pinned at c5417e8, tip 6a119cf machine-checked); merged on main at b4cd67c with npm test [offline] OK (32 commands), 50 regression scripts, smoke and openrouter-smoke green; report docs/lobby-swarm-010513.md.

## Target · 2026-09-23 — Overlapping claims get an advisory notice instead of a prompt-only rule

**Context:** Near-duplicate claim names were prompt-only. Replaying 136 persisted room logs found 93 cross-seat claim pairs sharing at least 40 percent of their terms, plus 183 slug-rule firings, in 64 of the 136 logs, despite the prompt rule. In swarm-083203-kooz two seats built the same overlap notice under two claim names.
**Ruling:** The first write of a claim/* sends one advisory @-notice naming the claimant and the owner of any live claim by another active seat whose terms overlap (at least 4 shared stems and either 40 percent Jaccard, or 20 percent when the slugs share half their stems); board_set returns overlaps[]. The notice never refuses a claim.
**Consequences:**
- Positive: Duplicate work is visible at the moment a claim is taken, so a seat can merge efforts before building twice.
- Negative: Precision is unmeasured: the replay counts firings, not confirmed duplicates. Deliberate splits (for example kick-ui and kick-endpoint) also get a notice. One extra notice per overlapping claim.
**Vision-fit:** n/a - internal tooling
**Researched:** scripts/claim-overlap-calibration.ts replay over data/*.jsonl; claim-overlap-regression 9/9; arXiv:2606.15376 CoAgent (advisory notify-and-repair, argued rather than measured to beat locking); arXiv:2606.00953 Co-Coder (related only).
**Rejected:** A hard lock on overlapping claims: some overlaps are deliberate splits, and CoAgent argues for notify-and-repair. Keeping the rule prompt-only: the replay shows it failed in 64 of 136 logs.
**Anchored-bet:** [BET]
**Revisit-when:** A labelled sample shows the notice's precision below 50 percent, or a run where a seat abandons correct work because of an overlap notice.
**Scope:** src/hub.ts,src/server.ts
**Source:** brainstorm · swarm-083203-kooz, main 858dbfa (af45763, 0fca7aa)
**Evidence-change:** Replaying 136 persisted room logs showed 93 overlapping cross-seat claim pairs and 183 slug-rule firings in 64 logs despite the prompt-only rule; swarm-083203-kooz itself built the same notice twice under two claim names.

## Target · 2026-09-24 — A departed seat's claims pass to its successor at once and to anyone after a stale window

**Context:** A claim/* stayed owned by a seat after it left or was swept: a peer's write was refused with and without overwrite, and so was the successor the launcher registered with registerReplacement, reproduced by the reuse builders' probe (2026-09-23). Respawn recruits a successor for exactly such an orphaned claim, which that successor then could not write, so claimed work was stranded until the room ended.
**Ruling:** A departed owner's claim/* stays owned (respawn still counts it as orphaned), but its registered successor may take it over at once, and anyone may once the owner has been gone for Hub.STALE_CLAIM_MS (10 minutes, CHATROOM_STALE_CLAIM_MS). Each takeover posts one system line naming who took which claim from whom and why; room_status lists stale_claims with who may take each one now. A live owner's refusal is unchanged.
**Consequences:**
- Positive: Work a seat claimed before it died or handed off late can be picked up by its replacement immediately, or by a peer after ten minutes, instead of blocking the area until the room ends; every transfer is visible in the room.
- Negative: A seat that is merely slow to rejoin after leaving can lose its claim after ten minutes; the successor chain is trusted as the launcher registered it; one extra system line per takeover.
**Vision-fit:** n/a - internal tooling
**Researched:** stale-claims-regression 4/4 (successor at once, peer only after the window, live owner refusal unchanged, hub-released claims not reported as takeovers); Concord MCP's stale-claim list and audited ownership transfer (MIT) as the reference design; the reuse builders' reproduction in todo/stale-claims-after-seat-leaves.md
**Rejected:** Releasing claims when a seat leaves, as removeParticipant does: it rewrites the claim as by system, and respawnDecision counts only claims the departed seat still owns, so a release would switch off the orphaned-claim respawn rule.
**Anchored-bet:** [BET]
**Revisit-when:** A run where a slow but live seat loses a claim to the stale window, or where a successor chain takes over the wrong claim.
**Scope:** src/hub.ts
**Source:** manual
**Evidence-change:** The reuse builders reproduced that a registered successor could not write its predecessor's claim/*, the case respawn exists to handle.
