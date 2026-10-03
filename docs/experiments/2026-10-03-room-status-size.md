# room_status size (2026-10-03, swarm-181144-uxtr, issue 2)

`room_status` returned the agent-facing `Hub.summary`. In swarm-205033-6bp8 its 7 calls were 177,831 B, 19% of all hub
bytes in the traced seats, with each result 14-31 KB. The fields per call were the open proposal at 10.6-13.2 KB (text 6.7k,
challenges 2.6k, votes 2.0k, blocked_by 1.6k), the room topic at 6.8 KB on every call, the board manifest at 2.1-3.7 KB,
and participants at 2.3-3.5 KB, each carrying its last shell command (up to 300 chars).

Change (`src/hub/status-view.ts`, applied by the room_status tool only):
- The topic is cut to 240 chars plus "(N chars; room_status full_topic=true carries it whole)". room_status(full_topic=true), join_room and list_rooms keep it whole.
- `working.detail` is cut to 80 chars.
- Each board entry keeps `{by, reviewer, post_reveal}`.

Proposals, votes, challenges, liveness, claims and the conclusion are untouched. The open proposal is what seats call
room_status for: wait omits an unchanged proposal text and points here. The human dashboard (reveal) is untouched.

## Replay (same recorded results, compact JSON before and after)

`npx tsx scripts/room-status-replay.ts swarms/swarm-205033-6bp8/*.events.jsonl` (file, recorded, compact JSON as on main
cd7466e7, after):

```
6-astra-3.events.jsonl	27015	23805	15415
6-astra-3.events.jsonl	29573	26062	17397
6-astra-3.events.jsonl	29449	25938	17398
6-astra-3.events.jsonl	30935	27263	18254
6-astra-4.events.jsonl	14230	12280	4322
6-astra-4.events.jsonl	14999	12839	4613
6-astra-4.events.jsonl	31630	27886	18723
calls 7	recorded 177831 B	compact 156073 B	after 96122 B	(-38.4% vs compact, -45.9% vs recorded)
```

All room_status calls in this checkout's swarms/*:

```
calls 8	recorded 222458 B	compact 196925 B	after 130734 B	(-33.6% vs compact, -41.2% vs recorded)
```

## Checks

- `scripts/room-status-size-regression.ts` fails at cd7466e7 ("topic cut: 5419") and passes at a17bb46e (4,304 B).
- Dev room swarm-193125-bf16 (3 opus seats, a17bb46e build): from one room_status call, seat -2 reported the topic
  opening, the claim owner and reviewer, the open proposal's id and exact text, and seat -1's current tool and step.
  It noticed the cut topic ("721 chars; list_rooms carries it whole" in the a17bb46e wording; the landed wording points to room_status full_topic=true) and needed nothing else.
- Not measured: live token effect. The saving is bytes per room_status call, and how often seats call it varies by
  run (7 calls in swarm-205033-6bp8, 0 in swarm-170811-k1pq).
