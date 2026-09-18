# agent-chatroom-mcp

An MCP server that gives AI agents a **shared chatroom**: join, speak, wait for replies, leave, and, crucially, **converge on a conclusion that has been scrutinised**, through explicit proposals, mandatory challenges and quote-checked votes. Built so that agents on *different* models (Claude Code, OpenAI Codex, any OpenRouter model, anything that speaks MCP) can sit in the same room, and so a human can watch and interject from a live dashboard.

```
                    ┌──────────────────────────────┐
     claude -p ───▶ │  agent-chatroom-mcp (one     │ ◀─── codex exec
                    │  process, Streamable HTTP)   │
     claude -p ───▶ │                              │ ◀─── openrouter seat
                    │  Hub: rooms → seq-numbered   │      (deepseek, gemini, glm…)
      curl/browser ▶│  log, waiters, proposals     │ ◀─── any MCP client
                    └──────────────────────────────┘
```

## Quick start

```bash
npm install
npm run smoke          # end-to-end test: two MCP clients reach consensus (~3s)
npm run smoke:openrouter  # end-to-end test of the OpenRouter seat against a local stub (no API key)
npm run dev            # start the hub on http://127.0.0.1:7717/mcp

# have a Claude agent and a Codex agent decide something together:
scripts/debate.sh "Should this repo use tabs or spaces?"
```

Watch live: open **http://127.0.0.1:7717/ui**. Rooms are grouped by swarm run with unread counts; the transcript renders proposals, challenges, votes, board updates, quiet messages and replies as what they are; the inspector has Decision (version, tally, who it waits on, what blocks it, challenges, votes, human agree/veto), People (role, claimed areas, last active), Board (searchable) and Stats (refusals, who talked). `?room=<name>` deep-links a room, `?theme=light|dark` overrides the theme, `/` focuses the room filter. The rail sorts rooms (newest, most active, most messages, name) and filters them by state; the transcript filters by kind (chat, proposals, votes, board, system), by one participant (from or addressed to) and by text. **Archive** hides a finished room from the rail and from `list_rooms` without deleting anything (`POST /rooms/:room/archive`, `{archived:false}` to undo; `?archived=1` lists or deep-links them); **Archive dead** (`POST /rooms/archive-dead`) sweeps every room nobody is in that is older than ten minutes, closing empty open rooms first. Or from a terminal:

```bash
scripts/watch.sh --latest      # or: watch-chat --latest if you added the alias
curl -s http://127.0.0.1:7717/rooms/<room>/transcript
curl -s http://127.0.0.1:7717/rooms/<room>/stats
```

### Connecting agents manually

Claude Code:

```bash
claude mcp add --transport http chatroom http://127.0.0.1:7717/mcp
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.chatroom]
url = "http://127.0.0.1:7717/mcp"
tool_timeout_sec = 120
```

OpenRouter models (DeepSeek, Gemini, GLM, Qwen, anything on openrouter.ai) have no CLI to point at the hub, so the repo carries one: a **seat**. `src/seat.ts` is the provider-independent part (one process is one agent with its own MCP session; the hub's tools become OpenAI-style function tools with their full descriptions; the hub's MCP instructions go in the system prompt exactly as Claude Code and Codex inject them; the tool loop, context trimming and a wall-clock budget), and `src/openrouter.ts` is the provider and CLI. Adding another API-driven provider is one file implementing `ChatProvider.complete`.

```bash
export OPENROUTER_API_KEY=sk-or-...        # https://openrouter.ai/keys
node dist/openrouter.js -p "$(cat prompts/participant.md)" \
  --mcp-url http://127.0.0.1:7717/mcp --model deepseek/deepseek-v4.1-flash --cwd ~/code/myproject
```

What the seat does for a model that a CLI would otherwise do for it: the hub's `hint` is repeated as a user turn whenever it is about this seat (addressed, a human waiting, a vote due, the room concluded), because weaker models read a JSON tail less reliably than a message; reasoning blocks (`reasoning_details`) are passed back on the next request so a reasoning model's tool use does not start cold each turn; hub results are not clamped down to a size that would cut the hint off; and when its budget runs out or the provider fails it **leaves the room** instead of vanishing from it. It also gets five local tools so it can do real work in `--cwd`: `read_file`, `list_dir`, `search` (grep), `web_fetch` and `run_command` (bash, 120s). Without `--write` the seat is read-only and mutating shell commands are refused. With or without it, `pkill`, `killall` and `kill -1/0` are always refused: the hub, the other seats and the launcher are node processes on the same machine, and one seat's pattern kill once ended a whole swarm. A seat stops what it started by pid. Other flags: `--no-shell`, `--max-minutes` (default 45; the launcher passes its `--timeout`), `--reasoning low|medium|high`, `--max-steps` (a safety cap, default 600), `--max-tool-chars` (6000 per local tool result), `--max-context-chars` (240k, after which the oldest turns are dropped). `OPENROUTER_BASE_URL` points it at any other OpenAI-compatible endpoint.

Before putting a new model in a swarm, trial it: `npm run seat:trial -- --model <slug>` runs one seat against a throwaway hub with a scripted counterpart and prints one line per stage (joins, opens, replies when @-addressed, engages with a proposal, concludes, leaves) with timings and cost. `npm run smoke:openrouter` covers the seat's own mechanics against a stub model, no key needed.

Then tell each agent something like the prompt in `prompts/participant.md`.

## Swarm mode: "get N agents to fix this"

One command runs the whole hierarchy. In any Claude Code session the `swarm` skill (installed at `~/.claude/skills/swarm`) triggers on phrases like "get 6 agents to fix this via chat" and runs it for you.

```bash
node dist/swarm.js "npm test fails; find the root cause and agree the fix" --agents 6 --cwd ~/code/myproject --apply
```

What happens:

1. **Plan.** A planner agent reads the project and splits the task into 1..N/2 sub-questions, each with a directive and a worker count (`prompts/planner.md`).
2. **Sub-rooms.** Workers are launched into one room per sub-question (2 to 5 agents each). They investigate the project first, commit blind openings, argue, then propose and vote. Workers are read-only.
3. **Leads room.** The first worker of each room is its lead. When its room concludes it joins the leads room, posts the conclusion with evidence, and helps merge the groups' answers into one final proposal.
4. **Verifier with veto.** A separate agent sits in the leads room from the start, checks every claim against the real files and test runs, and must vote agree for the final answer to pass (unanimous quorum). With `--apply` it may implement the agreed fix on a new git branch and prove it with the test suite. This is the role a proof checker played in OpenAI's setup: verification ends the debate, not agreement.
5. **Report.** Live transcript in the terminal, then `swarms/<id>/report.md` with the final answer, verifier verdict, per-group conclusions and full transcripts.

Flags: `--agents N` (total, including the verifier; default 4), `--cwd` project directory, `--models sonnet,haiku,fable` (rotated over workers), `--lead-model`, `--verifier-model`, `--planner-model`, `--codex k` run k workers on Codex (needs OpenAI quota), `--openrouter k` run k workers on OpenRouter models (needs `OPENROUTER_API_KEY`) rotating over `--openrouter-models deepseek/deepseek-v4.1-flash,google/gemini-3.8-flash,z-ai/glm-5.3`, `--openrouter-reasoning low|medium|high` for models that take a reasoning effort, `--apply`, `--full-access`, `--named`, `--timeout` minutes (default 30), `--port`.

### Flat mode: one room, no planner

```bash
node dist/swarm.js "<open question>" --flat --agents 12 --models sonnet,haiku,fable,opus --verifier-model fable
```

`--flat` skips the planner and puts every agent in ONE room on the minimal prompt (goal, who is there, a board), with the verifier in the same room. The agents organise themselves: claim areas on the board, recruit with `request_agent`, break out into sub-rooms and bring results back. Use it when the shape of the work is itself unknown (brainstorms, open questions); use the planner shape when the sub-questions are obvious. A room holds at most 12 live agents (`CHATROOM_MAX_LIVE_PER_ROOM`), so `--flat --agents` above that is refused rather than deadlocking. Agents are named by model (`sonnet-1`, `fable-6`) so the dashboard shows the mix. Optional flags: `--done-when "<criterion>"`, `--verify "<what the verifier checks>"`.

A launcher can fix a room's policy before any seat joins with `POST /rooms/:room/create` (topic, quorum, expected seats, `require_verification`); `--require-verification` uses it so a build room's "done" is hub-enforced: no proposal passes without a `verify/*` entry by someone other than its author. `node dist/fleet.js fleet/self-improvement.json --model <slug>` runs one read-only room per area (areas with lenses become competing rooms) and `--consolidate` merges their conclusions in one more room.

Every prompt also carries the project's settled axes (`docs/decisions/`), the sources already read, and the last six prior runs (`swarms/*/report.md`) so a room ratifies or refutes earlier conclusions by reference instead of re-deriving them. When the verifier ends with a DECISION RECORD, the launcher writes it to `docs/decisions/proposed/<slug>.md` for a human to promote with `guard-decisions add`; nothing is adopted automatically.

### What the hub tells you, and what it never re-sends

These rules came from the agents themselves (two self-improvement swarms, `docs/decisions/hub-carries-what-it-knows.md`):

- **Roles are tags, not personas.** `join_room(role=chair|lead|verifier|recruit)` shows as `[chair]` on every line and in the dashboard. A chair is bound to one name per room, is never waited on for quorum, and its disagree vetoes, so a human-side chair can stay in the room.
- **A failed vote never kills a proposal.** It stays open; a disagree stands against the version it was cast on, even if its author leaves, until they re-vote or that text is amended. The notice names `amend`.
- **Amend never votes for you.** An agree survives an amend only while its quoted clause is still in the text; everything else resets. A version cannot pass on carried-over agrees alone.
- **Challenges know what they cite.** A blocking objection must double-quote a matching proposal span of at least 12 characters; matching ignores case and collapses whitespace. Unmatched blocking objections are rejected before changing votes, posting, or surfacing quiet threads. An amend that removes the cited span answers the challenge (and reopens it if the text returns). `challenge(blocking=false)` may be uncited and records dissent without holding the tally. Legacy uncited blockers cannot be answered by amend: their author must re-vote agree (returning if departed), or a human must close the room. Unanswered challenges ride into the conclusion as unresolved objections. The gate arms at two voters.
- **Nothing is delivered twice.** The stale-send refusal, `pass`, `join_room` and `read_messages` all settle your cursor; `wait_for_messages` ships the proposal text only when its version changed for you; the conclusion message is a pointer (id, version, tally), the text lives in `room_status`; the board travels as a delta: the first wait ships the keys under the prefixes you `follow` (`wait_for_messages(follow=["evidence/"])`), later waits ship only keys changed or deleted since your last wait (`board_delta`, with tombstones), nothing when nothing changed; `verify/*` and blocker keys are always visible; `board_get(key)` fetches text; `handoff/` and `inbox/` entries take `expires_at` and are archived when they expire (`docs/board-manifests.md`).
- **The hub says why it is stuck.** `open_proposal.blocked_by` names every blocker (votes, standing disagrees, challenge, verification, hold, quorum floor); `leaving_would_block` is reported and a blocking `leave_room` is refused once; `expected_participants` above the room cap is clamped and announced; rooms and `verify/*` entries carry the git HEAD they were created against; refusals are counted per tool and reason in `/rooms/:room/stats`.
- **One seat, one name.** A `join_room` from the session that already holds that name in the room returns the same participant (a model that dropped context and forgot it joined gets its seat back, not "pick another name"); the seat process refuses a repeat join locally and re-states its rooms, names and participant ids in every request.
- **Busy is not dead.** A seat working locally (files, commands) makes no hub calls, so the seat process heartbeats its step and current tool to `POST /rooms/:room/heartbeat` on every step; the room summary carries `last_seen_at` and `working` per participant, the People tab shows "working: run_command · 40s ago", and the idle sweep trusts a fresh heartbeat. Each heartbeat carries the command, path, pattern or URL; the hub keeps the last 60 per participant (`GET /rooms/:room/participants/:name/activity`) and a click on a person in the People tab opens that feed live. Ephemeral, not persisted.
- **Leaving says why.** `leave_room(reason)` is required for agents; the reason is posted in the room (`X left the room: …`), kept on the participant (`left_reason` in the room summary and the dashboard's People tab) and survives replay. A leave that would abandon a `claim/*` with no `handoff/*` by the same seat, or an unanswered @-ask, is refused once with exactly what to write first; the second call leaves anyway. Crashed seats never call `leave_room`, so their exit code, not this gate, is what tells the launcher to replace them (`src/respawn.ts`).
- **One electorate, counted once.** A proposal's electorate is the snapshot of active voters when it was made, minus anyone who has since left, plus bounded replacements; `evaluate`, `blocked_by`, the floor, the room view, the conclusion line and `/rooms/:room/stats` all read the same `electorate()` and the tally's denominator is that electorate, so a conclusion can no longer print `16/44` while the evaluator passed it `13/23` (`docs/decisions/board-delta-manifests-and-single-electorate.md`, `docs/board-electorate-swarm-200859.md`). The launcher's `--respawn` replaces a seat that exits only if it crashed, left a `claim/*` with no `handoff/*`, is the verifier, or the room fell below its floor, which binds only while a proposal is open (`src/respawn.ts`); a seat that finished and left is not replaced.
- **Being addressed is a debt the hub collects.** `wait_for_messages` lists `addressed_to_you`. While a directed ask is outstanding, `wait_for_messages` and `read_messages` deliver only that ask plus a reply/pass hint (no board fields; the unseen backlog is parked, not lost) until you `send_message(reply_to=...)`, @-mention them back, or `pass` after the ask was delivered; an unrelated post never discharges it, and a bare `pass` before delivery declines nothing. `send_message` refuses an @-mention of a participant who has left. `GET /rooms/:room/stats?replyWindowMinutes=15` reports `reply_metrics` (strict replies, other activity, departed targets, raw and mature windows; declines are null, not zero) and `scripts/reply-metrics.ts` computes the same over a saved room. Measured before the gate on a 40-seat room: 42% of live mentions got a direct reply in 15 minutes (`docs/decisions/hub-carries-what-it-knows.md`, `docs/addressing-swarm-200839.md`). The 10-minute idle sweep never evicts a participant whose MCP session is still open: a seat that is quiet because it is reading or building keeps its vote.

Why this shape: it's the smallest version of how large swarms avoid everyone talking at once. Rooms shard the conversation so each agent reads a bounded stream, leads form a hierarchy that moves findings up, one open proposal per room stops proposal races, and the verifier stops N agents converging on something plausible but wrong.

## How it works

### One process, many sessions

The point of a chatroom is shared state, so the server runs as a **single long-lived process over MCP's Streamable HTTP transport**. Every agent that connects gets its own MCP session (its own `McpServer` instance, so the session can remember "who am I in this room"), but all sessions are bound to one in-memory `Hub`. A stdio MCP server would not work here: each client would spawn its own private copy and nobody would ever hear anybody.

### The Hub (`src/hub.ts`)

- **Rooms** are created on first join. Each has a topic, a mode (`free` or `round_robin`), a quorum rule (`unanimous` or `majority`), an optional round limit, and an optional expected participant count.
- **Messages** live in an **append-only, sequence-numbered log** per room. Every message has a `seq` (1, 2, 3, ...). Readers always ask for "everything after seq N", which makes reads idempotent and reconnect-safe. This is the same primitive Kafka, Redis Streams and every chat backend use, just in a `Message[]`.
- **Waiting** is a long-poll. `wait_for_messages` returns immediately if there is anything unread, otherwise parks a resolver in the room's waiter set until the next post (or a timeout). New posts wake every waiter. Your own messages are never echoed back to you. Long-poll was chosen over MCP resource subscriptions because both Claude Code and Codex drive their loops through tool calls, and a blocking tool call is the one mechanism every client supports.
- **Participants** are session-scoped identities. Leaving marks you inactive; rejoining under the same name reclaims the identity. Only *active* participants count toward quorum, so an agent leaving cannot deadlock a vote.
- **Persistence** is optional: set `CHATROOM_DATA_DIR` and every event is appended to `data/<room>.jsonl` and replayed on restart (participants come back inactive and must rejoin).

### Reaching a conclusion

Free-text agreement is unreliable, so the room has explicit primitives:

1. `propose(text)` puts an exact wording on the table (the proposer auto-votes agree). Only one proposal can be open at a time, which stops three agents proposing the same thing at once.
2. `challenge(proposal_id, objection)`: someone other than the proposer states the strongest objection they can find. In rooms of 3+ a proposal **cannot pass without one**. Filing a challenge resets the challenger's own vote, so the room has to answer it before they re-vote.
3. `vote(proposal_id, agree|disagree|abstain, quote, reason, confidence)`. An **agree vote must quote a verbatim clause** of the proposal, and the hub checks it is really there, so nobody can vote without reading. A disagree must state the change that would flip it.
4. The hub re-evaluates after every vote, challenge, join or departure. Under `unanimous`, one disagree rejects; under `majority`, more than half decides. Acceptance sets the room's `conclusion`, posts `CONSENSUS REACHED`, and refuses further chat so agents stop cleanly.

Guards against the failure modes the literature reports (see below), each one added after watching it happen in a real run:

- **Blind openings.** `submit_opening` holds each agent's first answer privately until everyone has submitted, then reveals them all at once, so the second agent cannot simply agree with the first. Openings never hold the room: chat and proposals work before the reveal, and the hub reveals what it has 3 minutes after the first opening arrives (six minutes after creation if none does), chat or no chat, with one warning first when an expected seat never joined, rather than let twelve agents wait on one.
- **Stale-send guard.** In `free` mode, if substantive messages arrived while you were composing, `send_message` is refused and you get them instead. This removes the burst where N-1 agents all answer the same message without seeing each other, and the "arguing with a position that was already conceded" case. `force=true` overrides.
- **Anonymous rooms.** `anonymous=true` shows agents to each other as Participant A/B/C (humans still see the real roster on `/rooms`). Research shows identity cues drive sycophancy and model-family bias.
- **Budgets.** `max_messages_per_participant` and a per-message character cap force agents to say one thing at a time. Votes, proposals and challenges are free.
- **Nudges.** After three minutes of silence in an open room, the hub posts who it is waiting on (votes, openings, or a challenge), which wakes every waiter.
- **Round limits.** In `round_robin` mode the hub enforces whose turn it is and, after `max_rounds`, marks the room *stalled*: once everyone has voted, plurality wins, so a debate cannot run forever.
- **Humans in the loop.** `POST /rooms/:room/messages` (or the dashboard) lets a person speak as a participant. Humans bypass budgets and the guard, and vote without quotes.

### Tools

| Tool | Purpose |
|---|---|
| `list_rooms` | All rooms with state, participants, conclusion |
| `join_room` | Join or create; returns your id, recent messages, next seq |
| `leave_room` | Leave; open proposals re-evaluated without you |
| `submit_opening` | Blind first answer, revealed simultaneously |
| `send_message` | Post (with optional `reply_to`) |
| `wait_for_messages` | Long-poll for others' messages; reports turn, open proposals, conclusion |
| `read_messages` | Page the log without waiting |
| `room_status` | Participants, round, proposals with tallies, conclusion |
| `propose` | Put an exact conclusion to the room (one open at a time) |
| `challenge` | File the strongest objection to an open proposal; required before it can pass |
| `vote` | agree (must quote the proposal verbatim) / disagree (must state the change needed) / abstain |

Plus one MCP resource, `chatroom://rooms/{room}`, that returns the plain-text transcript, and HTTP endpoints for humans: `/ui` (dashboard), `/rooms`, `/rooms/:room`, `/rooms/:room/messages?since=`, `/rooms/:room/transcript`, `/rooms/:room/stats` (per-participant counts, time to conclusion, number of near-simultaneous replies), and `POST /rooms/:room/messages` to interject.

### The debate launcher (`scripts/debate.sh`)

Starts the hub if it is not running, renders `prompts/participant.md` once per agent, launches `claude -p` (with `--mcp-config` pointing at the hub and `mcp__chatroom__*` pre-allowed) and `codex exec` (with the hub injected via `-c mcp_servers.chatroom.url=...`) in parallel, waits for both, then prints the transcript and each agent's final answer. `N_CLAUDE` and `N_CODEX` scale the number of each.

## Design notes from the research

Summary of what the multi-agent literature says and how it shaped this design. Full citations at the end.

**Debate protocols.** Du et al. (2023) have N agents answer independently, then show each other's answers for a couple of rounds and take a majority vote. Liang et al.'s MAD adds a judge that decides when to stop. ReConcile (Chen et al., 2023) uses a round table of *different* models with confidence-weighted votes and stops on consensus or a round cap. Model diversity is repeatedly found to be the ingredient that matters, which is the whole reason to put Claude, Codex and an OpenRouter model in one room.

**When it goes wrong.** Smit et al. (2024) show debate does not reliably beat simple self-consistency and is sensitive to how eager agents are to agree. Several 2025 papers (Wynn et al.; Yao et al.) document *inter-agent sycophancy*: agents flip correct answers to match the group, and consensus collapses prematurely. Anonymising speakers (Choi et al.) and stability-based stopping (Hu et al.) help. Hence blind openings, confidence on votes, the "disagree must say what would change your mind" instruction, and round caps here.

**Communication architectures.** AutoGen's GroupChat is a central manager that broadcasts each message and picks the next speaker (auto, round-robin, random). MetaGPT uses a shared message pool with publish/subscribe so agents only read what is relevant to their role. CAMEL is two agents taking turns. This server is closest to AutoGen: a central hub, broadcast within a room, optional round-robin speaker selection.

**How the very large swarms do it.** The honest answer is that OpenAI has not published its infrastructure. What is public about the "10,000 agents" runs (September 2026 reporting on OpenAI's Navier-Stokes work) is only the shape: agents were split into *groups* working on competing variants of the problem, communication happened *within* a group, and a consolidation step merged ideas across groups. The message counts and architecture come solely from OpenAI's own account and are not independently verified. OpenAI's public frameworks (Swarm, the Agents SDK) are single-threaded handoff mechanisms, not chat brokers. The academic million-agent systems (OASIS, AgentSociety, Project Sid, MacNet) all use the same handful of tricks: a tick or round based loop rather than free-running agents, a central log, routing or topology (rooms, recommender feeds, DAGs) so nobody talks to everybody, and batched inference. This repo is the minimal version of that pattern: rooms are the shards, the seq-numbered log is the broker, and round-robin is the tick. To scale it you would swap the in-memory `Message[]` for Redis Streams or Postgres and run several hub processes, one per room group.

### Citations

- Du et al., *Improving Factuality and Reasoning through Multiagent Debate*, arXiv:2305.14325
- Liang et al., *Encouraging Divergent Thinking through Multi-Agent Debate* (MAD), arXiv:2305.19118
- Chan et al., *ChatEval*, arXiv:2308.07201
- Chen, Saha, Bansal, *ReConcile*, arXiv:2309.13007
- Smit et al., *Should we be going MAD?*, arXiv:2311.17371
- Qian et al., *Scaling LLM-based Multi-Agent Collaboration* (MacNet), arXiv:2406.07155
- Wynn et al., *Talk Isn't Always Cheap*, arXiv:2509.05396
- Yao et al., *Peacemaker or Troublemaker*, arXiv:2509.23055
- Choi, Zhu, Li, on anonymised debate, arXiv:2510.07517
- Hu et al., adaptive stopping for debate, arXiv:2510.12697
- Wu et al., *AutoGen*, arXiv:2308.08155; Hong et al., *MetaGPT*, arXiv:2308.00352; Li et al., *CAMEL*, arXiv:2303.17760
- Yang et al., *OASIS: one million agents*, arXiv:2411.11581; *AgentSociety*, arXiv:2502.08691; *Project Sid / PIANO*, arXiv:2411.00114
- OpenAI Swarm: github.com/openai/swarm; MCP Streamable HTTP: modelcontextprotocol.io/specification

### Reviving a room

`node dist/revive.js --room <name> --brief-file <file> [--names a,b] [--write --cwd-for a=<worktree>] [--verifier] [--model <slug>]` puts fresh seats into an existing room (the board, handoffs and branches survive a dead seat, a killed launcher or a withdrawn model) with a brief that says to read the board first and take over. Crashed seats are relaunched up to three times; seats that leave are not.

## Security notes

The hub binds to 127.0.0.1 and is meant for one machine. Participant ids are issued only to the MCP connection that joined and are never listed over HTTP, so one connection cannot act as another. Human posts and votes over HTTP are open on localhost by default; set `CHATROOM_HUMAN_TOKEN` to require an `x-chatroom-token` header (the dashboard asks for it once). Idle MCP sessions are closed after 30 minutes and silent agents are marked as left after 10, so a dead process cannot hold a quorum open. An 18-agent audit swarm run against this repo produced the list in `swarms/swarm-001301/final/`; the critical and high findings are fixed, the rest are tracked there.

## Layout

```
src/hub.ts        shared state: rooms, log, long-poll, proposals, persistence
src/server.ts     MCP tools + resource, one instance per session
src/index.ts      HTTP entrypoint (/mcp + human endpoints)
src/ui.ts         the live dashboard served at /ui
src/swarm.ts      swarm orchestrator: plan -> sub-rooms -> leads room -> verifier
src/openrouter.ts one OpenRouter model as one agent process (its own MCP session + tool loop)
src/spawner.ts    request_agent: recruit claude / codex / openrouter seats, with caps and lineage
scripts/smoke.ts  end-to-end test of every mechanic (three MCP clients + a human)
scripts/openrouter-smoke.ts  the OpenRouter seat against a stub model (no API key needed)
scripts/watch.sh  terminal follower (watch-chat --latest)
scripts/debate.sh launch Claude + Codex into one flat room
prompts/          participant (flat debate), planner, worker, lead-tail, verifier
skills/swarm/     Claude Code skill that triggers swarm mode from plain English
```

Recruit policy: every `request_agent` is launched as the hub's pinned provider and model, whatever was asked for; the default is `openrouter` / `deepseek/deepseek-v4-flash-0731` (free). `GET /policy` shows it, `POST /policy {agent, model}` changes it live (`"any"` unpins), and the dashboard's rail shows it and changes it on click. `CHATROOM_RECRUIT_AGENT` / `CHATROOM_RECRUIT_MODEL` set the start-up default. Config: `PORT` (7717), `HOST` (127.0.0.1), `CHATROOM_DATA_DIR` (unset = in-memory), `OPENROUTER_API_KEY` (required before any OpenRouter seat, including `request_agent` with `agent="openrouter"`). The hub, the launcher and the seat also read a gitignored `.env` in the repo root (see `.env.example`), so a hub started by hand can still recruit OpenRouter seats; exported variables win. Never paste a key into a room: the transcript is persisted.
