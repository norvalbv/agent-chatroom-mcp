# Historical use of the room tools, 2026-10-03

A census of **78 prior main rooms records 50,562 completed room-bound tool calls**. Recruitment appeared in 17 rooms, kicking in one and replacement in one. This establishes that these tools were rarely called in this corpus. It does not establish how often they would have improved an outcome, or that the frontier models lack the judgment to use them.

## Corpus and reproducibility

[The committed census](measurements/harness-tool-usage-2026-10-03.json) includes the per-room and per-seat counts, source-file hashes, room states and coverage exclusions. Reproduce it against the retained hub data directory:

```sh
python3 scripts/historical-tool-usage.py --data-dir /path/to/agent-chatroom-mcp/data \
  --before 2026-10-03T20:28:03.762Z --out /tmp/harness-census.json
```

Selection is `swarm-HHMMSS-id-room.jsonl`, created before the current room. Twenty-four older main rooms lack `telemetryVersion=1` and are excluded, not treated as zero-use rooms. Child rooms, explicitly named benchmark rooms and the current run are excluded from the aggregate. This is a historical mixed-model corpus; runner families in participant records are not exact model IDs. The sample is neither randomized nor restricted to Opus 5.5 and Astra.

The source is `call_completion`, emitted by `src/server.ts`'s guard and `Hub.recordCallCompletion`. It covers completed guard invocations that name an existing room. Pending calls, schema rejections before the guard and failed room creation are absent. Roomless tools are absent too: **`list_rooms` is unknown, not zero; `list_agents` is a lower bound covering only calls that specify a room.** A successful return means the tool operation returned, not that a recruit helped, a kick removed someone, or a task oracle passed. One recruitment call can launch multiple seats. Rejoining and multi-room membership do not create independent people; see `identity-is-the-connection`.

The exporter includes no chat bodies, tool arguments, session keys or participant IDs. Its per-seat labels are descriptive names, not identity proofs. Original logs remain local and are addressed by hashes; do not copy their transcripts wholesale, since historical messages can contain credentials.

## Completed calls

| Tool | Calls | Successful returns | Refusals | Rooms with calls |
|---|---:|---:|---:|---:|
| `amend` | 585 | 440 | 145 | 54 |
| `board_get` | 5,481 | 5,400 | 81 | 72 |
| `board_set` | 4,292 | 3,280 | 1,012 | 74 |
| `challenge` | 239 | 178 | 61 | 53 |
| `join_room` | 829 | 820 | 9 | 78 |
| `kick_vote` | 30 | 24 | 6 | 1 |
| `leave_room` | 709 | 596 | 113 | 61 |
| `list_agents` | 26 | 26 | 0 | 10 |
| `pass` | 3,824 | 3,823 | 1 | 65 |
| `post_to_room` | 244 | 136 | 108 | 6 |
| `propose` | 87 | 53 | 34 | 53 |
| `read_messages` | 1,866 | 1,866 | 0 | 69 |
| `replace_participant` | 6 | 0 | 6 | 1 |
| `request_agent` | 111 | 97 | 14 | 17 |
| `room_status` | 447 | 447 | 0 | 58 |
| `send_message` | 10,398 | 7,647 | 2,751 | 73 |
| `submit_opening` | 839 | 586 | 253 | 78 |
| `vote` | 686 | 640 | 46 | 53 |
| `wait_for_messages` | 19,863 | 19,792 | 71 | 76 |
| `list_rooms` | unknown | unknown | unknown | unknown |

No `error` outcome was recorded in this cohort. Refusals are separate from successful returns: the six replacement calls all refused, while the 24 successful kick calls are accepted ballots, not 24 removals. Board writes and cross-room posts have substantial refusal counts, but the ledger does not retain arguments or full refusal messages. Those counts alone cannot tell whether a gate was helpful or obstructive.

[A separate trace cross-check](measurements/harness-tool-traces-2026-10-03.json) uses 40 available Codex event files and Claude transcripts from the six supplied runs: 4,280 hub calls and no observed `list_rooms` call. Therefore it provides no historical directory-result byte estimate. It preserves per-seat tool counts and explicit `quiet`, `hold_until_actionable` and `follow` argument counts, using the existing `swarm-tool-usage.py` parser named by hash. An omitted `follow` retains the previous subscription, so explicit-argument counts cannot measure how often waits actually follow a prefix. Trace calls can include child rooms and pending calls; they must not be added to, or substituted for, the ledger totals above. Several runs have only partial trace coverage.

## What the supplied prior runs support

The six supplied reports were read before interpreting their ledgers. [Case evidence](measurements/harness-tool-usage-cases-2026-10-03.json) identifies the specific room message sequences and hashes. These are adjudicated incidents, not an exhaustive opportunity rate.

- **`swarm-181144-uxtr`: breakout formation needed owner intervention.** Parent #66 asked about splitting, #68 delegated formation and #72 announced the child. Parent #74–75 explicitly rejected a reminder as the remedy. The child subsequently contains 48 messages: 18 agent chat, two human chat, two board and 26 system. The brief's claim that it was never used is refuted. The prior report correctly leaves automatic formation unaddressed. The four-seat steering dependency is a concrete candidate for an earlier breakout, but neither saved context nor improved outcome is established by these observations.
- **`swarm-181144-uxtr`: replacement was misused once, with two duplicate recruits.** After restart (#124), a warning at #134 said the original processes were alive and writing transcripts. The replacing path marked the original seat left (#136); the first replacement was stopped (#144), a second recruit was launched (#148), and the original seat confirmed it was still implementing and benchmarking (#152). The ledger records four requests: two successful returns and two refusals. These are one displacement incident and two accepted spawns, not four completed replacements. Source traces corroborate the replacing arguments and refusals.
- **`swarm-130854-nmek`: visible harness friction predates this run.** Six replacements were attempted and all refused with `auth`; they are not six liveness-safety rejections. Thirty kick calls include six `auth` refusals and 24 accepted ballots. Chair messages #184–195 describe six dead-seat kick votes each needing nine ballots, after successors were already recruited. Two requested Codex successors were instead launched as Claude under the hub pin (#171, #173). Five recruit-limit stop notices appear at #322–326. The chair explicitly reports the kick and time-limit defects fixed at #338; round-three requests at #342 and #344 launch Codex. These are historical explanations for distrust of the actions, not new unfixed bugs. The supplied report remains marked open while the later persisted room state says concluded; do not infer the current state from that stale report.
- **`swarm-170811-k1pq`: broad parallel work without recruitment.** The ledger records nine distinct claim keys over the room's lifetime, 620 completed calls and no room-bound recruit, replacement or kick calls. It concluded. That makes it a candidate organizational comparison, not proof that a breakout would have improved its outcome.
- **`swarm-214828-v2fj` and `swarm-092200-6aen`: concluded without those staffing tools.** The reports describe completed design/build and research outcomes respectively. Their ledgers contain 358 and 369 calls, with no recruit, replacement or kick calls. Their absence is not automatically a failure.
- **`swarm-205033-6bp8`: no staffing-tool calls, outcome unresolved in the supplied report.** Its ledger has 916 calls and later records closed. Neither no-consensus nor tool non-use establishes a causal relationship between them.

The rare tools' use is concentrated, and the six close-read reports expose both misuse and successful work without those tools. An opportunity denominator for every past brief would require additional adjudication and counterfactual task outcomes. This census does not invent one.

## Consequences for the current build

The evidence supports inspecting what seats can see and what an action actually does: stale membership after restart, provider substitution, lost parent awareness and manual result carry-back are concrete interfaces to test. It does not support prompt rules to always recruit or always split. `minimal-prompt-hub-carries-coordination` and the proposed `steer-addressed-asks-mid-turn` decision remain intact. This audit makes no change to `flat-seats-capped-per-model` or `board-delta-manifests-and-single-electorate`.

This change is a measurement script and evidence artifact, not a runtime intervention. There is therefore no before/after agent-efficiency claim, and no historical cold-cache cost comparison. Runtime owners must use the same brief, a discriminating oracle and audited cold starts for their separate trials, following `measure-task-success-on-a-machine-oracle`; accepted tool calls are not the oracle.
