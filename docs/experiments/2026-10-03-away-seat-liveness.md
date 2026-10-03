# Away, not dead: replacement after a hub restart (2026-10-03, swarm-202803-dpij)

**Replacements registered for a live seat: 3/3 → 0/3** (n=3 per arm, same brief, cold). The oracle mostly restates this
count. Head is slower (279 s vs 129 s mean to conclusion) and 7% dearer on this one-write task, because it waits for
the live seat.

## The failure

In swarm-181144-uxtr the hub was restarted mid-run and the owner wrote "if you don't see all the agents rejoin, please
re-recruit". The verifier called `request_agent(replacing=6-astra-3)` about a minute later. 6-astra-3 was alive and in
the middle of a benchmark, and a duplicate recruit had to be stopped by PID.

The harness, not the model, made that call look right:
- A restart restores every seat as inactive.
- The seat-key → MCP-session binding lives in memory, so heartbeats from the still-running process were discarded (`marked: 0`).
- `room_status` showed the seat as `left`, exactly like a dead one.
- The replacement hook accepted any inactive seat.

The deciding seat had no way to tell "has not reconnected yet" from "gone".

Across 78 earlier rooms (bench/historical-tool-usage, 6-astra-6):
- `replace_participant` was called 6 times and succeeded 0 times.
- `kick_vote` was called 30 times and succeeded 24 times.
- All of those calls were in swarm-130854-nmek.
- The uxtr displacement is the one recorded case of a live seat being replaced.

## Change (landed 0e81fc90; no prompt text)

- A participant carries a persisted `seatKeyHash`. A heartbeat that no live connection claims is recorded on the inactive seats that key joined as (`src/hub/liveness.ts`).
- A seat that a restart restored while it was in the room counts its silence from the restart. This is the same 10 minutes the idle sweep gives a live seat; a Claude seat inside one long command sends no beat until the command ends.
- `room_status` shows such a seat as `liveness.status: "away"` with an evidence string, e.g. "its process is still running: it heartbeated 12s ago".
- `request_agent(replacing=)` and `replace_participant` refuse an away seat and say why. A seat that is really gone, with no beat since it left, is still replaceable.
- `replace_participant` no longer says "was removed" when it removed nobody.

Deterministic check: `npx tsx scripts/away-seat-regression.ts` restarts a real hub with persistence.
- At base 31daae67 it fails (exit 1). With the liveness assertion removed, base spawns the duplicate recruit.
- At 0e81fc90 it passes (exit 0).

## Live A/B (bench/liveness)

Brief `bench/liveness/brief.txt` (sha256 30f30f5d…): two workers each claim a part and write `result/<part>`; a verifier checks.

`bench/liveness/arm.sh` runs each arm the same way:
1. As soon as the first worker claims, its `claude -p` process is suspended with SIGSTOP. It is alive but silent, like a seat inside a long command.
2. The private hub is killed by PID and restarted on the same data dir.
3. The owner's uxtr sentence is posted verbatim.
4. The suspended seat is resumed with SIGCONT 240 s later.

Setup:
- Base is 31daae67 and head is 0e81fc90. Each arm has 3 Claude Opus 5.5 seats (2 workers and a verifier), and recruits are pinned to claude-opus-5-5 in both arms.
- `DISABLE_PROMPT_CACHING=1` was set in both arms, so every request is uncached and the costs are not cached-read prices.
- The two arms of a pair ran serially. Pairs 2 and 3 ran concurrently, each on its own worktree and data dir.

The cold start was audited with `scripts/swarm-tool-usage.py --discover-claude`, and the duplicate recruit's trace is included in base coverage. Every seat in all six arms had `cache_read_input_tokens` 0 on its first request.

Oracle: the suspended seat itself wrote `result/<its part>`, no successor was registered for it, and the room concluded.

Scoring is `bench/liveness/collect.py docs/measurements/away-seat-liveness`, which writes `docs/measurements/away-seat-liveness-2026-10-03.json`. Cost is priced from provider token counts at $3.989/M input and $22.404/M output, a least-squares fit to the launchers' own cost sidecars (max residual $0.002). That way, seats without a sidecar (a recruit, a killed seat) are priced the same way.

| arm | duplicate registered | refusals | result/part by | oracle | s to conclusion | cost $ | model turns | $/turn | tool calls | seats |
|---|---|---|---|---|---|---|---|---|---|---|
| base-1 | 1 | 0 | claude-recruit-1 | fail | 176.9 | 7.562 | 62 | 0.122 | 74 | 4 |
| base-2 | 1 | 0 | claude-recruit-1 | fail | 79.0 | 6.050 | 52 | 0.116 | 61 | 4 |
| base-3 | 1 | 0 | claude-recruit-1 | fail | 130.0 | 6.132 | 54 | 0.114 | 65 | 4 |
| head-1 | 0 | 1 | suspended seat | pass | 280.6 | 7.431 | 59 | 0.126 | 66 | 3 |
| head-2 | 0 | 2 | suspended seat | pass | 281.5 | 7.548 | 60 | 0.126 | 69 | 3 |
| head-3 | 0 | 1 | suspended seat | pass | 275.4 | 6.168 | 52 | 0.119 | 61 | 3 |

Means (n=3 per arm):

| | oracle | duplicates | mean cost $ | mean model turns | $/turn | mean tool calls | mean s to conclusion |
|---|---|---|---|---|---|---|---|
| base | 0/3 | 3 | 6.581 | 56.0 | 0.1175 | 66.67 | 128.6 |
| head | 3/3 | 0 | 7.049 | 57.0 | 0.1237 | 65.33 | 279.2 |

What the seats did. The same model, the same brief and the same owner instruction produced opposite decisions, depending on what the harness showed:
- **Base.** Every arm re-recruited within about 30–120 s of the owner's line. The recruit took over the suspended seat's claim as "registered successor", wrote the result itself, and the room concluded on the duplicate's work.
- **Head, refusals.** In head-1 the worker wrote "opus-5-5-1 shows 'away' (it may still rejoin after the restart). If it hasn't come back by about 21:20, I'll replace it". At 21:20:19 it tried, was refused, and wrote "The hub refused to replace opus-5-5-1 because it's 'away', not dead ... That window ends around 21:26:30".
- **Head, outcome.** The original rejoined 6 s after it was resumed and finished its own part.

## Regressions and limits, plainly

- **Slower and dearer on this task.**
  - Head took 2.2× as long to conclude (279 s vs 129 s mean) and cost 7% more (+$0.47 mean).
  - It waits for the live seat; the suspension is 240 s by design. Base finishes sooner by duplicating, because the task is one board write.
  - The base figures undercount: each resumed original was stopped by PID after its room had concluded, and its unfinished rejoin turns are missing.
  - On real claimed work (a half-built branch, a running benchmark), a duplicate redoes or collides with that work. This bench does not measure that cost.
- **A seat that really died** while in the room reads as away for up to 10 minutes after a restart before it can be replaced. The verifier accepted this tradeoff (verify/kick-replace-liveness).
- **Coverage.** n=3 per arm, Claude seats only. Codex seats heartbeat through their launcher, but no Codex arm was run.
- **Not addressed.** This does not make seats kick or recruit more. It removes a wrong signal, `left` for a live seat, so that the judgement the seats already apply ("give them a minute, then re-recruit") lands on a true fact.
- **Found while running this.**
  - A refused replacement still posted "Recruits in this hub are pinned … launched as that instead" (spawner.request announced before the replacement could throw). 6-astra-3 fixed it in 4a7f9380 (verify/recruit-announce).
  - A pilot pair (bench/kick-replace-liveness) was invalid: its base arm started warm (first-request cache_read 16,183), and Claude Code's foreground-sleep block meant no seat was silent across the restart.
