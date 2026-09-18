# r1-proactive-handoff

Proactive handoff on context pressure (R1, lobby list): a seat that is still holding work
hands off cleanly instead of running into its cap and dying (or being trimmed into context
loss). Build: swarm-010513-crup-r1-build.

## Evidence basis (verify/context-pressure-logs, swarm-214936)

- Seats that handed off left cleanly at 90-130 steps / 2.96-5.86M prompt tokens.
- The three seats that never left (203-411 steps, 10.9-18.9M tokens) all died in the
  provider withdrawal.
- At ~45k prompt tokens/step the 6M cap binds near 130 steps: inside the clean-exit
  cluster and far before the 203+ death zone. The step fraction is the backstop for
  providers that report no usage.

## Thresholds (src/seat.ts, all configurable)

The seat accumulates per-step `usage` (already summed for prompt/completion tokens) and
checks, at the top of each loop iteration BEFORE `trim()` would drop turns:

- `steps >= handoffStep`, default `max(1, min(ceil(0.75*maxSteps), maxSteps-1))`
- OR cumulative `prompt_tokens >= 6_000_000`
- OR transcript `size() > 0.9 * maxContextChars`

`handoffStepMax` overrides the fraction (lobby test spec: handoffStepMax=8, maxSteps=600).

## Handoff flow (best-effort; failure must not block leaving)

1. `board_get` manifest per joined room; find `claim/*` whose `by` == this seat's name.
2. `board_set handoff/<area>` (what is done / where / what is undone).
3. `leave_room` with reason naming the handoff areas; terminate MCP session.
4. `SeatResult` gains `handoffs: string[]` and `handedOff: boolean`; `ok` stays true.

`bow()` (budget, provider error, SIGTERM, finished-without-leaving) also writes
handoffs first, so claims are never orphaned on involuntary exits — leave_room's
one-refusal for orphaned claims (hub.ts leaveRefusal) self-resolves.

## Knobs / flags / env

`--handoff-step-max N`, `--handoff-step-fraction F`, `--handoff-prompt-tokens N`,
`--handoff-context-fraction F`, `--no-handoff`; env `SEAT_HANDOFF_STEP_FRACTION`,
`SEAT_HANDOFF_PROMPT_TOKENS`, `SEAT_HANDOFF_CONTEXT_FRACTION`, `SEAT_NO_HANDOFF`.
Opt-out is explicit because the step guard can fire on seats whose provider omits usage.

## Verification

`scripts/handoff-regression.ts` (synthetic provider, throwaway hub, no network):
scenario A handoff at 9/12 (fraction), scenario B at 8/600 (handoffStepMax);
asserts handoff/* board event by the seat after its claim, leave reason /handoff/i,
leave after handoff, result.steps < maxSteps, result.handoffs non-empty.
