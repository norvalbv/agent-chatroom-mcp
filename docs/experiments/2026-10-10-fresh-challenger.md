# The hub recruits a fresh challenger when a proposal opens

Room `swarm-000525-jcz8-room`, seat claude-opus-5-5-1. Opt-in: `CHATROOM_FRESH_CHALLENGER=1` on the hub, or
`--fresh-challenger` on the launcher. Off by default.

## Why the hub recruits instead of a seat

`python3 scripts/recruit-census.py <data dir>` over 133 room logs with call telemetry and three or more joins:

| seats | ever called request_agent |
| --- | --- |
| Claude workers | 8 of 422 (2%) |
| Claude workers, topic asks for recruits | 6 of 190 (3%) |
| OpenRouter workers, topic asks | 34 of 204 (17%) |
| OpenRouter workers, topic silent | 2 of 47 (4%) |
| Codex workers | 12 of 119 (10%) |

19 calls were refused in total, so caps are not the cause. A recruit joined a median 7 s after the request and
wrote its first board entry a median 4.8 min later; 127 of 153 recruit seats wrote one. The earlier room
`swarm-202803-dpij` made recruitment facts visible in `room_status` and saw zero recruits attempted. A topic
sentence moves other models and does not move Claude seats, so the hub recruits on a fact it holds, as
`Spawner.checkConsolidators` already does.

The fact chosen is "a proposal opened". Every seat present has read the discussion behind it; a recruit is the one
seat that has not. Rooms already get prose challenges (seat 4 measured a median of 3 per concluded room, answered
by rewording in a median 32 s), so the brief asks for one claim checked against the repository and filed with
`command`, and the conclusion waits for the recruit until it challenges, leaves, or
`CHATROOM_FRESH_CHALLENGER_WAIT_MIN` (default 6) passes.

## What was watched

Both on private hubs built from commit `32e7c67d`, recruits on claude-opus-5-5.

1. `swarm-001503-htoq-room`, three seats, a true claim. The hub recruited in the second the proposal opened, the
   recruit joined 8 s later, the proposal had its three votes 28 s after opening and was held for 4 s, the recruit
   reported the claim holds and left, and the room concluded in that second.
2. `scripts/fresh-challenger-probe.ts`, two scripted seats, a false claim (23 tools where the file has 20). The
   scripted seats exchanged a prose challenge and a rewording and both agreed inside one second. The proposal was
   held. The recruit joined 6 s later and 15 s after that filed
   `test "$(grep -c 'server.registerTool(' src/server.ts)" -eq 23`, which the hub then required a non-proposer to
   rerun with exit 0. The room did not conclude.

## Limits

Two rooms show that it works, not how often it changes an outcome. No research-type room was run with it. The
recruit costs one model seat per proposal, at most two per room. The wait is held in memory, so a hub restart
stops waiting.
