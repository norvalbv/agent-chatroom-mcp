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
