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
