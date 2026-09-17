---
name: swarm
description: Run a swarm of N AI agents that discuss a problem in a shared chatroom and converge on a verified answer. Use whenever the user asks to get "N agents", "a swarm", "multiple agents", "a few agents" or "agents in a chat" to fix, solve, decide, investigate or debate something (e.g. "get 6 agents to fix this via chat", "have a swarm figure out why X fails", "spin up agents to decide Y"). Also for "/swarm <task>".
---

# Swarm

One command runs the whole thing: a planner agent splits the task into sub-questions, worker agents investigate each one in their own chatroom, each room's lead carries its conclusion to a leads room, and a verifier agent with veto power checks the claims against the real project before the final vote.

## Run it

Always run the orchestrator below. Do NOT hand-roll the swarm by spawning subagents that call the chatroom tools yourself: the script handles planning, room layout, the verifier and the report.

```bash
node "/Users/benji/Desktop/Personal and learning/agent-chatroom-mcp/dist/swarm.js" "<task in the user's words>" \
  --agents <N> --cwd "<absolute path of the project the user means, usually the current working directory>" \
  [--apply] [--codex <k>] [--timeout <minutes>]
```

- `--agents N`: total agents including the verifier (default 4). Use the number the user said; if they said "a few" use 4, "lots" use 8.
- `--apply`: lets the verifier implement the agreed fix on a new git branch and prove it with tests. Pass it when the user says "fix" and the project is a git repo; omit for "decide", "investigate", "debate".
- `--full-access`: workers may edit files and run anything, each on its own git worktree/branch so parallel edits cannot collide; the verifier merges. Pass it when the user says the agents should "do anything", "run code", "edit", or have "full access".
- `--codex k`: run k of the workers on OpenAI Codex (`codex exec`) instead of Claude (default 0), rotating over `--codex-models` (default `gpt-6-astra,gpt-5.6-sol,gpt-5.6-terra`). Use when the user asks for mixed models, Codex, or GPT.
- `--models sonnet,haiku`, `--lead-model opus`, `--verifier-model opus`, `--planner-model opus`: Claude model mix. For big cheap runs use `--models sonnet,sonnet,haiku --lead-model opus --verifier-model opus`.
- `--named`: show real agent names inside worker rooms (default: pseudonyms, which reduce identity bias).
- `--timeout`: minutes before stragglers are killed (default 30).

Tell the user they can watch live at http://127.0.0.1:7717/ui (and interject there as a human).

Run it in the foreground with a Bash timeout of at least 35 minutes. It prints the live transcript as the rooms talk, then a FINAL ANSWER and VERIFIER section, and writes `swarms/<id>/report.md` in the agent-chatroom-mcp repo.

## Afterwards

Relay to the user: the final answer, the verifier's verdict (VERIFIED / NOT VERIFIED and its evidence), one line per sub-room conclusion, and the report path. If `--apply` was used, name the branch the verifier created. If the exit code was 1 there was no consensus: report the sticking point from the leads room transcript rather than inventing an answer.

## Requirements

The chatroom hub is started automatically on port 7717 if it is not already running. Codex workers need OpenAI quota; if they fail to start, rerun without `--codex`.
