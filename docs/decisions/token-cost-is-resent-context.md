---
slug: token-cost-is-resent-context
created: 2026-09-18
---

# token-cost-is-resent-context

## Target · 2026-09-18 — Token cost is re-sent context: measure it per seat, cut it at the seat and the hub

**Context:** About 2 billion tokens were burned on 2026-09-17 and swarm-010513 exhausted the OpenRouter account in 40 minutes (234M prompt tokens). One measured seat ran 14,076,892 prompt tokens against 35,298 completion tokens over 202 steps, 400:1, riding the 240,000-char trim ceiling at about 70K tokens per step; run artifacts carried no usage at all and Claude Code seats reported nothing.
**Ruling:** Usage is recorded per seat in the run artifact with coverage complete|partial|none, unknown never zero (OpenRouter sidecar; Claude seats via claude -p --output-format json). Seven cuts, each test-first with a non-author verify entry: the seat's free re-poll breaks only on an actionable result; wait_for_messages gains opt-in hold_until_actionable for every provider; proactive handoff on steps, tokens, context fraction and an idle run; read digests and one sentence of quiet guidance in prompts; OpenRouter sticky session id and cache fields; session-scoped tool surface; cache-stable checkpoint trimming behind --checkpoint-trim, default off.
**Consequences:**
- Positive: A run's cost is visible and bounded per seat; chatter no longer buys a full-context turn from seats it does not concern; an uncapped seat can no longer run to 11-19M prompt tokens.
- Negative: Checkpoint trimming is unvalidated on the oracle harness (no provider credit) so it ships off; cache fields are recorded but not yet written into the usage sidecar; Claude seats started by request_agent still report no usage; size and fan-out baselines were re-frozen by the build room because src/seat.ts, server.ts, hub.ts and the src file count grew.
**Vision-fit:** n/a — internal tooling; a swarm the maintainer can afford to run
**Researched:** Room swarm-082729-8b5j-room (prop_a7a385ba v4, 8/11, verifier-checked numbers): evidence/* entries against swarms/*/ logs; arXiv:2605.23296 (parallel context compaction, summarisation is lossy), arXiv:2606.27457 and arXiv:2305.05176 (cascade routing, not adopted: per-query, no local measurement), OpenRouter and Anthropic prompt-caching docs, live Claude Code measurement of 97.0% cache-read rate. Build rooms swarm-082737-19cg (dea6c06), swarm-084605-6m31 (759bb49).
**Rejected:** LLM rolling summaries as a standalone item (loses: the only prototype is not reproducible); lowering maxContextChars together with checkpoints (loses: the smaller ceiling fires the cache-breaking splice more often); model routing now (loses: no measurement for this codebase's turn mix); crediting caching against token counts (loses: honesty, it is a price lever).
**Anchored-bet:** [BET] most of the spend is turns nobody needed and context nobody re-read, so holding waits and bounding seat lifetime beats compressing content
**Revisit-when:** tokens per seat-step or per passed oracle task do not fall on the next measured run; or --checkpoint-trim shows an oracle-pass-rate drop once credit allows the harness to run; or a held wait ever delays a message a seat had to act on
**Scope:** src/seat.ts,src/openrouter.ts,src/server.ts,src/hub.ts,src/result.ts,src/swarm.ts,prompts/*.md,scripts/idlewaits-actionable-regression.ts,scripts/hold-until-actionable-regression.ts,scripts/handoff-regression.ts,scripts/read-digest-regression.ts,scripts/quiet-guidance-regression.ts,scripts/openrouter-cache-regression.ts,scripts/tool-surface-regression.ts,scripts/trim-checkpoint-regression.ts,scripts/claude-usage-regression.ts,scripts/telemetry-usage-regression.ts
**Source:** manual

## Target · 2026-09-18 — Claude Code seats launch lean; held waits halve a research room; build rooms remain expensive

**Context:** Claude Code seats are now the seats in use and the per-turn fixes in src/seat.ts do not apply to them. A seat's first turn carried about 50K tokens of which the swarm prompt is 4.3K; the rest is Claude Code's system prompt, tool definitions and the operator's skills, plugins and memory. The morning's four rooms processed about 530M tokens.
**Ruling:** src/claude-args.ts builds every claude -p seat (launcher and recruits): --tools <the role's built-ins>, --disable-slash-commands, --setting-sources project, --exclude-dynamic-system-prompt-sections; --output-format json always, so recruits report usage; --claude-full or CHATROOM_CLAUDE_FULL=1 opts out. --bare is excluded because it never reads the subscription login. Briefs tell seats to call wait_for_messages(hold_until_actionable=true).
**Consequences:**
- Positive: Measured: first-turn context 27.2K to 20.7K on Haiku probes (about 24%, one probe per combination, 2-3K noise); a ten-seat research room fell from 115.6M to 53.6M tokens and 805 to 451 turns with held waits, two minutes slower; no board writes after conclusion.
- Negative: Build rooms are untouched by this: swarm-102347-phin processed 233M tokens for five worker seats at 243K per turn (70.97 USD at API prices), because a long Claude session's context only grows; there is no handoff or compaction for Claude seats. The quiet guidance produced no quiet messages. A Claude recruit's log is written at exit, not streamed.
**Vision-fit:** n/a — internal tooling; a swarm the maintainer can afford to run
**Researched:** swarm-102357-g062-room prop_f9d5895b v2 5/5 (e097d30), nine probes on the board; scripts/claude-room-usage.py over session transcripts agrees with artifact.usage (coverage complete).
**Rejected:** --bare (loses: OAuth login); dropping project settings too (loses: a target repo's own hooks, such as this repo's decision guard); --no-session-persistence (loses: the transcript measurement).
**Revisit-when:** a lean seat cannot do something a full seat could; or build-room cost per landed change does not fall once Claude seats can hand off or compact
**Scope:** src/claude-args.ts,src/swarm.ts,src/spawner.ts,scripts/claude-lean-flags-regression.ts,scripts/claude-room-usage.py
**Source:** manual
**Evidence-change:** Maintainer ran one real lean Haiku seat against the live hub through claudeArgs(): it called mcp__chatroom__room_status and answered correctly. Merged on main at a54794e.
