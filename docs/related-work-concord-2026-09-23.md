# Related work: Concord MCP, OpenAgents Workspace, MassGen and council-hub (2026-09-23)

Follow-up to [reuse-survey-2026-09-23.md](reuse-survey-2026-09-23.md). Its skeptic check found that mixed-vendor agents in one room are not ours alone and named projects the survey had missed. This note compares four of them with this hub, feature by feature, from their source. It then says what is worth taking and which of our sentences needed correcting.

## Short answer

- **Putting Claude Code, Codex and other vendors' agents in one shared space is not unique to this project.** Concord MCP and council-hub do it as MCP servers. OpenAgents Workspace does it as a self-hostable workspace with its own launcher. MassGen does it inside its own orchestrator, and it also seats API models, OpenRouter included, next to the Claude Code and Codex CLIs.
- **The decision layer is still ours alone, as far as these four codebases show.** None of them has a proposal amended in place, a challenge that must quote the text it disputes, quote-checked agree votes over one electorate, or a gate that needs a passing command from a different connection before anything is accepted. MassGen's vote is a plurality over whole answers. OpenAgents' only votes are forum upvotes. Concord and council-hub have no votes.
- **Concord has four things we lack.** Stale claims are listed. Overlap is checked against declared file paths, with a hook that blocks colliding edits. Ownership moves through versioned transitions. Evidence on finish is structured. Checking the first against our hub turned up a real gap (section 4): once a seat leaves, its `claim/*` stays owned and nobody can take the key over, not even its registered successor.
- **Worth taking now:** the stale-claim idea, written from Concord's design (MIT, so its code could be reused, but it is small enough to write ourselves). Concord's evidence field names could also become a suggested `handoff/*` format. File-level leases and push delivery stay WATCH, as the survey said, but Concord replaces MCP Agent Mail as the design reference for both, because it carries no licence rider.

## 1. What was read

Every claim below cites a file and line at the pinned commit. Shallow clones were made on 2026-09-23. Stars, releases and licence identifiers come from `gh api repos/<repo>` and `gh api repos/<repo>/releases` on the same day.

| Project | Commit read | Licence (file) | Activity (gh API, 2026-09-23) |
|---|---|---|---|
| [Concord MCP](https://github.com/Get-Concord-AI/concord-mcp) | `6bc1205` (v0.10.5) | MIT, "Copyright (c) 2026 Concord AI" (`LICENSE:1-3`) | 323 stars; v0.10.5 released 2026-09-23; pushed 2026-09-23 |
| [OpenAgents Workspace](https://github.com/openagents-org/openagents) | `fd52307` | Apache-2.0 (`LICENSE`; no NOTICE file at the root) | 4,137 stars; launcher-v1.0.8 released 2026-09-21; pushed 2026-09-23 |
| [MassGen](https://github.com/massgen/MassGen) | `007bd85` (v0.1.97) | Apache 2.0 text in `LICENSE`, `license = { text = "Apache-2.0" }` in `pyproject.toml:11`; the GitHub API reports NOASSERTION | 1,133 stars; v0.1.97 released 2026-06-12; no push since 2026-06-12 |
| [council-hub](https://github.com/iksnerd/council-hub) | `0baf250` (v0.61.1) | MIT, "Copyright (c) 2026 iksnerd" (`LICENSE`) | 3 stars; v0.61.1 released 2026-09-21; pushed 2026-09-22 |

This hub's own references are to `src/server.ts`, `src/hub.ts` and `src/index.ts` at `d755a873`, and to [swarm-protocol-spec.md](swarm-protocol-spec.md).

## 2. Feature by feature

### Mixed-vendor seats

- **This hub.** Any MCP client joins with an `agent` tag (`src/server.ts:150`). The launcher and `request_agent` start `claude -p`, `codex exec` and OpenRouter seats (`src/server.ts:689`). OpenRouter models, which have no CLI, get this repo's seat process with local tools (README, "Connecting agents manually").
- **Concord.** It is one MCP server for "Claude Code, Codex, Cursor, Gemini CLI, and Grok Build" (`README.md:9`, `README.md:80-89`). It does not launch agents: it is "not another autonomous agent or orchestrator" (`README.md:112-114`, `README.md:228-232`). A grep of `src/` and `docs/` finds no OpenRouter or API-model seat.
- **OpenAgents.** Its launcher runs 13 agent types, including Claude Code, Codex CLI, Gemini CLI, Cursor, OpenCode and Copilot CLI (`README.md:110-126`). OpenRouter models run through Aider (`README.md:170-190`). Each agent turn is one CLI run: for Claude Code, `claude -p <prompt> --output-format stream-json` (`packages/agent-connector/src/adapters/claude.js:472`), whose output is posted back to the thread (`packages/agent-connector/src/adapters/base.js:1529-1545`).
- **MassGen.** Its backends wrap `codex exec --json` (`massgen/backend/codex.py:1-25`) and the Claude Code SDK (`massgen/backend/claude_code.py:1-15`). They also call API providers, including OpenRouter (`massgen/backend/chat_completions.py:1134`, `README.md:461-490`), all inside one orchestrator run.
- **council-hub.** It is an MCP server any MCP client can join. The README names Claude Code and Gemini CLI (`README.md:13-15`, `README.md:40-56`).

So the survey's first list of what only we have should read: the decision layer, plus OpenRouter models as full participants *of an MCP room* alongside the CLIs. API models deliberating next to CLI agents is not ours: MassGen does it.

### Claims and overlap warnings

- **This hub.** A `claim/<area>` is a JSON board entry. Once created, only its owner can write it (`src/hub.ts:2015-2017`), and the hub assigns a reviewer when it is created (`src/hub.ts:2161`). Overlap uses content-word stems of the key and every free-text field: 4 or more shared stems, and Jaccard 0.4 or higher, or 0.2 when the key slugs match (`src/hub.ts:2095-2155`). An overlap produces an advisory room notice that @-names both owners and also comes back in `board_set`'s result (`src/hub.ts:2113-2129`, `src/server.ts:579-583`). Claims name areas, not files.
- **Concord.** `start_work` takes declared `expected_files`, `modules`, `domains` and `risk_tags` (`src/domain/schemas.ts:98-117`). Overlap is exact intersection: same file, same directory, or shared module, domain or risk-tag tokens. The code says this "remains deliberately naive: no stemming or semantic conflict detection" (`src/domain/overlap.ts:92-165`). A Claude Code `PreToolUse` hook blocks an Edit or Write to a file another active task has claimed, with exit code 2. It blocks only when `CONCORD_TASK` names your own task; otherwise it warns (`src/cli/commands/hook.ts:33-80`). `concord check <files>` runs the same same-file check for hooks or CI (`src/cli/commands/check.ts:14-45`, `src/cli/commands/check.ts:62-80`). Codex gets `SessionStart`, `PostToolUse` and `Stop` hooks from `concord setup`, but no `PreToolUse` gate (`src/install/codex-config.ts:76-99`).
- **OpenAgents.** It has no claims. Tasks live on a kanban board, and a person assigns and runs them (`workspace/backend/app/routers/tasks.py:555-570`). The agent MCP tools cover history, agents, files, browser, tunnels, todos, timers, routines, notifications and knowledge. None of them is a claim tool (`packages/agent-connector/src/mcp-server.js:29-479`).
- **MassGen.** It has no claims. Every agent answers the whole task in parallel (`README.md:207-213`).
- **council-hub.** It has no claims. It says it "does not try to stop two agents editing the same file". Instead it warns when two participants post from the same working tree, because they share one git index (`docs/mcp-tools.md:62-70`).

### Stale claims and liveness

- **This hub.** Seats heartbeat (`src/index.ts:263-280`). `room_status` rates each participant active (under 60 s), idle (under 600 s) or suspected_dead (`src/hub.ts:598-602`). The idle sweep marks a quiet seat as left (`src/hub.ts:3155-3172`). Nothing lists claims whose owner is gone; see section 4.
- **Concord.** Presence comes from `last_seen`: live under 5 min, idle under 30 min, away under 1 h, archived after that (`src/domain/presence.ts:21-26`). `detectStaleClaims` flags an active, blocked or handoff-offered task whose agent is away, archived or never registered (`src/domain/presence.ts:82-134`). `inspect_work` returns the list as `stale_claims` (`src/tools/workflow.ts:612-650`, `README.md:126-128`).
- **OpenAgents, MassGen, council-hub.** None has claims, so none has stale claims. council-hub flags stale *rooms* (`README.md:58-74`, "Knowledge Linting").

### Handoff

- **This hub.** `handoff/*` board entries are free text. `leave_room` needs a reason and is refused once while you own a `claim/*` with no `handoff/*` (`src/server.ts:224-240`, `src/hub.ts:869-894`). A replacement seat can be registered for a departed one (`src/server.ts:723`, `src/index.ts:111-116`).
- **Concord.** `transfer_work` applies one versioned action: assign, accept, decline, release, reassign, offer or reopen (`src/domain/schemas.ts:165-203`). Every action takes `expected_version`, so if two agents act on the same version only the first succeeds. An offered handoff keeps ownership with the sender until the recipient accepts. Every ownership change goes into an append-only audit history (`README.md:148-153`).
- **OpenAgents.** Handoff is by @mention: a leading @name, or declared `explicit_targets`, routes the next turn (`workspace/backend/app/mods/workspace_mod.py:759-790`).
- **MassGen, council-hub.** Neither has a handoff primitive.

### Evidence on finish

- **This hub.** Nothing is recorded on finish as such. What counts is a `verify/*` entry whose first line is a JSON head `{proposal, command, cwd, exit_code, output_tail, commit?}` (`src/hub.ts:35-56`). A proposal passes only when a qualifying head exists: written by another connection, newer than the proposal's current text, naming that proposal, with exit_code 0. While the hub-assigned reviewer is active, only that reviewer's entry counts (`src/hub.ts:2650-2677`).
- **Concord.** `finish_work` records `what_changed`, `changed_files`, `tests_run`, `known_risks`, `assumptions`, `decisions`, `guardrails_checked` and `next_steps`. It optionally adds `needs_review_from`, `diff_size`, `open_questions`, `provenance` and a `reported_outcome` (`src/domain/schemas.ts:63-95`, `src/domain/schemas.ts:205-227`). It writes `HANDOFF.md` and `REVIEW_PACKET.md` (`README.md:177-183`). All of it is self-reported: `tests_run` is a list of strings with no exit code. The owner closes its own task, with no second party involved (`src/tools/task-lifecycle.ts:61-67`, `src/tools/task-lifecycle.ts:232-247`). Review-ready only records a packet and sets the status (`src/tools/review-ready.ts:12-62`).
- **MassGen.** After the vote, the winning agent can post-evaluate its own answer and restart (`massgen/orchestrator_collaborators/post_evaluation_runner.py`, module docstring). That is a self-check, not an independent run.
- **OpenAgents, council-hub.** Neither records evidence. council-hub has a typed `review` message kind (`README.md:58-74`).

### Proposals and amend

- **This hub.** One proposal is open at a time. `amend` edits it in place, posts only the diff and bumps the version. Votes reset, except agrees whose quoted clause still appears in the text (`src/server.ts:518-557`).
- **council-hub.** It has the nearest thing. `update_message` keeps an append-only revision chain, with `expected_content` for optimistic concurrency and `supersedes` links (`docs/mcp-tools.md:15`, `docs/mcp-tools.md:31`). No vote is attached to a revision.
- **MassGen.** A `new_answer` from any agent makes every other agent restart (`massgen/orchestrator.py:2328-2337`). That is similar in spirit to our vote reset on amend, but it applies to whole answers.
- **Concord, OpenAgents.** Neither has proposals. Concord's `update_work` can record a `decision` note on a task (`src/domain/schemas.ts:128-162`). OpenAgents pins the decisions a *user* has confirmed into every agent prompt (`packages/agent-connector/src/adapters/decision-log.js:1-15`).

### Challenges

- **This hub.** A challenge must come from someone other than the proposer before a proposal can pass. It quotes a clause, and an amend that removes the clause answers it. An executable challenge carries a command, and only a rerun of that command with exit 0, or a ruling, answers it (`src/server.ts:636-660`, `src/hub.ts:2444`).
- **council-hub.** `link_messages` can assert a `contradicts` relation between messages (`docs/mcp-tools.md:34`), but nothing is gated on it.
- **Concord, OpenAgents, MassGen.** None has a challenge primitive. Across Concord's `src/`, `docs/`, `README.md` and `CHANGELOG.md`, a grep for vote, voting, quorum, consensus, proposal, challenge, electorate and veto finds no matches.

### Votes and electorate

- **This hub.** An agree vote must quote a clause of 15 or more characters that the hub finds in the text, and a disagree must say what change would flip it (`src/server.ts:662-686`). One electorate snapshot counts per connection. Quorum is unanimous, majority or supermajority (`src/hub.ts:1919-1923`), and the chair may veto (`src/hub.ts:57`, `src/hub.ts:914-916`).
- **MassGen.** Each agent votes for the agent with the best answer, by anonymous id, with a reason (`massgen/tool/workflow_toolkits/vote.py:95-117`). The winner is a plurality, and a tie goes to the agent that answered first (`massgen/orchestrator_collaborators/final_presentation_runner.py:413-436`). There is no quote check and no disagree-with-reason rule.
- **OpenAgents.** The SDK's forum mod has upvotes and downvotes on topics and comments (`sdk/src/openagents/mods/workspace/forum/README.md:11`, `sdk/src/openagents/mods/workspace/forum/adapter.py:338-360`). They are scores, not a decision rule. This corrects the survey's "no proposals, votes or verify gate" slightly: there are votes, but no decision rule.
- **Concord, council-hub.** Neither has votes. council-hub's emoji reactions (`docs/mcp-tools.md:33`) are not a decision rule.

### Verify gate

- **This hub only** (see "Evidence on finish"). No one else has a gate that needs a second agent to report a passing command before work is accepted. Concord's evidence is self-reported and its owner can close its own task. MassGen's post-evaluation is done by the winner. OpenAgents and council-hub record nothing of the kind.

### Human overseer

- **This hub.** Humans post, vote, kick, replace and close from the dashboard (`src/index.ts:326-416`). A human is never waited on for quorum, but may veto (`src/hub.ts:914-916`). The hub names one responder for each human message and holds it back from the others until someone answers (`src/hub.ts:1594`, `src/hub.ts:1730`).
- **Concord.** A task carries a human `owner`. A registered agent working for the same owner can force-reassign or reopen that owner's tasks (`src/tools/task-lifecycle.ts:57-59`, `src/tools/task-lifecycle.ts:203-230`, `src/tools/task-lifecycle.ts:249-257`). Humans use the CLI; there is no human message routing.
- **OpenAgents.** Humans are first-class in the browser workspace. A human message goes to the channel master, or to the agent named by a leading @mention. After an agent speaks, an LLM router ("Haiku", per the docstring) picks the next speaker or stops (`workspace/backend/app/mods/workspace_mod.py:1-13`, `workspace/backend/app/mods/workspace_mod.py:1465-1474`, `workspace/backend/app/mods/workspace_mod.py:1640-1670`). A "master" mode is a deterministic star topology (`workspace/backend/app/mods/workspace_mod.py:812-830`).
- **MassGen.** Steering is human input typed mid-run. It is delivered on the target agent's next tool result, or through a file inbox (`massgen/steering.py:1-26`).
- **council-hub.** Its dashboard shows activity (`README.md:58-74`). Whether a human can post from it was not checked.

### Dashboard

- **This hub.** A web dashboard at `/ui` (`src/index.ts:235`), with Decision, People, Board and Stats panes and human controls (README, "Quick start").
- **Concord.** `concord dashboard`, a "read-only, full-screen local TUI" (`README.md:211-215`).
- **OpenAgents.** A browser workspace with a shared browser, files and tunnels (`README.md:69-97`).
- **MassGen.** A Textual TUI "with timeline, agent cards, and vote tracking", plus a Web UI (`README.md:146-154`).
- **council-hub.** A Phoenix LiveView dashboard (`README.md:40-60`).

### Push delivery into a running turn

This hub has seats long-poll `wait_for_messages`; the survey's WATCH item covers pushing instead. Concord documents delivery per harness. For Codex, a per-session bridge sends `turn/steer` with `expectedTurnId` while a turn is running and `turn/start` when idle, falling back to a pull message (`docs/codex.md:46-56`). For Claude Code, a relay plugin monitor wakes an idle session, and `PostToolUse` and `Stop` hooks cover a running turn (`docs/claude-code.md:58-61`). council-hub pushes into Claude Code through a research-preview channel plugin (`README.md:58-74`). MassGen injects on the next tool result (`massgen/steering.py:1-26`). **Unverified:** none of these delivery paths was run here.

### Licence

This repo declares `"license": "MIT"` in `package.json:23` but has **no LICENSE file**. Concord and council-hub are plain MIT: code may be copied if its copyright and permission notice travel with it. Before any copy lands, the repo needs a LICENSE file to go alongside it. OpenAgents and MassGen are Apache-2.0: reuse needs the licence text, a note of any changes, and any NOTICE content carried along (neither has a NOTICE file at its root). None of the four carries MCP Agent Mail's OpenAI/Anthropic rider.

One more caution before running Concord next to our seats: it sends telemetry to `getconcord.ai` by default. That covers operation names, outcomes, durations and pseudonymous ids, not code or content. The server stores the request IP. `CONCORD_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1` turns it off (`README.md:252-268`).

## 3. What they have that we lack, and the reverse

**They have, we lack:**
1. A stale-claim list, and a way to take over a departed owner's claim (Concord). Our gap is shown in section 4.
2. Overlap from declared file paths, with an edit-time block for Claude Code (Concord). Ours is area-level and advisory.
3. Versioned ownership transitions with accept-before-transfer and an append-only ownership audit (Concord).
4. Structured evidence fields at finish, and generated handoff and review-packet files (Concord).
5. Push delivery into a running or idle session for each harness (Concord, council-hub for Claude Code, MassGen steering).
6. One-command setup that writes MCP configuration into five clients (Concord `README.md:62-78`).
7. A shared browser and shared files for agents and humans (OpenAgents).
8. Semantic search, a knowledge graph over messages, and multi-node clustering (council-hub `README.md:58-74`).

**We have, they lack:**
1. The decision layer: a proposal amended in place, quote-anchored and executable challenges, quote-checked agree votes, one electorate with supermajority and a chair veto, and the verify gate with a hub-assigned reviewer. MassGen's plurality vote and council-hub's revisions and `contradicts` links are the nearest pieces, and neither gates anything.
2. Hub-enforced answer duty for humans, and reply debt for @-asks.
3. Blind openings and sealed drafts inside a shared room. MassGen's parallel first round is the closest analogue, but it is run by the orchestrator, not by a room.
4. The launcher and recruitment: planner, sub-rooms, verifier, `request_agent`, caps and replacements. Concord deliberately launches nothing. OpenAgents' launcher runs the agents a person has created and connected (`README.md:41-50`).
5. OpenRouter models as participants of an MCP room, with local tools.

## 4. The stale-claim gap in this hub

Our hub releases a seat's claims in three cases: when it is removed by a kick vote or a live replacement (`removeParticipant`, `src/hub.ts:3082-3125`), and when the room concludes or closes (`releaseClaims`, `src/hub.ts:2801-2839`). A voluntary leave (`src/hub.ts:847-869`) and the idle sweep (`src/hub.ts:3155-3172`) only mark the seat inactive. Replacing a seat that has *already* left goes "straight to recruiting" without a removal (`src/spawner.ts:405-416`). After that, the claim is owned by nobody who can act on it:

```ts
// scratch probe, run from the repo root with: npx tsx probe.ts  (then delete it)
import { Hub } from "./src/hub.ts";
const hub = new Hub(), room = "probe";
const a = hub.join(room, "alice", "claude", { topic: "t" }, undefined, "sa").participant;
const b = hub.join(room, "bob", "codex", {}, undefined, "sb").participant;
hub.join(room, "carol", "claude", {}, undefined, "sc");
hub.setBoard(room, a.id, "claim/parser", JSON.stringify({ area: "parser", owner: "alice", status: "open" }));
hub.leave(room, a.id, "left mid-task without a handoff");
for (const opts of [{}, { overwrite: true }]) {
  try { hub.setBoard(room, b.id, "claim/parser", JSON.stringify({ area: "parser", owner: "bob" }), opts); console.log("taken", opts); }
  catch (e) { console.log("refused", opts, (e as Error).message.slice(0, 60)); }
}
```

At `d755a873` both writes are refused with `claim "claim/parser" is owned by alice ...`. So is a write by a successor registered through `registerReplacement`, with or without `overwrite`. The claim stays owned by the departed seat until the room ends. `room_status` has no field that lists it. The workaround is to claim the area under a different key: overlap checks skip owners who are no longer active (`src/hub.ts:2137-2139`), so that goes through silently. The result is duplicate keys for one area.

Concord's answer: a claim whose owner is away or unregistered is listed as stale (`src/domain/presence.ts:82-134`), and the human owner, or an agent working for them, can force-reassign it (`src/tools/task-lifecycle.ts:203-230`).

## 5. What is worth taking

1. **Take the idea: list stale claims and let them be taken over.** It is small, and our own gap (section 4) shows the need. Suggested shape, pending the owner's decision:
   - When a seat leaves or is swept, release its `claim/*` entries the way `removeParticipant` already does.
   - Alternatively, keep them owned but let the registered successor, or anyone once the owner has left, take the key.
   - Either way, add `stale_claims` to `room_status` and the dashboard.

   Our leave refusal already asks for a handoff first (`src/hub.ts:869-894`), so releasing on leave loses nothing that the handoff did not already capture. Write it from Concord's design; the logic is short enough that copying code is unnecessary. It needs a regression test in the style of `scripts/claim-workspace-regression.ts`. This note does not change the hub; it is a follow-up for the todo list.
2. **Take the field names, not a gate: a suggested JSON head for `handoff/*`.** Use Concord's `what_changed`, `changed_files`, `tests_run`, `known_risks` and `next_steps` (`src/domain/schemas.ts:63-72`), as a prompt-level format. These fields are self-reported, so they cannot replace `verify/*`. The paper's review audit already shows that recorded checks are mostly re-runs of existing builds and tests.
3. **Keep WATCH, but switch the reference: file-level leases.** The survey's trigger still stands: act only if pool runs record merge conflicts. If they do, Concord (MIT) is the reference instead of MCP Agent Mail, because it has no rider. Its pieces are declared `expected_files`, a same-file check and a `PreToolUse` block (`src/cli/commands/hook.ts:33-80`, `src/cli/commands/check.ts:14-45`). Its Codex install has no `PreToolUse` gate (`src/install/codex-config.ts:76-99`), so a Codex seat would still need a pre-commit check.
4. **Keep WATCH: push delivery.** Concord's Codex bridge, which uses `turn/steer` with `expectedTurnId` and `turn/start` when idle (`docs/codex.md:46-56`), is a documented MIT reference next to hcom. It has not been run here.
5. **Do not take:**
   - OpenAgents' LLM router or master routing. A router picking the next speaker conflicts with free and round-robin rooms and with the hub's own answer-duty rules.
   - MassGen's plurality vote. In our Study 1 the vote arm, which selected among independent attempts, already picked the common wrong implementation while correct attempts were available.
   - council-hub's knowledge graph and clustering. They are out of scope.

## 6. Corrections made on this branch

- **README.md, "Design notes from the research".** "This server is closest to AutoGen" was true among the research frameworks the paragraph lists, but it implied there was no nearer neighbour. It now says "among these frameworks". A new paragraph names Concord MCP, OpenAgents Workspace, council-hub, MassGen and MCP Agent Mail as prior work for mixed-vendor rooms, and says what stays distinct here.
- **paper/.** Nothing needed correcting. No sentence in `paper/sections/*.tex`, including the abstract and introduction, says or implies that mixed-vendor rooms, claims, handoffs or evidence-on-finish are unique to this system. The system section describes the evaluated build and makes no claim of novelty. `paper/related-work.md` states a narrow contribution claim about the hub-enforced combination of blind openings, challenge, quote-checked votes and the verify gate, and none of the four projects contradicts it. So neither `refs.bib` nor the paper text changed. If the owner wants the paper to situate the system among open-source systems anyway, the closest match to the paper's own comparison (independent attempts, then a vote) is MassGen. Its parallel answers, visible to each other, followed by a plurality vote sit between arms C and K. That would be a related-work addition, not a correction.

## 7. Unverified or not checked

- None of the four was run. Behaviour is read from source and docs at the pinned commits.
- Concord's delivery paths (Codex app-server bridge, Claude Code monitor, Cursor, Gemini and Grok adapters), and how reliable they are.
- Whether council-hub's dashboard accepts human posts.
- The OpenAgents LLM router's model is taken from its docstring ("Haiku"), not from configuration.
- MCP Agent Mail's features and licence are cited from the survey's skeptic check, not re-read here.
