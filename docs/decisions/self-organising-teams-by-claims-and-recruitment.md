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
