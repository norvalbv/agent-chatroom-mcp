# Unchanged wait observations, 3 October 2026

`src/hub/wait-view.ts` references repeated coordination state with `unchanged:true`. It retains the current hint, cursor, room lifecycle, role, turn, leaving guard and proposal id/version. A caller retains omitted coordination fields only on this explicit receipt; a full snapshot replaces them. Board delivery/reset/delta, messages/backlog, quiet activity, addressed asks, human focus, changed state and conclusions remain full. The receipt is scoped to the participant object and MCP connection; rejoin sends a full board reset. Human-focused stripped snapshots also update the receipt, so the next normal view cannot incorrectly refer to pre-human state.

This extends `board-delta-manifests-and-single-electorate` and `token-cost-is-resent-context`; it does not change votes, the 55 s deadline, the electorate or scrutiny. All 19 historically message-empty candidates still had proposals, often with vote reminders: they are not proven unnecessary wakes. No wake or call reduction is claimed. OpenRouter's local polling consumer must preserve absorbed full observations (`src/seat/wait-view.ts`, landed at a21fd07a); otherwise the model could receive an unchanged receipt without its baseline. Claude/Codex retain prior tool results in context.

## Isolated historical replay

The same 116 Claude wait observations from `swarm-170811-k1pq` pass through the actual formatter, preserving pretty JSON to isolate state removal from the separately landed compact serializer. Fifteen responses compact. Total wait text is 357,972→333,353 bytes (−24,619, −6.9%); the 19 message-empty responses are 39,916→15,297 bytes (−61.7%). Calls, provider tokens and oracle outcome are unchanged by this replay. All changes, current action hints and delivery events are retained.

[Replay results](bench-wait-view-2026-10-03/historical-replay.json) and [source hashes](bench-wait-view-2026-10-03/historical-sources.json) identify the evidence. Reproduce with `npx tsx scripts/wait-view-replay.ts <manifest.json>` where the manifest maps the room name to the three original Claude JSONL transcript paths. The parser deduplicates tool-result IDs and measures raw text before formatting; it also accepts parsed observation rows.

## Three-seat runtime pair

Baseline `swarm-185546-uiax-room` ran c1a3fe86 on private28460; candidate `swarm-185834-f3pn-room` ran75233f1b on28462. Both used three `claude-opus-5-5` seats, `--flat --agents 3 --models claude-opus-5-5 --verifier-model claude-opus-5-5 --timeout 5 --no-carry --no-web`, the identical [brief](bench-wait-view-2026-10-03/brief.txt), and this worktree as cwd. Both listeners were stopped by exact PID. This deliberately requests five zero-timeout waits per seat as a transport probe; it is not normal workload guidance. Actual candidate traces contain 14 compact waits (3,494 bytes). One worker made a sixth zero-timeout call.

| Seat | All tool calls | Hub calls | Hub response bytes | Input tokens | Cache-read tokens | Cache-create tokens | Output tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| worker1 | 24→31 | 23→28 | 17,242→16,255 | 42→56 | 507,354→687,058 | 17,439→33,765 | 5,360→6,460 |
| worker2 | 28→29 | 26→28 | 17,790→21,305 | 52→58 | 641,098→728,668 | 17,851→35,106 | 5,727→6,275 |
| verifier | 31→32 | 28→27 | 23,912→22,961 | 52→50 | 710,289→646,377 | 23,436→38,041 | 6,742→7,405 |

Aggregate calls regress83→92, hub bytes58,944→60,521 and output tokens17,829→20,140. Wait-only bytes fall37,895→36,531 while wait calls40→39; this live difference is not an isolated causal estimate. The formatter's isolated saving is the historical replay above. One pair does not establish general token or task-quality improvement.

Both workers returned4 and both rooms reached3/3 consensus (arithmetic oracle unchanged). Both failed the brief's byte-exact seven-character adopted text `TOTAL=4`: the existing vote guard requires a quote of at least15 characters. They amended to longer text, reopened challenges and repeated verification. This out-of-scope contract issue is tracked as autonomous report4184b1e8-1f77-48c7-876a-224de4600f58. Preserve that 0/1→0/1 exact-text failure, rather than counting consensus as perfect task success. Conversation paths differed; the baseline additionally created an untracked proposed decision record which candidate seats later consulted.

Raw normalized [baseline metrics](bench-wait-view-2026-10-03/base-metrics.json), [candidate metrics](bench-wait-view-2026-10-03/after-metrics.json), [wait observations](bench-wait-view-2026-10-03/live-wait-observations.json), [baseline stats](bench-wait-view-2026-10-03/base-stats.json) and [candidate stats](bench-wait-view-2026-10-03/after-stats.json) retain per-tool and per-seat evidence. [Provenance](bench-wait-view-2026-10-03/provenance.json) includes the brief hash and dist manifests: the baseline directory was unchanged after running, but the candidate manifest was reconstructed from launch source after a subsequent worktree rebuild. It is not a captured served-build attestation. This pair is exploratory runtime evidence; the shared final benchmark supplies stronger served-build provenance under `measure-task-success-on-a-machine-oracle`.

## Validation

`wait-view-regression.ts` exercises actual MCP first/full/repeat/rejoin behavior plus16 changed-state controls, separate identities/connections, removed openings and human-focus transitions. An independent verifier measured an unchanged real-hub proposal wait890→412 bytes; a challenge or addressed message restored a full result. The assigned reviewer exercises actual HTTP+MCP and the real OpenRouter consumer together. The full suite completed152/153 commands; the sole failure was the already-reported inherited Claude-hook scripts type error, fixed separately atc8a60e95. Scripts typecheck and targeted wait tests pass after rebasing onto that fix and the consumer.
