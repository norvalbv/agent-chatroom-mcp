# agent-chatroom-mcp

An MCP server that gives AI agents a **shared chatroom**: join, speak, wait for replies, leave, and, crucially, **converge on a conclusion that has been scrutinised**, through explicit proposals, mandatory challenges and quote-checked votes. Built so that agents on *different* models (Claude Code, OpenAI Codex, anything that speaks MCP) can sit in the same room, and so a human can watch and interject from a live dashboard.

```
                 ┌──────────────────────────────┐
  claude -p ───▶ │  agent-chatroom-mcp (one     │ ◀─── codex exec
                 │  process, Streamable HTTP)   │
  claude -p ───▶ │                              │ ◀─── any MCP client
                 │  Hub: rooms → seq-numbered   │
   curl/browser ▶│  log, waiters, proposals     │
                 └──────────────────────────────┘
```

## Quick start

```bash
npm install
npm run smoke          # end-to-end test: two MCP clients reach consensus (~3s)
npm run dev            # start the hub on http://127.0.0.1:7717/mcp

# have a Claude agent and a Codex agent decide something together:
scripts/debate.sh "Should this repo use tabs or spaces?"
```

Watch live: open **http://127.0.0.1:7717/ui** (every room, live transcript, a box to interject as yourself), or from a terminal:

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

Flags: `--agents N` (total, including the verifier; default 4), `--cwd` project directory, `--codex k` run k workers on Codex, `--apply`, `--timeout` minutes (default 30), `--port`. `CLAUDE_MODEL` / `CODEX_MODEL` env override the models.

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

- **Blind openings.** `submit_opening` holds each agent's first answer privately until everyone has submitted, then reveals them all at once, so the second agent cannot simply agree with the first.
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

**Debate protocols.** Du et al. (2023) have N agents answer independently, then show each other's answers for a couple of rounds and take a majority vote. Liang et al.'s MAD adds a judge that decides when to stop. ReConcile (Chen et al., 2023) uses a round table of *different* models with confidence-weighted votes and stops on consensus or a round cap. Model diversity is repeatedly found to be the ingredient that matters, which is the whole reason to put Claude and Codex in one room.

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

## Layout

```
src/hub.ts        shared state: rooms, log, long-poll, proposals, persistence
src/server.ts     MCP tools + resource, one instance per session
src/index.ts      HTTP entrypoint (/mcp + human endpoints)
src/ui.ts         the live dashboard served at /ui
src/swarm.ts      swarm orchestrator: plan -> sub-rooms -> leads room -> verifier
scripts/smoke.ts  end-to-end test of every mechanic (three MCP clients + a human)
scripts/watch.sh  terminal follower (watch-chat --latest)
scripts/debate.sh launch Claude + Codex into one flat room
prompts/          participant (flat debate), planner, worker, lead-tail, verifier
skills/swarm/     Claude Code skill that triggers swarm mode from plain English
```

Config: `PORT` (7717), `HOST` (127.0.0.1), `CHATROOM_DATA_DIR` (unset = in-memory).
