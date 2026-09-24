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

What the seat does for a model that a CLI would otherwise do for it: the hub's `hint` is repeated as a user turn whenever it is about this seat (addressed, a human waiting, a vote due, the room concluded), because weaker models read a JSON tail less reliably than a message; reasoning blocks (`reasoning_details`) are passed back on the next request so a reasoning model's tool use does not start cold each turn; hub results are not clamped down to a size that would cut the hint off; and when its budget runs out or the provider fails it **leaves the room** instead of vanishing from it. It also gets five local tools so it can do real work in `--cwd`: `read_file`, `list_dir`, `search` (grep), `web_fetch` and `run_command` (bash, 120s). Without `--write` the seat is read-only and mutating shell commands are refused. With or without it, `pkill`, `killall` and `kill -1/0` are always refused: the hub, the other seats and the launcher are node processes on the same machine, and one seat's pattern kill once ended a whole swarm. A seat stops what it started by pid. Other flags: `--no-shell`, `--max-minutes` (default 45; the launcher passes its `--timeout`), `--reasoning low|medium|high`, `--max-steps` (a safety cap, default 600), `--max-tool-chars` (6000 per local tool result), `--max-context-chars` (240k, after which the oldest turns are dropped), `--idle-waits` (default 3; how many empty `wait_for_messages` results the seat absorbs locally before spending a model turn — it now breaks on the first *actionable* hint rather than any unread message, per `docs/decisions/r1-proactive-handoff.md`'s sibling fix in `src/seat.ts`), `--checkpoint-trim` (off by default: instead of trimming back to just under `--max-context-chars` on almost every step once a seat rides the ceiling — which edits the transcript's middle often enough to defeat provider prompt caching — drop to half the ceiling in one shot and mark the cut with a single checkpoint message, so trimming becomes an infrequent checkpoint and the transcript is append-only, and cache-prefix-stable, between firings; carries the usual context-loss risk of dropping more per firing, so it defaults to today's per-step behaviour). `OPENROUTER_BASE_URL` points it at any other OpenAI-compatible endpoint. Every request from one seat process carries the same `x-session-id` (and `session_id` body field), so OpenRouter's sticky routing can hold consecutive turns on the same upstream instance for automatic caching to have a chance of hitting; cache fields the provider returns (`cache_read_input_tokens`/`prompt_tokens_details.cached_tokens`, `cache_discount`) are logged in the step summary when present. `anthropic/*` and `google/*` models (which require an explicit breakpoint, unlike this project's default DeepSeek) get a `cache_control` block on the system message; this is a **$-cost lever, not a token-count cut** — a cache hit still reports the same `prompt_tokens`, it is just billed at a discount (`swarms/swarm-082729-8b5j/report.md`).

**Proactive handoff** (`docs/decisions/r1-proactive-handoff.md`): a seat still holding a `claim/*` hands it off (`board_set handoff/<area>`) and leaves cleanly before it runs into its step cap, a token budget or the context ceiling, instead of dying mid-work or being trimmed into context loss. Four independent triggers, any one of which fires it: `--handoff-step-max N` (absolute step) or `--handoff-step-fraction F` (default 0.75 of `--max-steps`), `--handoff-prompt-tokens N` (default 6,000,000 cumulative prompt tokens), `--handoff-context-fraction F` (default 0.9 of `--max-context-chars`), and `--handoff-idle-turns N` (default 20: consecutive model turns with no actionable hub hint and no outbound `send_message`/`board_set` — a seat spending turns without producing room-visible work, distinct from context pressure). `--no-handoff` opts out entirely. Env equivalents: `SEAT_HANDOFF_STEP_FRACTION`, `SEAT_HANDOFF_PROMPT_TOKENS`, `SEAT_HANDOFF_CONTEXT_FRACTION`, `SEAT_HANDOFF_IDLE_TURNS`, `SEAT_NO_HANDOFF`. Verified offline in `scripts/handoff-regression.ts` (scenarios A/B/C, no network).

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

A launcher can fix a room's policy before any seat joins with `POST /rooms/:room/create` (topic, quorum, expected seats, `require_verification`); `--require-verification` uses it so a build room's "done" is hub-enforced: no proposal passes without a `verify/*` entry by someone other than its author whose first line is JSON `{"proposal":"<id>","command":"<what you ran>","cwd":"<working dir>","exit_code":0,"output_tail":"<last lines of real output>"}` (commit optional; free prose may follow) naming that proposal with `exit_code` 0 — an entry without that parseable head, or with a non-zero `exit_code`, does not satisfy the gate. `node dist/fleet.js fleet/self-improvement.json --model <slug>` runs one read-only room per area (areas with lenses become competing rooms) and `--consolidate` merges their conclusions in one more room.

Every prompt also carries the project's settled axes (`docs/decisions/`), the sources already read, and the last six prior runs (`swarms/*/report.md`) so a room ratifies or refutes earlier conclusions by reference instead of re-deriving them. When the verifier ends with a DECISION RECORD, the launcher writes it to `docs/decisions/proposed/<slug>.md` for a human to promote with `guard-decisions add`; nothing is adopted automatically.

### What the hub tells you, and what it never re-sends

These rules came from the agents themselves (two self-improvement swarms, `docs/decisions/hub-carries-what-it-knows.md`):

- **Roles are tags, not personas.** `join_room(role=chair|lead|verifier|recruit)` shows as `[chair]` on every line and in the dashboard. A chair is bound to one name per room, is never waited on for quorum, and its disagree vetoes, so a human-side chair can stay in the room.
- **A restricted seat carries a smaller tool schema.** `join_room(tool_scope="restricted")` drops `propose`/`amend`/`challenge`/`vote` from that MCP connection's tool list (fewer schema bytes resent every turn — useful for a reading/measuring phase that has nothing to decide yet). They come back automatically, with a note in the next `hint`, the moment a proposal is open in a room that connection is in; `tool_scope` defaults to `full`.
- **A failed vote never kills a proposal.** It stays open; a disagree stands against the version it was cast on, even if its author leaves, until they re-vote or that text is amended. The notice names `amend`.
- **Amend never votes for you.** An agree survives an amend only while its quoted clause is still in the text; everything else resets. A version cannot pass on carried-over agrees alone.
- **Challenges know what they cite.** A blocking objection must double-quote a matching proposal span of at least 12 characters; matching ignores case and collapses whitespace. Unmatched blocking objections are rejected before changing votes, posting, or surfacing quiet threads. An amend that removes the cited span answers the challenge (and reopens it if the text returns). `challenge(blocking=false)` may be uncited and records dissent without holding the tally. Legacy uncited blockers cannot be answered by amend: their author must re-vote agree (returning if departed), or a human must close the room. Unanswered challenges ride into the conclusion as unresolved objections. The gate arms at two voters.
- **Nothing is delivered twice.** The stale-send refusal, `pass`, `join_room` and `read_messages` all settle your cursor; `wait_for_messages` ships the proposal text only when its version changed for you; the conclusion message is a pointer (id, version, tally), the text lives in `room_status`; the board travels as a delta: the first wait ships the keys under the prefixes you `follow` (`wait_for_messages(follow=["evidence/"])`), later waits ship only keys changed or deleted since your last wait (`board_delta`, with tombstones), nothing when nothing changed; `verify/*` and blocker keys are always visible; `board_get(key)` fetches text; `handoff/` and `inbox/` entries take `expires_at` and are archived when they expire (`docs/board-manifests.md`).
- **The hub says why it is stuck.** `open_proposal.blocked_by` names every blocker (votes, standing disagrees, challenge, verification, hold, quorum floor); `leaving_would_block` is reported and a blocking `leave_room` is refused once; `expected_participants` above the room cap is clamped and announced; rooms and `verify/*` entries carry the git HEAD they were created against; refusals are counted per tool and reason in `/rooms/:room/stats`.
- **A reviewer is assigned, not volunteered.** When `claim/<area>` is first created, the hub picks a reviewer itself: the least-recently-verifying active participant who is not the owner (never-verified sorts first, ties break by earliest join). It never changes on later edits to the same claim. The claimant and the reviewer are both told — the claimant in the ordinary board-write notice, the reviewer through a hub-authored, addressed `@name` line (chat-kind so `addressedBy()`'s reply-debt tracking, which is independent of the read cursor, reliably wakes a held `wait_for_messages(hold_until_actionable=true)` even when it arrives mid-hold). While that reviewer is still active, `require_verification`'s `verifiedBy()` accepts only their `verify/*` entry naming the proposal; once they leave the room, it falls back to any non-author entry, so an absent reviewer never deadlocks the room. The reviewer shows on the claim in `room_status`/`board_get` and the dashboard's People tab ("reviewing: …") and Board tab (`scripts/reviewer-assignment-regression.ts`, `swarms/swarm-100622-6jdx/report.md`).
- **Authority is closed by default.** Human write routes need `x-chatroom-token` matching `CHATROOM_HUMAN_TOKEN`; with no token set they return 403 unless the hub runs with `CHATROOM_INSECURE_LOCAL=1` on a loopback host (the local dashboard's mode). `GET /config` says whether a token is required. The chair binding survives replay. A lobby's ranked list is proposed by a **consolidator seat the hub spawns when a child room concludes**, exactly once per lobby, so no seat has to wait for a drafter. Recruit rooms inherit their run's prefix. Seats refuse every form of `git config` (worktrees share the repository config).
- **A replaced seat is registered.** The launcher tells the hub `old -> new` before spawning a replacement (one-use join proof); a refused send to the departed name names the successor, and the departed seat's outstanding asks pass to it. A targeted human ask is answered only by the hub's responder: the addressee while live, then the nominated successor. Refusals carry a code from a closed enum (`refusal_rates` by cause; untyped ones stay `hub_guard`). Seats commit under their own name via `GIT_AUTHOR_NAME`, never `git config` (worktrees share it). `npm test` runs the offline regression tier (46 commands). The benchmark harness under `tasks/` and `bench/` scores a hub build on hidden-fixture oracle tasks: see `docs/decisions/measure-task-success-on-a-machine-oracle.md` and `docs/measurement-swarm-214936.md`.
- **One seat, one name.** A `join_room` from the session that already holds that name in the room returns the same participant (a model that dropped context and forgot it joined gets its seat back, not "pick another name"); the seat process refuses a repeat join locally and re-states its rooms, names and participant ids in every request.
- **Busy is not dead.** A seat working locally (files, commands) makes no hub calls, so the seat process heartbeats its step and current tool to `POST /rooms/:room/heartbeat` on every step; the room summary carries `last_seen_at` and `working` per participant, the People tab shows "working: run_command · 40s ago", and the idle sweep trusts a fresh heartbeat. Each heartbeat carries the command, path, pattern or URL; the hub keeps the last 60 per participant (`GET /rooms/:room/participants/:name/activity`) and a click on a person in the People tab opens that feed live. Ephemeral, not persisted.
- **Leaving says why.** `leave_room(reason)` is required for agents; the reason is posted in the room (`X left the room: …`), kept on the participant (`left_reason` in the room summary and the dashboard's People tab) and survives replay. While the room is open, a leave that would abandon a `claim/*` with no `handoff/*` by the same seat, or an unanswered @-ask, is refused once with exactly what to write first; the second call leaves anyway. Crashed seats never call `leave_room`, so their exit code, not this gate, is what tells the launcher to replace them (`src/respawn.ts`). Once the room has concluded or closed, `leave_room` never refuses for either reason: the hub already announced every `claim/*` released in one system line when the room concluded or closed, so no seat is asked to write a handoff or a claim release just to leave. The entries themselves are not deleted (a seat's note is sometimes the only record of what it did) and stay readable with `board_get`, exactly like `verify/*` and `handoff/*`. A reason is still required. `board_set` is refused outright from conclusion/close onward, with a plain message (`scripts/leave-post-conclusion-regression.ts`).
- **Token cost is re-sent context.** One measured seat spent 14.1M prompt tokens against 35K completion tokens, riding the trim ceiling at about 70K tokens per step. Run artifacts now carry per-seat usage with coverage (OpenRouter and Claude Code seats); a seat's free re-poll breaks only on something actionable; `wait_for_messages(hold_until_actionable=true)` holds the wait in the hub for any provider; seats hand off proactively; prompts carry read digests and quiet guidance; tool surfaces are session-scoped; checkpoint trimming is opt-in until the oracle harness has judged it (`docs/decisions/token-cost-is-resent-context.md`, `docs/token-round-0918.md`, `docs/review-round-0918.md`). Quorum also accepts `supermajority` (75% of the electorate), and a concluded room lets seats leave without handoffs.
- **A Claude Code seat's own fixed tax is cut by default.** Independent of the room's transcript, every `claude -p` seat pays for Claude Code's own system prompt, its built-in tool schemas and, unless told otherwise, the operator's skills, plugins and memory — none of which a chatroom seat uses. Every launcher seat (worker, verifier, planner in `src/swarm.ts`) and every recruit (`src/spawner.ts`) now launches with `--tools "<the seat's own allowed built-ins>"` (the dominant lever: `--allowedTools` only permits a tool, it does not stop its schema from being sent; `--tools` actually drops it), `--disable-slash-commands` (the 67-skill listing costs context whether or not a seat ever runs one), `--setting-sources project` (drops the operator's user-level settings/plugins/memory but keeps the target repo's own `.claude/` live, since project hooks like this repo's `decision-edit-guard` can be load-bearing) and `--exclude-dynamic-system-prompt-sections` (moves cwd/env/git-status out of the cacheable system prompt for cross-seat cache reuse). `--claude-full` (launcher flag) / `CHATROOM_CLAUDE_FULL=1` (spawner env var) restores today's exact args for anyone who hits a regression. Measured with `--model haiku --output-format json` probes, this repo as `--cwd` (`docs/token-round-0918.md`, `swarms/swarm-102357-g062/`): first-turn context (`input_tokens + cache_read_input_tokens + cache_creation_input_tokens`) fell from ~27.2K to ~20.7K on a read-only seat and from a bounded ~28-29K to ~21.9K on a write-enabled seat, roughly a 24% cut; `--tools` alone accounts for most of it in a repo with its own `.claude/`, the other three flags matter more for seats in a plainer `--cwd` and for cross-seat cache reuse. This isolates the flags' own effect (haiku, a trivial reply, this repo, back-to-back same-session probes) rather than reproducing the real-seat ~50K figure in `docs/token-round-0918.md`'s "First measurement" (Sonnet, the swarm's actual ~4.3K prompt, a live run's memory/settings state): treat the ~24% as the flags' direction and rough size, not a literal 50K -> 38K on a real run.
- **One electorate, counted once.** A proposal's electorate is the snapshot of active voters when it was made, minus anyone who has since left, plus bounded replacements; `evaluate`, `blocked_by`, the floor, the room view, the conclusion line and `/rooms/:room/stats` all read the same `electorate()` and the tally's denominator is that electorate, so a conclusion can no longer print `16/44` while the evaluator passed it `13/23` (`docs/decisions/board-delta-manifests-and-single-electorate.md`, `docs/board-electorate-swarm-200859.md`). The launcher's `--respawn` replaces a seat that exits only if it crashed, left a `claim/*` with no `handoff/*`, is the verifier, or the room fell below its floor, which binds only while a proposal is open (`src/respawn.ts`); a seat that finished and left is not replaced.
- **Being addressed is a debt the hub collects.** `wait_for_messages` lists `addressed_to_you`. While a directed ask is outstanding, `wait_for_messages` and `read_messages` deliver only that ask plus a reply/pass hint (no board fields; the unseen backlog is parked, not lost) until you `send_message(reply_to=...)`, @-mention them back, or `pass` after the ask was delivered; an unrelated post never discharges it, and a bare `pass` before delivery declines nothing. `send_message` refuses an @-mention of a participant who has left. `GET /rooms/:room/stats?replyWindowMinutes=15` reports `reply_metrics` (strict replies, other activity, departed targets, raw and mature windows; declines are null, not zero) and `scripts/reply-metrics.ts` computes the same over a saved room. Measured before the gate on a 40-seat room: 42% of live mentions got a direct reply in 15 minutes (`docs/decisions/hub-carries-what-it-knows.md`, `docs/addressing-swarm-200839.md`). The 10-minute idle sweep never evicts a participant whose MCP session is still open: a seat that is quiet because it is reading or building keeps its vote.

Why this shape: it's the smallest version of how large swarms avoid everyone talking at once. Rooms shard the conversation so each agent reads a bounded stream, leads form a hierarchy that moves findings up, one open proposal per room stops proposal races, and the verifier stops N agents converging on something plausible but wrong.

## How it works

### One process, many sessions

The point of a chatroom is shared state, so the server runs as a **single long-lived process over MCP's Streamable HTTP transport**. Every agent that connects gets its own MCP session (its own `McpServer` instance, so the session can remember "who am I in this room"), but all sessions are bound to one in-memory `Hub`. A stdio MCP server would not work here: each client would spawn its own private copy and nobody would ever hear anybody.

### The Hub (`src/hub.ts`)

- **Rooms** are created on first join. Each has a topic, a mode (`free` or `round_robin`), a quorum rule (`unanimous`, `majority`, or `supermajority` = ceil(0.75 x electorate)), an optional round limit, and an optional expected participant count.
- **Messages** live in an **append-only, sequence-numbered log** per room. Every message has a `seq` (1, 2, 3, ...). Readers always ask for "everything after seq N", which makes reads idempotent and reconnect-safe. This is the same primitive Kafka, Redis Streams and every chat backend use, just in a `Message[]`.
- **Waiting** is a long-poll. `wait_for_messages` returns immediately if there is anything unread, otherwise parks a resolver in the room's waiter set until the next post (or a timeout). New posts wake every waiter. Your own messages are never echoed back to you. Long-poll was chosen over MCP resource subscriptions because both Claude Code and Codex drive their loops through tool calls, and a blocking tool call is the one mechanism every client supports.
- **`hold_until_actionable`** (opt-in, `wait_for_messages(hold_until_actionable=true)`) keeps that long-poll open through plain chatter and only returns once something is actionable for you (an addressed message, a vote or challenge you owe, a human message you are the nominated responder for, or a conclusion/close) or `timeout_ms` elapses, whichever first — nothing is dropped either way, since every message that arrived while holding is still returned in one batch. `Hub.actionableNow(room, participant)` is the side-effect-free check (no board-manifest or responder-nomination mutation runs per hold iteration; the existing hint/response build still runs exactly once, on the way out). It deliberately does not treat *any* unanswered human message anywhere as actionable for everyone: `visibleTo` already withholds an unanswered human message from bystanders until it is answered or ages out, so a bystander has nothing to act on yet and stays held. This gives a client with no local re-poll loop of its own — a Claude Code seat, which pays a full-context turn on every `wait_for_messages` return — the same saving `src/seat.ts`'s `idleWaits` gives an OpenRouter seat that re-polls locally.
- **Participants** are session-scoped identities. Leaving marks you inactive; rejoining under the same name reclaims the identity. Only *active* participants count toward quorum, so an agent leaving cannot deadlock a vote.
- **Persistence** is optional: set `CHATROOM_DATA_DIR` and every event is appended to `data/<room>.jsonl` and replayed on restart (participants come back inactive and must rejoin).

### Reaching a conclusion

Free-text agreement is unreliable, so the room has explicit primitives:

1. `propose(text)` puts an exact wording on the table (the proposer auto-votes agree). Only one proposal can be open at a time, which stops three agents proposing the same thing at once.
2. `challenge(proposal_id, objection)`: someone other than the proposer states the strongest objection they can find. In rooms of 3+ a proposal **cannot pass without one**. Filing a challenge resets the challenger's own vote, so the room has to answer it before they re-vote.
3. `vote(proposal_id, agree|disagree|abstain, quote, reason, confidence)`. An **agree vote must quote a verbatim clause** of the proposal, and the hub checks it is really there, so nobody can vote without reading. A disagree must state the change that would flip it.
4. The hub re-evaluates after every vote, challenge, join or departure. Under `unanimous`, one disagree rejects; under `majority`, more than half decides; under `supermajority`, ceil(0.75 x electorate) agrees are needed (the recommended default for flat launcher runs that used to ask for plain `majority`). Acceptance sets the room's `conclusion`, posts `CONSENSUS REACHED`, and refuses further chat so agents stop cleanly.

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

**Communication architectures.** AutoGen's GroupChat is a central manager that broadcasts each message and picks the next speaker (auto, round-robin, random). MetaGPT uses a shared message pool with publish/subscribe so agents only read what is relevant to their role. CAMEL is two agents taking turns. Among these frameworks, this server is closest to AutoGen: a central hub, broadcast within a room, optional round-robin speaker selection.

**Other systems that seat mixed-vendor agents together.** Putting Claude Code, Codex and other vendors' agents in one shared room is not unique to this project. [Concord MCP](https://github.com/Get-Concord-AI/concord-mcp) (MIT) serves Claude Code, Codex, Cursor, Gemini CLI and Grok Build from one MCP server. Its agents claim tasks with the files they expect to change, and it reports overlaps before an edit, flags stale claims, hands work over through versioned transfers and records evidence when work finishes. [OpenAgents Workspace](https://github.com/openagents-org/openagents) (Apache-2.0) puts Claude Code, Codex CLI, Gemini CLI, Cursor and others in shared threads with shared files, where an LLM router or a channel master picks who answers next. [council-hub](https://github.com/iksnerd/council-hub) (MIT) is an MCP room with typed messages and a live dashboard. [MassGen](https://github.com/massgen/MassGen) (Apache-2.0) runs Claude Code, Codex and API models, OpenRouter included, through its own orchestrator: agents answer in parallel, see each other's answers and vote for the best one. [MCP Agent Mail](https://github.com/Dicklesworthstone/mcp_agent_mail_rust) coordinates mixed-vendor agents too, under a licence rider. What this repo adds is the decision layer described above: a proposal amended in place, challenges that must quote what they dispute, quote-checked votes over one electorate, and a verify gate that needs a passing command from another connection. None of these systems has that layer (the four above read in source on 2026-09-23; MCP Agent Mail per the reuse survey). Concord's evidence is self-reported and the owner closes its own task, and MassGen's vote is a plurality over whole answers. The four read in source are compared file by file in `docs/related-work-concord-2026-09-23.md`; Agent Mail is in `docs/reuse-survey-2026-09-23.md`.

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

The hub binds to 127.0.0.1 and is meant for one machine. Participant ids are issued only to the MCP connection that joined and are never listed over HTTP, so one connection cannot act as another. Human controller POST routes (/policy, /agents/:name/stop, /rooms/archive-dead, /rooms/:room/archive, /rooms/:room/messages, /rooms/:room/vote, /rooms/:room/create, /rooms/:room/close) FAIL CLOSED: with `CHATROOM_HUMAN_TOKEN` unset they refuse unless you explicitly set `CHATROOM_INSECURE_LOCAL=1` with `HOST` on loopback (the dashboard's localhost case, token-free; `/config` then reports `human_token_required:false`). Set `CHATROOM_HUMAN_TOKEN` to require an `x-chatroom-token` header everywhere (the dashboard asks for it once). Heartbeat and /mcp never need the token. Idle MCP sessions are closed after 30 minutes and silent agents are marked as left after 10, so a dead process cannot hold a quorum open. An 18-agent audit swarm run against this repo produced the list in `swarms/swarm-001301/final/`; the critical and high findings are fixed, the rest are tracked there.

## Verify entries and the baseline-freeze guard

`require_verification` rooms need a `verify/<area>` board entry naming the proposal, by someone else, before a proposal can pass — but `verifiedBy()` only checked authorship and freshness, not content, so a `verify/*` entry that literally says `BLOCKED` satisfied the gate. Every `verify/*` entry must now START with one JSON head line, `{"proposal": "<id>", "command": "...", "cwd": "...", "exit_code": 0, "output_tail": "..."}` (per `docs/swarm-protocol-spec.md`), and the hub gates on `exit_code === 0`; prose may follow the head line. An entry without a parseable head, or with a non-zero `exit_code`, does not satisfy the gate — the refusal names the exact shape to write.

Separately, a commit that touches `.devkit/baselines/**` or `.devkit/config.json` (the guard-size/guard-fanout freeze baselines and devkit's own gate config) is refused by `.husky/pre-commit` unless a `verify/baseline-<area>` board entry, written by someone other than the committer, names the exact staged tree (`git write-tree`) — see `scripts/guard-baseline-freeze.mjs`. This block lives outside the `# >>> devkit-guards >>>` / `# <<< devkit-guards <<<` region of `.husky/pre-commit`, so a `devkit sync-hook-runner` never removes it. If the hub is unreachable the guard fails CLOSED (blocks). The human maintainer, who commits outside any room and has no hub to check against, can bypass it with `CHATROOM_BASELINE_FREEZE_OVERRIDE=1 git commit ...`; that variable is listed in `SEAT_ENV_EXCLUSIONS` (`src/env.ts`) so no seat ever inherits it.

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
scripts/guard-baseline-freeze.mjs  .husky/pre-commit guard: no self-frozen .devkit baselines
scripts/openrouter-smoke.ts  the OpenRouter seat against a stub model (no API key needed)
scripts/watch.sh  terminal follower (watch-chat --latest)
scripts/debate.sh launch Claude + Codex into one flat room
prompts/          participant (flat debate), planner, worker, lead-tail, verifier
skills/swarm/     Claude Code skill that triggers swarm mode from plain English
```

Recruit policy: every `request_agent` is launched as the hub's pinned provider and model, whatever was asked for; the default is `openrouter` / `deepseek/deepseek-v4-flash-0731` (free). `GET /policy` shows it, `POST /policy {agent, model}` changes it live (`"any"` unpins), and the dashboard's rail shows it and changes it on click. `CHATROOM_RECRUIT_AGENT` / `CHATROOM_RECRUIT_MODEL` set the start-up default. Config: `PORT` (7717), `HOST` (127.0.0.1), `CHATROOM_DATA_DIR` (unset = in-memory), `OPENROUTER_API_KEY` (required before any OpenRouter seat, including `request_agent` with `agent="openrouter"`). The hub, the launcher and the seat also read a gitignored `.env` in the repo root (see `.env.example`), so a hub started by hand can still recruit OpenRouter seats; exported variables win. Never paste a key into a room: the transcript is persisted.
