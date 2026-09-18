# Token round, 2026-09-18: four rooms on Claude Code seats (Sonnet)

After roughly 2 billion tokens on 2026-09-17 and an exhausted OpenRouter account, the maintainer moved seats to Claude Code on Sonnet, capped a run at 15 agents, and asked for research into token consumption: heuristics, then supporting data, then a proposed implementation. Four rooms ran; all concluded VERIFIED; main went from ecfc732 to da412ce. Decision records: `token-cost-is-resent-context` (new axis), a Target on `consensus-requires-scrutiny`, a re-target of `minimal-prompt-hub-carries-coordination`.

| Room | Seats | Task | Outcome |
|---|---|---|---|
| swarm-082729-8b5j | 11, read-only | Where do the tokens go, and one ranked plan | prop_a7a385ba v4, 8/11, about 11 minutes |
| swarm-082737-19cg | 3, write | Finish and verify usage telemetry, add Claude seats | dea6c06, unanimous |
| swarm-084135-q7ll | 4, write | Supermajority quorum; a concluded room lets people go | 91ed27d, 4/4 |
| swarm-084605-6m31 | 8, write | Build the plan | 759bb49, 5/8, all seven items |

## What the research room measured

One seat (`swarms/swarm-010513-crup/verifier.log`): 202 steps, 14,076,892 prompt tokens, 35,298 completion tokens, 400:1. Average 69,687 prompt tokens per step, which is the 240,000-character trim ceiling: the seat spends most of its life resending system prompt, tool schemas and transcript whole, uncached. The fixed system and tool-schema tax is 5,000 to 6,900 tokens per turn (three independent measurements). Board and wait delivery is already delta at the hub and was ruled out as a cause. `wait_for_messages` is 43.8% of that seat's calls; idle or no-op calls are 39% of all calls across the swarm. In one 40-minute run one document was read 86 to 89 times by 24 to 25 seats. Seats with no cap ran to 203 to 411 steps and 10.9 to 18.9M prompt tokens; seats that handed off stopped at 90 to 130 steps and 3 to 6M. On Claude Code seats, session transcripts showed a 97.0% cache-read rate and still a 174:1 billed-input to output ratio: caching cuts price, not token count.

## The plan, as built

1. The seat's free re-poll loop breaks only on an actionable result, not on any unread message (`scripts/idlewaits-actionable-regression.ts`: 11 turns and 6 chatter exposures before, 5 and 0 after).
2. `wait_for_messages(hold_until_actionable=true)`, opt-in, holds the wait in the hub until something that seat must act on arrives, so Claude Code and Codex seats get the same saving. A bystander stays held while only the nominated responder wakes for a human ask.
3. Proactive handoff merged from swarm-010513 (steps, prompt tokens, context fraction) plus an idle-run trigger.
4. Read digests (first reader of a large file posts a digest keyed by the file's hash) and one sentence of quiet guidance in the flat-run prompts. Evidence for the latter: 66 quiet messages in the loop-prompt lobby, 0 in every minimal-prompt room; 55 of 72 chat messages in the research room were @-addressed yet delivered to all 11 seats.
5. OpenRouter sticky session id and recorded cache fields; mock tests only.
6. Session-scoped tool surface (`tool_scope`), with a rule for regaining proposal and vote tools.
7. Cache-stable checkpoint trimming behind `--checkpoint-trim`, default off: it carries answer-quality risk (arXiv:2605.23296 calls summarisation inherently lossy) and the oracle harness cannot run without provider credit.

Not built: model routing (arXiv:2606.27457, arXiv:2305.05176 are per-query cascades; no local measurement). Dropped: LLM rolling summaries as a standalone item.

## Telemetry

`result.json` carries `usage` with steps, tokens, cost, `seats`, `seats_with_usage` and coverage `complete|partial|none`; unknown is never zero. OpenRouter seats write a `<name>.usage.json` sidecar; Claude seats are launched with `--output-format json` and report input, cache-read, cache-creation and output tokens plus cost. The maintainer confirmed the parser on a real CLI reply. Gap: Claude seats started by `request_agent` still report nothing.

## Quorum and leaving

`supermajority` = ceil(0.75 x electorate) through one `Hub.quorumNeeded()`. The room reverted a silent default swap for flat runs; pass `--quorum supermajority`. In a concluded or closed room `leave_room` never refuses, the hub announces claims released without deleting them, and board writes into that room are refused.

## Integration

Maintainer sweep on the merged tree: build, `scripts/smoke.ts`, `npm run smoke:openrouter`, 19 scripts outside the offline runner, `npm test` = `[offline] OK (45 commands)`. Four conflicts between telemetry and the plan (`scripts/offline-runner.mjs`, `scripts/seat-env-regression.ts`, `src/openrouter.ts`, `src/seat.ts`) resolved as unions. The build room re-froze the size and fan-out baselines and added two duplicate-code allowlist entries because `src/seat.ts`, `src/server.ts`, `src/hub.ts` and the `src/` file count grew; that debt is real and unpaid.

## Open

Measure: run the harness with `--checkpoint-trim` on and off once there is credit; compare tokens per seat-step and per passed oracle task on the next run against the 69,687 baseline. Write the cache fields into the usage sidecar. Usage for recruited Claude seats. One Claude Code session was seen joining five rooms in a row without resetting context. Whether public @-messages should be delivered quietly by default.

## First measurement (same day, one run each, not controlled)

Room swarm-100622-6jdx (ten Sonnet seats, read-only, supermajority; task: how seats should review each other's work, plan prop_62e25898 v4, 8/10, VERIFIED) ran on the new build with the brief telling seats to call `wait_for_messages(hold_until_actionable=true)`. Compared with the morning's research room swarm-082729-8b5j (same shape, old build), worker seats only, from Claude session transcripts (`scripts/claude-room-usage.py`, deduped by message id):

| | Morning research room | Review room |
|---|---|---|
| Worker seats | 10 | 9 |
| Model turns | 805 | 451 |
| Tokens processed (input + cache) | 115.6M | 53.6M |
| Per seat | 11.6M | 6.0M |
| Per turn | 144K | 119K |
| wait_for_messages calls | about 513, none held | 42, all held |
| Messages in the room | 191 | 110 |
| Board writes after conclusion | 14 | 0 |
| Minutes to conclusion | 10.5 | 12.6 |
| Quiet messages | 0 | 0 |

The launcher's own telemetry agrees: `result.json` usage has coverage complete for 10/10 seats, 60.1M cache-read tokens, 1.6M cache-creation, 377K output, 22.34 USD at API prices. Tokens fell by about half, almost entirely because held waits removed model turns; the tasks differ and there is one run per arm, so treat it as a direction. The quiet guidance changed nothing: no seat sent a quiet message. A Claude Code seat starts at about 50K tokens of context on its first turn, of which the swarm's prompt is about 4K; the rest is Claude Code's system prompt, tool definitions and the operator's skills and memory, and it is paid on every turn.
