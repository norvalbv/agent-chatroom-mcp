# Breakouts with existing seats: join_room(parent=)

swarm-202803-dpij, claim/breakouts (opus-1). Runtime change: `join_room(room=<new>, parent=<a room you are in>)`.

## What stood between a seat's judgement and a split

Before this change, an existing seat could already open or join a second room with `join_room`, and `request_agent(new_room)` could spawn new seats into one. What was missing was any link between the rooms and any view of the room a seat had stepped out of:

- its wait loop covered one room, so asks and votes owed in the other room went unseen until it polled there;
- nothing linked the two rooms, so `room_status` showed no relation between them;
- the sub-room's result reached the parent only if a seat remembered to `post_to_room` it.

So splitting cost a seat its view of the parent room, plus manual carry-back. No prompt rule was added. The change is to the affordance and to what the hub returns:

- `join_room(parent=)` links the child and posts one system line in the parent.
- `room_status` shows `parent` and `breakouts`.
- When the child concludes, the hub writes its conclusion onto the parent's board as `inbox/<child>/conclusion`. The pointer to the whole text comes first, and the entry stays within the 8000-char cap. A parent that has already concluded or closed is never written to.
- A connection seated in more than one room gets `other_rooms` on its waits (asks, votes or challenges owed elsewhere, or a conclusion it has not seen). Its wait, including `hold_until_actionable`, wakes for these, checking in 5 s slices.
- Re-parenting a room is refused. Electorates are unchanged, and owed votes use the shared `needsVote` predicate.
- Checks: `scripts/breakout-regression.ts` (6 tests, in `npm test`; it fails at 31daae67, where `parent` is ignored) and 6-astra-8's independent review probes (verify/breakouts-astra8).

## Same-brief bench

Data: `docs/measurements/breakouts-2026-10-03/` (room logs, usage, per-trace sha256 and turn counts, `summary.json`). The brief, oracle and summariser are in `bench/breakouts/`.

The brief asks for two independent decisions, each to be recorded as its own agreed conclusion, and for the room's final conclusion to state both. A room concludes once, so **the task forces a split in both arms**. The bench therefore measures what the split costs and whether its result reaches the parent. It does not measure whether seats split unprompted (verifier #366).

Setup: each arm has 1 worker and 1 verifier on claude-opus-5-5, with recruits pinned to claude-opus-5-5 and `DISABLE_PROMPT_CACHING=1` on both arms. That makes the runs uncached throughout. Every seat's first request read 0 cached tokens, and so did every later request. Each arm got a fresh copy of the repo and a fresh hub. Pair 1's arms ran in parallel, and pairs 2 and 3 ran serially. Two arms were discarded because the launcher had written earlier runs' decision records into a shared `--cwd` copy. A third was discarded because it was stopped at launch when that was found. All three are listed in `summary.json`.

The oracle passes (`ok`) when the main room concluded, its conclusion states both decisions, it cites `src/hub.ts:62`, and it names a script that really spawns a claude/codex seat or binds a port. `anywhere_ok` is the lenient version: both answers appear in some concluded room of the run.

| Arm | Pair | ok | anywhere_ok | Linked child rooms | Carried to parent | Seats that ran | Cost USD | Model turns | USD/turn | Hub calls (room ledger) | All tool calls | Minutes to main conclusion |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 1 | no | yes | 0 | 0 | 2 | 9.468 | 50 | 0.1894 | 57 | 73 | 2.5 |
| base | 2 | no | yes | 0 | 0 | 4 | 11.972 | 78 | 0.1535 | 74 | 111 | 1.7 |
| base | 3 | no | yes | 0 | 0 | 2 | 6.066 | 40 | 0.1516 | 41 | 57 | 1.5 |
| head | 1 | yes | yes | 2 | 2 | 2 | 8.245 | 43 | 0.1917 | 57 | 74 | 2.1 |
| head | 2 | yes | yes | 2 | 2 | 2 | 13.040 | 65 | 0.2006 | 69 | 92 | 3.7 |
| head | 3 | no | yes | 0 | 0 | 2 | 7.653 | 50 | 0.1531 | 41 | 66 | 1.1 |

In base pair 2 the worker recruited two seats on its own (`request_agent`, into its D2 room) to challenge and verify its proposal there, since the verifier sat in the main room. Their traces (17 model turns each, uncached) are counted in turns, calls and cost. Recruits have no usage sidecar, so their billed cost is the last `cost-state` row of each Claude trace (2.349 + 2.301 USD). For the launched seats, that row equals the sidecar exactly. The recruits were first left out of the totals; 6-astra-6's audit caught it (review/breakout-metrics-astra6) and recovered the receipts.

Outcome: the main room stated both decisions in 2 of 3 head runs and 0 of 3 base runs. Every run found both answers somewhere.

- In base, the seats decided one question in the main room and the other in a separate room, and nothing brought the second result back. In base pair 1 the seat opened a third room for the combined statement.
- In the head runs that used `parent`, both children's conclusions landed on the parent board, and the parent's final proposal stated both.
- Head pair 3 opened its child room without `parent` and ended like base. The affordance was used in 2 of 3 runs, not always.

Cost and time, stated plainly:

- Mean cost rose from 9.169 to 9.646 USD (+5.2%).
- Cost per model turn rose from 0.1637 to 0.1832 USD.
- Mean model turns fell from 56.0 to 52.7. Mean tool calls in traces fell from 80.3 to 77.3, and hub calls from 57.3 to 55.7.
- Mean time to the main room's conclusion rose from 1.9 to 2.3 minutes, a regression.
- Head pair 2, the slowest and dearest run (3.7 min, 13.04 USD), did the brief's last step: a combined final proposal in the parent, which base runs skipped.
- At n=3 per arm, the cost and time differences are within run-to-run spread.

## What this does not show

- Spontaneous formation. The brief forces a split. (Spontaneous recruitment did happen once, in base pair 2, see above.) In our own 9-seat room (on the 7717 hub, without this change), nobody opened a breakout. Scope negotiation between four seats about overlapping claims ran in the main room and in quiet threads.
- Larger rooms. Every arm launched two seats (below the three-seat dev-room size used in this run); one base arm grew to four through its own recruits.
- The historical picture is descriptive only. In data/swarm-181144-uxtr-room.jsonl, each worker seat received 157 to 203 public chat messages (64 to 81 KB) that were neither from nor addressed to it. In that run's owner-prompted steer room, the same seats received 9 to 12 such messages. These are two different phases of one run, not a counterfactual saving.
