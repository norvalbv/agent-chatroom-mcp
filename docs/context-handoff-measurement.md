# R1: proactive handoff on context pressure — thresholds and harness measurement

Build: branches `swarm/swarm-010513-crup-r1-build/openrouter-recruit-8` (seat.ts core, commit 751beff)
and `swarm/swarm-010513-crup-r1-build/openrouter-recruit-7` (fixture + sidecar, this doc). Base c0cf5a3 == main.

## Thresholds (src/seat.ts, grounded in verify/context-pressure-logs)

Evidence: seats that handed off left cleanly at 90-130 steps / 2.96-5.86M prompt tokens; the three seats
that never handed off died at 203-411 steps / 10.9-18.9M tokens in the provider withdrawal. Defaults:

- `steps >= ceil(0.75 * maxSteps)` — hand off at 75% of the step budget so a replacement still has room
  (knob `--handoff-step-fraction`, env `SEAT_HANDOFF_STEP_FRACTION`).
- cumulative `usage.prompt_tokens >= 6_000_000` — at ~45k prompt tokens/step this binds around step 133,
  inside the 90-130 clean-exit cluster and well before the 203-411 death zone
  (`--handoff-prompt-tokens`, `SEAT_HANDOFF_PROMPT_TOKENS`).
- transcript `size() > 0.9 * maxContextChars` — checked BEFORE `trim()` so turns are never silently dropped
  while working (`--handoff-context-fraction`, `SEAT_HANDOFF_CONTEXT_FRACTION`).
- `--no-handoff` / `SEAT_HANDOFF_OFF` disables; step guard remains as fallback for usage-silent seats.

On pressure: best-effort `board_get` manifest per joined room -> for every `claim/*` owned by this seat,
`board_set handoff/<area>` (what done / where / what undone) -> `leave_room` with reason naming the
handoffs -> terminate with `ok=true`. `SeatResult` gains `handoffs[]` + `handedOff`. `bow()` (step cap,
budget, provider error, signal) also writes handoffs first, so the cap path never orphans a claim.

## Harness measurement (this room's mandate; runner features pending-r9.1)

Per lobby inbox `r1-harness-split`, `scripts/bench-bench.ts` is R9.1's (`claim/goal-4-hash-closure`):
per-arm `max_steps` env override and the survival verdict (handoff/* count, seat exit 0, leave_room
reason read from the arm's own data dir) fold into their probe spec. This room therefore delivers the
measured parts that do NOT touch the runner:

1. `scripts/handoff-regression.ts` (recruit-8): synthetic scripted provider + throwaway hub; RED on main
   (seat hits the step cap without any handoff), GREEN on the build (steps=9/12, handoffs=[long-brief],
   ok=true). That is the before/after on the same task, offline and cheap.
2. `tasks/bench-long-brief` (recruit-7): long-brief fixture — 20 files / 800 records / ~785KB, each file
   over the 400-line read window; provably over the frozen budget (40 reads x 6000-char clamp >
   0.9 x 240k context, min 62 turns > 60 steps). `oracle.json` kind `handoff`: no answer expected, the
   measured outcome is the survival verdict. Brief mandates `board_set claim/bench-long-brief` first so
   the handoff/* entry is deterministic.
3. Seat-side sidecar `src/seat-handoff-report.ts`: `handoffMarkerLine(SeatResult)` -> one
   `[seat-handoff] keys=... reason=...` line on the seat's stdout when `handoffs[]` is non-empty
   (normalises area names to the `handoff/` keys actually written); empty on baseline. bench-bench
   routes seat stdout into the arm's `hub.log`, so the harness/verifier reads it from there.

Survival verdict to be checked against the arm's own data dir: seat exit code 0 AND >=1 `handoff/*`
board event AND a `leave_room` reason naming the handoff. Runner-side enforcement in bench-bench =
pending-r9.1; this room's `verify/context-handoff` records the before/after numbers from throwaway hubs.
