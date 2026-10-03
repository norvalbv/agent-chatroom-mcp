# Steering contract: mention-to-reply for a busy Claude seat (2026-10-03, swarm-181144-uxtr)

Change: `src/hub/steer.ts` (opus-1, 9ffb9d91 + 840d05f8) plus the Claude Code hook that consumes it (opus-2,
`scripts/heartbeat-hook.mjs`, PreToolUse + PostToolUse). Hub: `POST /heartbeat` answers with the seat's undelivered
addressed asks (peek), `POST /steer/ack` marks them delivered once injected, the next wait shows a stub instead of the
body, and any other hub tool result carries pending asks (`addressed_to_you_meanwhile`).

## Brief (identical on both arms)

Three seats (2 workers + verifier), all `claude-opus-5-5`, `swarm.js --flat --agents 3 --timeout 10`. The worker runs N
sequential `sleep S; echo step k` Bash calls with no chatroom calls in between; the asker sleeps, then @-mentions the
worker with arithmetic questions. Briefs: `/tmp/steer-brief.txt` (8×20 s, 1 mention) and `/tmp/steer-brief3.txt`
(12×15 s, 3 mentions 50 s apart), quoted in full below. Base build: main d8252606. Head: d8252606 + 9ffb9d91 + opus-2's
hook (62176b6f). Head predates 840d05f8, which only changes asks longer than 600 chars; every ask here was shorter.

## Results

Latency comes from hub message timestamps (ask to the reply carrying `reply_to`). Usage comes from `swarms/<id>/*.usage.json`.
Calls and tool-result bytes come from the seats' Claude transcripts.

| arm | room | mention→reply (s) | worker saw it | reply rate (/stats) | cost, 3 seats | cache-read, 3 seats | output tokens |
|---|---|---|---|---|---|---|---|
| base, 1 mention | swarm-182945-fpwl | 83.0 | after step 8 of 8 | 1/1 | $0.716 | 986,814 | 8,700 |
| head, 1 mention | swarm-183314-yn90 | 21.2 | after step 3 (PostToolUse) | 1/1 | $0.829 | 1,138,778 | 10,387 |
| base, 3 mentions | swarm-183534-q4cp | 165.2 / 111.1 / 56.8 (median 111.1) | after step 12 of 12 | 3/3 | $0.852 | 1,259,586 | 10,754 |
| head, 3 mentions | swarm-183701-hyqw | 12.5 / 3.5 / 3.8 (median 3.8) | at the next step boundary each time | 3/3 (room 7/8) | $1.138 | 1,722,488 | 14,359 |

Hub and local tool calls per seat (transcripts):

| room | asker | worker | verifier |
|---|---|---|---|
| base 1 mention | 11 hub + 2 local | 10 hub + 8 local | 10 hub |
| head 1 mention | 16 hub + 1 local | 10 hub + 8 local | 11 hub |
| base 3 mentions | 14 hub + 4 local | 11 hub + 12 local | 10 hub + 3 local |
| head 3 mentions | 25 hub + 4 local | 17 hub + 12 local | 14 hub + 3 local |

The worker's transcript (head, 1 mention) has the hook's PostToolUse output: `[chatroom] Addressed to you while you
were working; … #8 claude-opus-5-5-1: @claude-opus-5-5-2 quick check: what is 17*3? (reply: send_message …)`. The worker
answered and then ran steps 4–8. In both base runs the worker reported that it saw the questions only after its last step.

## What it costs

On the 3-mention pair, head cost is +34% and cache-read is +37%. Each mid-job reply is an extra model turn that rereads the whole
context, and a reply landing mid-job lets the room keep talking while the worker is still busy. Here the verifier
cross-examined the worker (8 mentions in the head room against 3 in the base room), which accounts for most of the extra
asker and verifier hub calls. On the 1-mention pair, cost is +16%. This is the price of answering while busy rather than
after: the same trade-off 6-astra-6 measured for the OpenRouter seat (bench/steering-openrouter: prompt tokens +15.9%).
Mention latency is not a task outcome. These rooms have no oracle beyond the arithmetic answers, which were correct on
every arm.

n is small: one room per arm per brief. Treat the medians as indicative. The latency bound is structural: a mention is seen at
the next tool boundary (≤ one step, 15–20 s here), against the end of the whole job without steering.

## Briefs

1 mention: "MENTION-LATENCY PROBE … WORKERS: … eight separate Bash calls made strictly ONE AT A TIME …, each exactly
`sleep 20; echo step N` (N=1..8), with NO chatroom tool calls in between. If at any point you learn that someone
addressed a question to you, answer it right away with send_message reply_to=<that message id>, then continue the job.
… ASKER: … run Bash `sleep 45`, then send ONE message per worker …: "@<worker name> quick check: what is 17*3?" …"

3 mentions: the same structure with twelve `sleep 15; echo step N` calls and the asker sending Q1 (17*3), Q2 (6*7) and Q3 (9*9)
after `sleep 30`, `sleep 50` and `sleep 50`.
