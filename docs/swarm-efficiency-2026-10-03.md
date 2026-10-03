# Swarm context cost and addressed-message delivery, 3 October 2026

This is an exploratory engineering follow-up, separate from the paper's earlier studies. It measures three different things: avoidable hub calls, the text returned by those calls, and delivery of a peer request while a seat is doing local work. Smaller responses and faster replies are process measures. The task oracle remains the correctness check under `measure-task-success-on-a-machine-oracle`.

## New research read

- Xu et al., [Concise and Precise Context Compression for Tool-Using Language Models](https://aclanthology.org/2024.findings-acl.974/) (ACL Findings 2024; arXiv:2407.02043), sections 3.1–3.4 and 4.1–4.4, Tables 2–3. Their learned compressor preserves exact tool and parameter names. Its API-Bank result concerns tool documentation and a trained model, not this hub. The engineering inference here is to preserve message/proposal identifiers, cursors, and actionable text while removing repeated representation.
- Satish et al., [Beyond Token Savings: A Systematic Study of Context Compression in LLM Agents](https://arxiv.org/abs/2609.32961), sections 1–2.4 and observations 2–3. Their nearly 35,000 executions show that lower token consumption can accompany extra calls and longer latency. Their billing estimates also distinguish cached input. This motivates reporting provider token categories, calls and wall time separately; it supplies no effect estimate for these changes.
- Liu, [What Does Context Compression Cost an Agent? Interaction Costs Unrevealed by Task-Completion Metrics](https://arxiv.org/abs/2608.16370), sections 4.1–4.5, 4.7 and limitations. Compression increased reacquisition calls in a bounded planning environment but produced no retrieval surge in ALFWorld. Re-reading therefore needs a measured signature, not an assumption that every retrieval call is redundant.

These sources add to, rather than reopen, `board-delta-manifests-and-single-electorate`, `hub-carries-what-it-knows`, `token-cost-is-resent-context`, and `measure-task-success-on-a-machine-oracle`. No RE-TARGET is proposed. The prior dashboard report `swarm-170811-k1pq/report.md` is ratified as the source of the historical workload, not as evidence about the new mechanics.

## Measurement definitions

`scripts/swarm-tool-usage.py` joins calls to returned results, deduplicates provider event blocks, and counts UTF-8 bytes of returned text. These are not HTTP wire bytes and not provider tokens. Per-seat usage sidecars take precedence over transcript token sums. Missing traces or token categories remain missing. Claude transcripts are found under the configured `CLAUDE_CONFIG_DIR`, which may differ from `~/.claude`.

`src/reply-metrics.ts` supplies both `GET /rooms/:room/stats` and offline JSONL replay. The added `reply_latency_ms` has `samples`, `min`, `p50`, `p95`, and `max`; quantiles use nearest rank. A sample is the smallest nonnegative elapsed time among qualifying later-sequence strict replies to a live mention-target pair within the existing observation window. Strict replies retain the existing exact `replyTo` or persisted mention-back rule. One reply can credit multiple earlier asks. Unknown/departed-at-ask targets and unanswered pairs contribute no latency sample. Early-answered pairs are included before their window matures. Empty summaries contain null statistics, not zero latency. Read latency together with reply rate: it is conditional on receiving a reply, not a measure of unresolved waiting time.

The latency change is additive instrumentation, with no efficiency effect claimed. New regression assertions fail before it and pass after it. The shared analyzer preserves live/replay parity, exact window boundaries, frozen prefixes, and zero-time replies.

## Component experiments

The component briefs differ and their results must not be pooled across providers.

| Component | Measurement | Before | After | Scope |
|---|---|---:|---:|---|
| Compact responses and sender receipts | Fixed 306-call trace text bytes | 410,972 | 353,079 | Exact replay, −14.09%; calls held fixed |
| Claude Code hooks | Median mention-to-reply | about 51 s | about 7 s | Three runs per arm; reply rate 3/3 both; after reply arrives during local work |
| OpenRouter step injection | Median mention-to-reply | 30.276 s | 6.758 s | Three runs per arm; reply and arithmetic oracle 3/3 both |

The [output-size report](output-size-2026-10-03.md) includes complete per-tool replay counts and three live pilot rooms. Its o200k_base proxy count falls 115,780→97,644; that is not provider billing. The live arithmetic pilot's oracle is unchanged, but conversation paths differ, so observed whole-run reductions are not causal estimates.

The [Claude hook experiment](experiments/2026-10-03-steering-claude-seats.md) delivers through PreToolUse and PostToolUse `additionalContext`. It reaches a busy seat at a tool boundary, not while that seat is thinking without tools or inside an unfinished command. Warm-run reported costs were $0.115–0.116 before and $0.107–0.108 after; cold-cache cost is reported separately in the source artifact. These short loops do not establish general task quality or cost savings.

The [OpenRouter report](openrouter-steering-2026-10-03.md) preserves its tradeoff: prompt tokens 385,885→447,057 (+15.9%), provider requests 30→34, combined tool-result and steering bytes 10,383→10,569 (+1.8%), and summed seat wall time 139.959→157.362 s (+12.4%). Model-selected tools remain 33→33. Earlier answers can require extra model requests; responsiveness improved without a token or throughput improvement.

Codex moves from `exec` to the native app-server runner and uses `turn/steer` with an expected turn ID. Its first three-run pair recorded exact-check outcomes 3/3→0/3 while reducing median latency 52.390→8.776 s. The printed instruction asked for `TOTAL_CENTS=430 (125+205+100)` while the checker accepted only `TOTAL_CENTS=430`; the changed runner followed the longer instruction. The raw failures are retained. This conflicting specification and simultaneous runner migration prevent attributing the difference to steering alone. A supplemental unambiguous-brief pair is being measured separately; it must not replace the original observations.

## Shared live benchmark

The fixed brief uses `tasks/bench-fact-check/public/records.txt`. The oracle is the exact affiliation `Society for Formal Methods, Vienna`. Three `claude-opus-5-5` seats also perform three controlled busy phases: the first worker runs separate local Bash steps; the second waits for a phase marker then addresses it with a nonce request; the verifier checks the task answer. The busy worker does not proactively read the room during local steps, but must respond if a request enters context. This is a synthetic responsiveness workload, not a naturalistic throughput claim.

Both arms must use the byte-identical brief and model/launcher options. Provenance includes source revision, entry hash, a sorted per-file hash manifest and a hash of that manifest for the complete `dist` build. Provider calls remain nondeterministic; a single paired run cannot attribute total-token differences to an individual change. The baseline predates the unrelated main-branch hub/UI split at `d8252606`, another reason to distinguish exact causal replays from whole-run observations.

The preliminary room `swarm-182148-iqt0` was invalidated before outcome analysis: role labels did not match the launcher's full model-derived names. The corrected baseline `swarm-182324-pjb8` is retained. Its private hub used port 18562 and was stopped by exact listener PID. The normalized evidence is [swarm-efficiency-final-baseline.json](measurements/swarm-efficiency-final-baseline.json); raw traces remain at the paths identified by their filenames and hashes in that artifact.

| Baseline seat | All tools | Hub calls | Hub text bytes | Input | Cache read | Cache creation | Output |
|---|---:|---:|---:|---:|---:|---:|---:|
| claude-opus-5-5-1 | 27 | 11 | 9670 | 42 | 427323 | 11671 | 3308 |
| claude-opus-5-5-2 | 20 | 16 | 15443 | 40 | 419552 | 14264 | 4049 |
| verifier | 10 | 8 | 11545 | 16 | 167572 | 12474 | 3781 |

Baseline: 35 hub calls, 36,658 returned text bytes, three of three trace/usage coverage, oracle PASS, three of three requests answered. Latency is 5,658 / 15,889 / 17,171 ms when sorted; median 15,889 ms. All replies occurred after their busy-finished markers. Marker spans were 4, 15 and 16 seconds; the first phase's separate tool calls overlapped rather than running fully serially. The room lasted less than the 15-minute metric window, so the mature denominator is zero; it must not be reported as a mature reply-rate estimate.

Final-arm results are pending integration. No aggregate improvement is claimed from this baseline alone.

## Validation limits

The instrumentation's initial full offline suite passed 151 of 152 commands. The existing `pool-run.test.ts` repository-isolation assertion failed once and passed all 14 tests on an isolated retry without source/test changes. Targeted latency tests, HTTP API checks, build and smoke pass after rebasing onto main. The source duplication matcher had no configured semantic index and opted out; the independent commit review reported no clones touching the staged source.

The paper renders with Tectonic. `paper/check-citations.sh` was run twice: the export API returned HTTP 429 for existing arXiv:2601.18285 and new arXiv:2608.16370. The new paper's identity and title were independently verified through arXiv MCP and its official abstract page. This is an incomplete automated citation check, not a passing result or evidence that the citation is invalid.
