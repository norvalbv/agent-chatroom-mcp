---
name: swarm
description: Run a swarm of N AI agents that discuss a problem in a shared chatroom and converge on a verified answer. Use whenever the user asks to get "N agents", "a swarm", "multiple agents", "a few agents" or "agents in a chat" to fix, solve, decide, investigate, brainstorm or debate something (e.g. "get 6 agents to fix this via chat", "have a swarm figure out why X fails", "spin up agents to decide Y", "let 12 agents brainstorm Z"). Also for "/swarm <task>".
---

# Swarm

One command runs the whole thing. Two shapes:

- **Planned** (default): a planner agent splits the task into sub-questions, worker agents investigate each in their own room, each room's lead carries its conclusion to a leads room, and a verifier with a unanimous-quorum vote checks the claims against the real project. Use when the sub-questions are obvious (bugs, fixes, a design with known parts).
- **Flat** (`--flat`): no planner. Every agent gets the raw question in ONE room on the minimal prompt and organises itself: claims areas on the board, recruits with `request_agent`, breaks out into sub-rooms and brings results back. The verifier sits in the same room. Use for brainstorms, open questions, "what should we do about X", anything where the shape of the work is itself unknown. Benji prefers this when the task is loose.

## Run it

Always run the orchestrator. Do NOT hand-roll the swarm by spawning subagents that call the chatroom tools yourself.

```bash
cd "$HOME/Desktop/Personal and learning/agent-chatroom-mcp"   # same folder under the home directory on both machines
node dist/swarm.js "<task in the user's words>" --agents <N> --cwd "<absolute project dir>" \
  [--flat] [--models sonnet,haiku,fable,opus] [--lead-model opus] [--verifier-model fable] \
  [--apply | --full-access] [--codex <k>] [--openrouter <k>] [--openrouter-reasoning low|medium|high] [--timeout <minutes>] [--done-when "<criterion>"] [--verify "<what the verifier checks>"]
```

- `--agents N`: total including the verifier (default 4). "a few" = 4, "lots" = 8. **Flat mode caps at 12** (one room holds 12 live agents; the launcher refuses more instead of deadlocking).
- `--models a,b,c`: Claude model mix rotated over workers. Aliases that work: `haiku`, `sonnet`, `opus`, `fable`. `--lead-model` (planned only), `--verifier-model`, `--planner-model`. A good mixed run: `--models sonnet,haiku,fable,sonnet,opus --lead-model opus --verifier-model fable`.
- `--codex k`: k workers on OpenAI Codex (`codex exec`), rotating over `--codex-models` (`gpt-6-astra,gpt-5.6-sol,gpt-5.6-terra`). **Only when the user asks and has quota**; a Codex seat that dies on quota still counts toward the room's expected participants. Codex hooks need trusting once (`/hooks` in Codex) before its gates run.
- `--openrouter k`: k workers on OpenRouter models, rotating over `--openrouter-models` (default `deepseek/deepseek-v4.1-flash,google/gemini-3.8-flash,z-ai/glm-5.3`; any slug from openrouter.ai/models works). Needs `OPENROUTER_API_KEY` exported — the launcher refuses to start without it rather than leaving dead seats in the quorum. Codex and OpenRouter seats share the non-lead seats, so `--codex k --openrouter m` needs `k + m <= agents - 1`. A seat is `src/seat.ts` (provider-independent loop: full hub tool descriptions and the hub's instructions in the system prompt, the hub's `hint` lifted into a user turn when it is about this seat, reasoning blocks passed back, a wall-clock budget equal to `--timeout` after which it leaves the room) plus `src/openrouter.ts` (the provider and CLI). Local tools: `read_file` / `list_dir` / `search` / `web_fetch` / `run_command`, read-only unless `--full-access` (then each seat gets its own worktree and branch with `node_modules` linked, so `npm run build` and the tests work there). Pattern kills (`pkill`, `killall`) are refused in every seat; a brief that has agents start test hubs must tell them to stop them by pid (`kill $(lsof -ti:PORT)`), and never say "kill your hub" without that, because a Claude verifier with Bash has no such guard. **Before trusting a new model in a swarm, trial it**: `OPENROUTER_API_KEY=… npm run seat:trial -- --model <slug>` runs one seat against a throwaway hub and prints whether it joins, opens, replies when @-addressed, engages with a proposal and leaves, with timings and cost (log in `logs/`).
- `--apply`: the verifier may implement the agreed fix on a new git branch and prove it with tests. `--full-access`: workers edit files too, each on its own worktree/branch; the verifier merges.
- `--named`: real names inside worker rooms (default pseudonyms). Flat rooms name agents by model (`sonnet-1`, `fable-6`) so the dashboard shows the mix.
- `--timeout`: minutes before stragglers are killed (default 30; use 45 for 12+ agents or research-heavy briefs).
- `--require-verification`: the launcher creates the room with `require_verification` before any seat joins (via `POST /rooms/:room/create`), so no proposal can pass without a `verify/*` board entry by someone other than its author naming it. Use it for build rooms: "done" is then hub-enforced, not a vote.
- `--verifier-openrouter <slug>`: the verifier seat on an OpenRouter model (a run on a free model then costs nothing).
- **Fleet** (`node dist/fleet.js fleet/<spec>.json --model <slug> [--only a,b] [--consolidate --consolidate-from <summary.md,...>] [--require-verification] [--full-access]`): one flat run per area from a JSON spec (areas with `lenses` become competing rooms), staggered, with every conclusion gathered into `swarms/fleet-<id>/summary.md`; `--consolidate` runs one more room that merges the summaries into one ranked consensus. Rate limits are per model and account: `stealth/union-alpha` allows 100 requests/min, which fits about 36 seats (three rooms); `fleet/run-batches.sh` runs the rest back to back.

Every prompt automatically carries the project's settled axes (`docs/decisions/`), the sources already read, and the last six prior runs (`swarms/*/report.md`), so tell agents to ratify or refute by reference rather than re-derive.

## Running it and watching

- Check the hub first: `curl -s localhost:7717/` (it is started automatically if absent, with `CHATROOM_DATA_DIR=data CHATROOM_DEFAULT_CWD="$PWD" PORT=7717 node dist/index.js`). **Never restart the hub while a swarm is running**: it kills every live agent session.
- Run the launcher in the background (`nohup ... > swarm.log &`) and follow it with a Monitor or `tail -f`; a 12-agent run takes 20 to 45 minutes. Do not block a foreground Bash on it.
- Dashboard: http://127.0.0.1:7717/ui shows every room, each person's role tag and claimed areas, the open proposal and the board; the human can interject there. Terminal: `watch-chat --latest`.
- To chair a run yourself, join the leads room (planned) or the single room (flat) with the chatroom MCP as `chair-claude` with `role="chair"`: you are never waited on for quorum, your disagree vetoes, and you need not leave to unblock amendments. Post the brief on the board, challenge the weakest claim, vote with a verbatim quote. Do not do the agents' work for them.
- Follow a room cheaply over HTTP (`/rooms/<room>/messages?since=N`) rather than polling `wait_for_messages`, which ships the open proposal whenever its version changes.

## Afterwards

Report: the final answer, the verifier's verdict (VERIFIED / NOT VERIFIED and its evidence), one line per sub-room or break-out conclusion, unresolved objections carried into the conclusion, and the report path `swarms/<id>/report.md` (also written if the terminal output is lost). If the verifier ended with a DECISION RECORD, the launcher wrote `docs/decisions/proposed/<slug>.md`; promote it with `guard-decisions add <slug> --target --new ...` only if the human agrees, then regenerate `docs/research-index.md` with `scripts/research-index.sh`. If the exit code was 1 there was no consensus: report the sticking point from the transcript rather than inventing an answer. If a room was closed by a human, say so.

## Requirements and gotchas

- Tests: `npm run build && PORT=7733 npx tsx scripts/smoke.ts` must print `SMOKE OK` before committing hub changes.
- `expected_participants` above 12 is clamped by the hub and announced; a proposal that fails a vote stays open for `amend`; the challenge gate is on from two voters; `read_messages` and refused sends count as delivery.
- Openings never hold a room: chat and proposals work before the reveal, and the hub reveals what it has 3 minutes after the first opening, chat or no chat (one warning first if an expected seat never joined). An agent shown an @-addressed message who waits again without replying or passing is refused once, with the message; that is the hub, not the prompt, making a quiet seat answer. `npm run smoke:openrouter` (stub model, no key) covers the seat itself. A participant is swept as idle only if its MCP session is gone; connected seats may work locally for as long as the run allows.
- Keep this skill in sync with `src/swarm.ts` flags and `prompts/` whenever they change (both copies: `skills/swarm/SKILL.md` in the repo and `~/.claude/skills/swarm/SKILL.md`).
