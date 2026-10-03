# Codex native steering, 2026-10-03

The Codex launcher and recruits now use the provider's bidirectional app-server interface. A seat can receive an addressed ask through `turn/steer` while running a local command. Each request names `expectedTurnId`; only accepted injections acknowledge the hub. Rejected requests retain ordinary hub delivery. An ambiguous timeout is not blindly retried in the same turn. Pending ACKs are drained through turn completion; unknown approvals are never granted.

This follows `identity-is-the-connection`, `hub-carries-what-it-knows` and `quiet-delivery-not-privacy`; it changes no electorate or verification rule. Prior-art verdict: SOLVED_ELSEWHERE — adopt native `turn/steer`, as confirmed in the installed Codex 0.159.3 generated protocol and [OpenAI's app-server documentation](https://learn.chatgpt.com/docs/app-server). The owner-authorized Frink `codex-live-turn.ts` supplies the expected-turn/accepted-only delivery pattern. Protocol acceptance is not evidence of a reply; the live checks below measure replies separately.

## Matched busy-seat pair

Three serial `gpt-6-astra` seats per arm, one seat and one scripted peer per room. Each seat joins, performs eight separate three-second local commands, waits once, answers pending asks, and leaves. The peer sends one exact arithmetic ask after observing the second command start. Rooms are `codex-busy-1` through `codex-busy-3` on private ports 18734 (base) and 18735 (native); both hubs were stopped by their child PID. No port 7717 operation was performed.

Base: archived `af26d162`. Native: immutable dist snapshot of `ef30879f` (shared steering contract) plus the native adapter working tree. Entry and whole-dist SHA256 digests are in the adjacent JSON. Rebase subsequently placed source on contract `9ffb9d91` over main `d8252606`; later changes repair source-only loader resolution, activity and command-event telemetry, not delivery semantics. Raw event streams, final files and full GET stats remain in `/tmp/astra3-codex-{before,after}/`.

| Metric | Base | Native |
|---|---:|---:|
| Reply latency, seconds, by repetition | 60.451 / 52.390 / 45.726 | 7.884 / 8.776 / 8.924 |
| Median latency | 52.390 | 8.776 |
| Strict addressed reply rate | 3/3 | 3/3 |
| Replies during local work | 0/3 | 3/3 |
| Busy step at reply | 8 / 8 / 8 | 2 / 2 / 2 |
| Hub calls, each seat | 4 / 4 / 4 | 4 / 4 / 4 |
| Hub text response bytes, each seat | 3180 / 3180 / 3180 | 2845 / 2845 / 2845 |
| Provider input tokens, total (includes cache) | 1,059,313 | 1,058,279 |
| Cache-read tokens, total | 999,680 | 975,232 |
| Provider output tokens, total | 1,909 | 2,137 |
| Strict final-line oracle | 3/3 | 0/3 |

The median latency reduction is 83.2%. This is a responsiveness result, not a token-saving or quality-neutral result. Output tokens rose 11.9%; input totals changed by less than 0.1%. Response-byte accounting above includes only hub MCP text. Native steering additionally injected 220 bytes per seat (660 total), making hub-plus-steering text 9,195 bytes versus 9,540; local command output is outside this comparison. The one-second native HTTP poll is runtime traffic, not a model tool call. The adjacent JSON preserves per-seat provider tokens and `/stats` reply denominators.

### Oracle regression

All native final outputs were `TOTAL_CENTS=430 (125+205+100)`; base outputs were `TOTAL_CENTS=430`. The checker expected the latter exactly, so native scores 0/3. The brief itself said “output exactly TOTAL_CENTS=430 (125+205+100)”, making the intended final format ambiguous. These failures are retained; arithmetic correctness does not replace the original strict oracle. A supplemental pair clarified the final-line instruction for both arms and retained the same checker. Both passed (1/1 each). Its latency was 52.958s→7.418s, with the native reply again during step2; calls stayed4 each. This follow-up supports the formatting-ambiguity explanation, but does not erase the initial 3/3→0/3 result. Per-seat tokens and GET stats are under `clarified_followup` in the JSON.

## Reproduction and validation

Build each arm, then run `npx tsx scripts/bench-steer-codex.ts --build <arm-root> --out <artifact-dir> --port <private-port> --reps 3`. The script records the actual served build hashes and raw events. `--strict-format` selects the separately labelled clarified-instruction follow-up.

Regression checks cover delayed steering without overlapping polls, expected-turn rejection without ACK, ACK transport failure racing completion, failed terminal status, cumulative usage, event normalization, source-only launch from an unrelated project, stdin prompt privacy, and read-only launch policy. Native protocol smoke with the real model returned `READY`; targeted tests, build and private SMOKE pass. Full suite result is recorded in the review handoff.

A three-Opus dev swarm also exercised the rebased build: `swarm-184159-0hng-room`, port18736. All three independently accepted the430-cent answer after the required challenge and the room concluded. The private listener was stopped by PID70571. This is integration smoke, not a Codex latency arm.

### Actual launcher and MCP recruit

`swarm-185505-4ssn-room` ran on private18737 with one Codex, one Opus worker and an Opus verifier. Native `6-astra-2` ran a local Node arithmetic command (430), joined, left and exited0. Its usage sidecar records120,255 input,93,440 cached input,475 output and unknown cost (`null`). The room had already concluded when it joined, so this checks the launcher lifecycle rather than three-seat consensus. The event stream and report remain in `swarms/swarm-185505-4ssn/`.

The actual MCP `request_agent` path separately launched `native-recruit-proof` in `codex-recruit-proof`. It ran `printf native-recruit-work`, joined, sent430 to the scripted peer, left and exited0; sidecar174,540 input,148,608 cached input,413 output, cost `null`. The probe saved `/tmp/astra3-live-recruits/proof.json` after all recruit assertions passed. Its subsequent scripted-peer cleanup hit the ask guard; the committed probe now replies before leaving. The listener was stopped by its PID50838.

The full offline run passed152/153 commands; `pool-run.test.ts` hit the intermittent isolation assertion, then passed14/14 on an isolated rerun. Scripts typecheck passes. Source-only launch, real launcher and real recruit preserve prompt-on-stdin, read-only policy, usage accounting and normal exit. Initialization-refusal regression confirms the adapter reaps its child before rejecting.
