# Guarded-call refusal telemetry

Run the regression with `npx tsx scripts/refusal-telemetry.ts`. It connects an
in-process MCP client to the real guard and uses disposable JSONL logs.

`Hub.stats(room)` (also `GET /rooms/:room/stats`) adds:

- `call_outcomes`: tool → `{success, hub_refusal, error}` completion counts.
- `refusal_rates`: tool → `hub_refusal / (success + hub_refusal + error)`, or
  `"unknown"` without complete denominator coverage.
- `refusal_rate_coverage`: `"complete"` for versioned room logs, otherwise
  `"unknown"`. An unseen tool is absent, not a measured zero.

The existing `refusals` map remains string → number, preserving old entries.
New entries use `<tool>: hub_guard`. This deliberately coarser reason class
replaces error-message prefixes, which can contain submitted text or secrets.
The rate numerator comes **only** from completion events, not `refusals`.

## Population and coverage

The measured population is **completed MCP guard invocations associated with
an existing room at completion**. `from_room` is used for cross-room tools.
Successful `join_room` is included. Pending/crashed calls, MCP input-schema
rejections before the guard, direct Hub/HTTP calls, roomless calls (such as
`list_rooms`), and failed creation of nonexistent rooms are excluded. This is
not a rate of every request the server receives or every hub operation.

New room events carry `telemetryVersion: 1`. Old room logs lack a known start
of denominator coverage: their rates remain `"unknown"`, even after new
completion events are appended. Their available completion counts are still
shown. No historical refusal count is mixed into a new observation epoch.
Replay reconstructs both counters and coverage without appending events.
A crash between a refusal and completion write can leave an unmatched refusal;
it does not enter the rate numerator. Persisted logs assume one append-only
writer, as before; disk failures are not converted into valid observations.

## Internal event schema and privacy

Each guard exit adds `{type: "call_completion", room, tool, outcome, ts,
participant}`. A HubError also adds the existing `refusal` event, now with ISO
`ts` and `participant` fields. The latter fields are optional when reading old
logs. `outcome` is `success`, `hub_refusal`, or `error`.

`participant` is the internal id authenticated against connection-owned ids,
not a submitted id taken on trust. It is `null` for unjoined, forged, or
ambiguous identities. Successful joins use the issued actor; departures retain
the pre-call actor. Public telemetry stats contain no actor ids or session keys.
No tool argument bodies, raw error text, message text, or session keys are
retained in these telemetry records. Existing message/join events are unchanged;
this is not a redaction migration of historical logs.
