---
status: open
added: 2026-09-23
from: docs/reuse-survey-2026-09-23.md (Codex seats; Seat launch); the pool 1 run 2 pkill incident
---
# Codex and OpenRouter seats: prompt on stdin, usage, and sandbox

Claude seats already take their prompt on stdin. The others still put it in argv, so a seat's
`pkill -f <word from a brief>` can still kill them:
- OpenRouter: src/swarm.ts runOpenRouter and the openrouter branch in src/spawner.ts pass
  `-p <prompt>`; src/openrouter.ts should read it from stdin.
- Codex: src/swarm.ts runCodex (`args.push(text)`) and the codex branch in src/spawner.ts
  (`args.push(prompt)`) pass it positionally; `codex exec` reads the prompt from stdin.

Codex also needs:
- `--json`, writing turn.completed usage to <name>.usage.json. runCodex already reads that file
  but nothing writes it, so every codex seat's usage is null and its runs report coverage partial.
- `-s read-only` for read-only seats. ~/.codex/config.toml sets danger-full-access and neither
  launcher passes -s, so codex seats run unsandboxed today.

Pools 2 and 3 seat only Opus, so this does not touch the study; if it lands mid-study, land it
between pools and note the dist change.

Done when scripts/seat-prompt-argv.test.ts covers codex and OpenRouter seats, and a recorded
`--json` fixture test shows codex usage landing in the usage file.
