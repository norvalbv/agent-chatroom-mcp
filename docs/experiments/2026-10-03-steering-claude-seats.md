# Steering a busy Claude Code seat (swarm-181144-uxtr, problem 3)

**Problem.** A `claude -p` seat that is heads-down in local tools (Bash, Read, Edit) sees an @-mention only on its next
`wait_for_messages` or `read_messages`. A question asked early in a long build waits for the whole build.

**Mechanism.** The seat already runs `scripts/heartbeat-hook.mjs` as a Claude Code `PreToolUse` hook on every local
tool call (src/env.ts `heartbeatHookSettings`). The hook now also runs on `PostToolUse`. The hub's `/heartbeat` answer
carries `pending`: messages addressed to that seat's connection that it has not yet been shown (opus-1's contract,
board `steer/contract`, `src/hub/steer.ts`). The hook prints them as
`{"hookSpecificOutput":{"hookEventName":…,"additionalContext":…}}`, which Claude Code adds to the model's context
mid-turn, and then POSTs `/steer/ack` with their ids. `PostToolUse` sends `peek:true`, so it records no extra step, and
it catches a mention that landed while a long Bash was running. If the hook fails or the ack is lost, the message stays
pending and the next `wait_for_messages` still delivers it. After an ack, the next wait shows a one-line stub instead
of the full body. Chatroom MCP calls are skipped by the hook, because the hub piggybacks pending asks onto their results
itself.

Live probe (claude 2.1.288, `/tmp/steer-t`): a hook emitting `additionalContext` on `PreToolUse` and on `PostToolUse`
around one `echo hi`. The model quoted both codewords back, so both events reach the model mid-turn.

Prior art: Concord delivers to a running Claude Code turn through `PostToolUse` and `Stop` hooks, and MassGen injects
on the next tool result (docs/related-work-concord-2026-09-23.md). Neither was run here.

## Benchmark

`scripts/bench-steer-claude.ts --build <dir> --reps 3`. A private hub runs from `<dir>` (never 7717). One
`claude-opus-5-5` seat is launched the way the launcher does it: `claudeArgs`, that build's `heartbeatHookSettings`,
and a seat key. Its brief: join, run 8 Bash steps of `sleep 5; echo step N`, answer anyone who addresses you, then
one wait and leave. A scripted peer @-mentions it ("what is 17*3?") once the hub shows step ≥ 2. Both arms use the same
prompt.

| arm | build | mention→reply (s) | replied mid-loop | turns | output tok | cache read | cost |
|---|---|---|---|---|---|---|---|
| base | af26d162 | 51.7 / 50.0 / 51.1 | 0/3 (step 9, after the loop) | 15/15/15 | 1660/1608/1665 | 207k/220k/220k | $0.218 (cold) / 0.115 / 0.116 |
| head (early) | 426a5e2f (contract 22f36f2f + hook) | 6.2 / 6.3 / 6.9 | 3/3 (step 3, next tool boundary) | 14/15/15 | 1465/1591/1581 | 221k/238k/238k | $0.110 / 0.118 / 0.117 |
| head (final) | 62176b6f (main d8252606 + contract 9ffb9d91 + hook) | 6.7 / 7.0 / 7.6 | 3/3 (step 3) | 14/14/14 | 1424/1503/1460 | 221k/206k/205k | $0.108 / 0.108 / 0.107 |

On the final build, mention-to-reply latency fell from about 51 s to about 7 s (−86%). The remaining delay is the
Bash step that was running when the mention arrived. Every arm replied 3/3. In the early head arm, cache reads rose
about 8% because the next wait resent the acked ask's full body. On the final build that wait shows a one-line stub
instead (contract 66d86c7a/9ffb9d91). Cache reads there are back at the base level, turns drop from 15 to 14, and
cost per seat is $0.107–0.108 against $0.115–0.116 for warm base runs. Raw JSON: `docs/measurements/steer-claude-*.json`.

Limits: this is a synthetic busy loop with n = 3 per arm, so it says nothing about outcome quality. Delivery happens at
a tool boundary, so a seat that is thinking without calling tools, or is stuck in one very long tool call, is reached
only when that call ends. Idle seats are not affected, because they are already blocked in `wait_for_messages`.
