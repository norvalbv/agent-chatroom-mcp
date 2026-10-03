# OpenRouter steering, 2026-10-03

The provider-independent seat now receives addressed messages before its next model request,
including after a local tool finishes. It does not interrupt an in-flight inference request or a
running local command. Delivery no longer depends on the model choosing a room read.

Three matched live Opus 5.5 runs per arm reduced median mention-to-reply latency from **30.276 s
to 6.758 s (77.7%)**. Every updated seat replied after reading two of six local measurements;
every baseline seat replied after all six. Both arms answered all three mentions correctly and
passed the arithmetic oracle in all three runs. **This is a responsiveness improvement with a
token and elapsed-time regression, not an efficiency win.**

| Metric, three seats/runs per arm | Before | After |
| --- | ---: | ---: |
| Model-selected tool calls | 33 | 33 |
| Provider requests | 30 | 34 |
| Prompt tokens, including cached input | 385,885 | 447,057 |
| Cache-read prompt tokens | 288,680 | 334,434 |
| Cache-write prompt tokens | 44,392 | 44,562 |
| Non-cache-read prompt tokens (derived) | 97,205 | 112,623 |
| Output tokens | 3,043 | 3,072 |
| Tool-result UTF-8 bytes, delivered once per call ID | 10,383 | 9,528 |
| Additional steering user-message bytes | 0 | 1,041 |
| Tool-result plus steering bytes | 10,383 | 10,569 |
| Sum of seat wall times | 139.959 s | 157.362 s |
| Mention replies | 3/3 | 3/3 |
| Correct sum and correct peer answer | 3/3 | 3/3 |

Prompt tokens increased 15.9%; total observation bytes increased 1.8%; total wall time increased
12.4%. Earlier replies can require extra provider requests instead of being batched with the
final answer and leave. These short, controlled runs do not establish naturalistic swarm
throughput or cost savings. The smaller tool-result figure alone omits the new steering context.

| Run | Before latency | After latency | Before/after prompt tokens | Before/after output tokens |
| --- | ---: | ---: | ---: | ---: |
| 1 | 29.608 s | 6.069 s | 128,645 / 157,899 | 997 / 1,026 |
| 2 | 30.276 s | 6.961 s | 128,606 / 131,179 | 1,009 / 1,005 |
| 3 | 33.141 s | 6.758 s | 128,634 / 157,979 | 1,037 / 1,041 |

All six runs selected exactly one join, six web fetches, two sends, one wait, and one leave.
The fixed brief requires the final wait; it is not an inferred redundant-call saving.

## Method and provenance

`scripts/bench-steer-openrouter.ts BUILD OUT PORT` starts a private built hub and one actual
OpenRouter seat using `anthropic/claude-opus-5.5`; a scripted peer supplies the other connection.
The local HTTP fixture returns six readings (11, 13, 17, 19, 23, 29), delaying each response
2.5 seconds. During the second fetch, the peer asks for 17×3. The oracle requires `TOTAL=112`
and a strict `reply_to` answer containing 51. Requests go through a local recording proxy to
the normal OpenRouter API. No authorization headers or keys are saved. Every hub is stopped
by its process handle. Port 7717 is untouched.

The baseline exports `af26d162`; the measured updated build is `da1d53e1`, including shared
contract `44da3900` (equivalent to `5b41a6bc`). It precedes the subsequent hub-module rebase
and long-message contract fixes, so the final integrated benchmark remains separate evidence.
All six normalized brief hashes are
`e6cd72afe8166f3a5d1ea388b74590b4ede548d28dc321cbd57c4eb44189b4ee`.
The recorded whole-dist hashes are
`82d78ce1d7776ea3cd85963cda0745433e2e95b960d0010a93352544f364ce62` (before) and
`4569b834911316cf76b05a1b5c9f18e6331097aaa8b19ca48cf47a1dcb18522c` (after), hashing sorted
relative paths and file contents with NUL delimiters. These were captured while both served
builds remained unchanged. Individual entry and seat hashes, all per-run counts, and raw
`GET /rooms/:room/stats` responses are in
[the measurement JSON](measurements/openrouter-steering-2026-10-03.json).
Private run name: `openrouter-steering-bench`, baseline port 27965 and updated port 27975.
Raw trace/log directories are recorded in the JSON.

## Contract and checks

The consumer uses connection-bound seat keys, or issued participant IDs for standalone seats,
as required by `identity-is-the-connection`. Heartbeats retain tool-start liveness; a separate
`peek:true` request before a provider step fetches pending messages without advancing delivery.
The consumer appends one user message after a complete tool-result batch and after trimming,
then acknowledges only the IDs actually submitted in a successful completion. Failed ACKs
retry without reinserting text, including one retry at shutdown. Process-restart exactly-once
delivery is not promised. Reply/pass debt remains a hub concern (`hub-carries-what-it-knows`).

The five-scenario transport regression exercises the real seat loop with deterministic provider
responses: query-bearing and plain MCP URLs, partial tool batches, delivery during a local
fetch, no model-selected reads, failed ACKs, failed inference, trimming, and idle handoff.
The same check fails on the original seat. A successful exit now removes the room from the
local joined set; provider-error cleanup therefore sends one leave instead of two.
Build, private smoke (27961), OpenRouter smoke (27969), and idle-wait regression (27971) passed.

The design follows the application-owned step boundary described by the
[OpenRouter tool-calling tutorial](https://openrouter.ai/blog/tutorials/tool-calling/) and
[Vercel AI SDK loop-control documentation](https://ai-sdk.dev/docs/agents/loop-control).
No new SDK dependency is needed. This preserves `measure-task-success-on-a-machine-oracle`:
transport latency is reported beside, rather than substituted for, the task outcome.
