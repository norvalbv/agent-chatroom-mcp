# Redundant compound-reply retries

This change fixes a mismatch between send admission and reply settlement. It implements the existing `hub-carries-what-it-knows` target: a chat reply can both reference one thread and answer other senders by naming them. It changes no prompts, flags, subscriptions, or verification rules.

In `swarm-181144-uxtr-room`, the reply to message #43 also named the authors of pending #45 and #49. The hub refused it, returned already-delivered asks, and required a forced retry (#54). The reducer already recognized the named replies, but the admission guard ignored names whenever `reply_to` was present. The correction removes that restriction. Replying to a settled thread without naming an outstanding sender still requires reading pending traffic. Concurrent evidence remains queued and arrives exactly once.

## Reproducible transport measurement

Build each revision, then run `npx tsx scripts/compound-reply-bench.ts <checkout-root>`. The script drives three independent MCP sessions through the same brief and records exact text-result UTF-8 bytes, calls, refusals, and a semantic oracle. It uses the compiled hub under the specified root and prints its SHA256.

Baseline: `af26d162`, hub hash `8476282eaf93551204336044e2df82faa3e4e679a23c7ff179311f97609a237c`.
Changed build: hash `fb3edce8258300837ba8f3475bf670e0d0292195936646c0e3b2a4b238904031`.

| Scope | Calls before → after | Result bytes before → after | Refusals before → after |
|---|---:|---:|---:|
| Compound answer | 2 → 1 | 619 → 73 | 1 → 0 |
| Bob, complete scenario | 8 → 7 | 5,649 → 5,078 | 1 → 0 |
| Alice | 3 → 3 | 1,860 → 1,860 | 0 → 0 |
| Carol | 2 → 2 | 2,773 → 2,773 | 0 → 0 |

The oracle is unchanged: zero outstanding asks, one posted compound answer, one delivery of concurrent evidence. This removes one needless call and 571 response bytes over Bob's complete scenario (10.1%). The target send alone drops 546 bytes (88.2%); the distinction reflects when queued evidence is delivered.

This scripted replay makes no provider requests, so input, cache-read, and output tokens are **not measured**, not zero. It does not establish a general swarm-token or task-success improvement. Real-model controlled runs and the integrated same-brief benchmark are reported separately.

## Validation and interpretation

The positive regression fails on the baseline; the negative control passes. `scripts/attention-gate-regression.ts` changes from 21/22 to 22/22 with the fix. Build and smoke pass. The existing suite retains human prioritization, quiet delivery, stale unrelated sends, and unread recovery checks.

The dashboard trace has one clear instance of this guard mismatch: `6-astra-3.events.jsonl` item_78, whose reply names `@opus-2` while its refusal names opus-2 as the focused sender. This is 1/306 observed hub calls (0.33%) and 1/42 refused sends (2.38%); other refusal causes are not attributed to this fix.

Broader transcript analysis found no immediate wait→read pattern among the four Codex seats in dashboard run `swarm-170811-k1pq` (306 hub calls). A read after another tool cannot automatically be called redundant: quiet history, concurrent updates, board content and richer board metadata can all add information. This fix addresses one observed redundant retry, not every source of call overhead.

## Research

Prior-art verdict: INSUFFICIENT_EVIDENCE for broad observation suppression. The existing native wait/delta mechanisms already deliver substantial state; local guard/reducer evidence supports this narrow fix without introducing a new mechanism. No reference checkout corpus was declared.

Sources read during this work: [Optimizing Agentic Workflows using Meta-tools](https://arxiv.org/abs/2601.22037) (abstract), [RideWay: Benchmarking Efficient Task Completion for Tool-Using Language Agents](https://arxiv.org/abs/2609.17985) (abstract), and Anthropic's [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents). These motivate trace-driven identification, distinct tool purposes, and evaluating efficiency alongside successful outcomes; their reported gains are not measurements of this hub.

## Three-seat live check

Ran the identical corrected protocol with three `claude-opus-5-5` seats, `--flat --agents 3 --models claude-opus-5-5 --verifier-model claude-opus-5-5 --timeout 10 --no-carry --no-web`, on private ports 7835 then 7836. Base room: `swarm-182403-xp3u-room`; changed room: `swarm-182708-47sq-room`. Both produced `COMPOUND_OK 4` and `VERIFIED_4` (oracle delta 0). The targeted compound send needed a forced retry on base and succeeded without force after the fix. A preceding setup room (`swarm-182133-ch61`) used short seat aliases inconsistent with launcher names; it was stopped and excluded before the matched pair. Both measured hubs were stopped by their listener PIDs.

| Seat | Calls | Response bytes | Input tokens | Cache-read tokens | Cache-create tokens | Output tokens |
|---|---:|---:|---:|---:|---:|---:|
| claude-opus-5-5-1 | 9 → 9 | 5,151 → 5,591 | 20 → 18 | 211,406 → 191,659 | 8,465 → 8,708 | 2,257 → 2,081 |
| claude-opus-5-5-2 | 11 → 11 | 7,141 → 7,072 | 16 → 18 | 167,652 → 189,935 | 9,423 → 9,293 | 1,832 → 1,756 |
| verifier | 10 → 13 | 6,627 → 8,948 | 18 → 22 | 201,867 → 257,079 | 10,393 → 12,236 | 2,739 → 3,373 |

The live aggregate regressed: 30 → 33 hub calls and 18,919 → 21,611 returned bytes. The target seat's eliminated retry was offset by an additional wait, and the verifier made three more calls. This n=1 pair demonstrates execution of the fixed path, **not** an overall efficiency improvement. The deterministic matched replay isolates the avoided refusal; broader claims require the integrated benchmark. Provider-token coverage is 3/3 seats in both arms, discovered from configured Claude session roots. Raw metrics, room stats, and exact brief are preserved in `docs/bench-redundancy-2026-10-03/`.
