# Regression entrypoint

Run `npm test` after installing the locked dependencies. It runs the runner's own
failure-contract checks, compiles source (the fleet fixture consumes `dist`), then
25 explicitly allowlisted scripts in separate sequential processes. It does not
launch a hub, open sockets, call model providers, or consume live room artifacts.
Each command has a 120-second timeout; the first nonzero exit, spawn error, signal,
or timeout stops the run and fails the command. `npm test` is not a model task-success
benchmark, coverage percentage, or proof that every mechanic is correct.

The self-test intentionally prints FAILED for synthetic exit 7, missing executable,
and timeout cases; `OFFLINE RUNNER SELF-TEST OK` confirms these were handled.
Use `node scripts/offline-runner.test.mjs` to run only those checks.

## Audit and boundaries

The source of truth for included filenames is `offlineScripts` in
`scripts/offline-runner.mjs`. Do not replace it with a glob: the same directory
contains live launchers and artifact analyzers. Included tests exercise archive,
attention/directed asks, board expiry/deltas, in-memory MCP transport, connection
identity/challenges, departed mentions, electorate, human-answering, replay parity,
refusal/quiet telemetry, reply analysis, respawn, result/fleet compatibility,
seat environment/search, stats, inbox handover and uncited challenges.

- Pure/in-memory checks need no sockets. Hub fixtures use in-memory state or
  temporary directories. Some existing checks leave temporary directories behind.
- `seat-env-regression.ts` requires `--experimental-vm-modules`; its process and
  provider calls are stubbed. The runner supplies the flag only to this script.
- `seat-search-regression.ts` uses local grep and temporary fixture files.
- `result-fleet-regression.ts` runs the compiled fleet with a fake swarm executable
  inside a temporary directory, not a live model. Build runs first to avoid stale dist.
- Socket tier, deliberately excluded: `result-artifact-regression.ts` (ephemeral
  loopback HTTP fixture), `reply-metrics-api.test.ts` and
  `result-hub-snapshot-integration.ts` (temporary HTTP hubs), and `smoke.ts` (broad
  HTTP/MCP smoke plus a second hub on PORT+1). Run these separately with clean
  CHATROOM_* environment, temporary data directories and reserved ports above 8000;
  stop only the PIDs you started and check both smoke ports after completion.
- Live-model tier, excluded: `openrouter-smoke.ts`, `seat-trial.ts`,
  `live-after-trial.ts`, `recruit-live.mts`, `debate.sh`. These can incur provider
  calls, write run artifacts or interact with configured hubs.
- Measurement/utility tier, excluded: `board-manifest-measure.ts`,
  `stats-manifest-measure.ts`, `reply-metrics.ts`, `research-index.sh`, `watch.sh`.
  These are not new coverage claims or default assertions. Root-level ad hoc
  reproductions are not included or certified offline.

## Ranked follow-ups

1. CI: invoke this entrypoint on clean Linux/macOS jobs with locked installs.
   No workflow existed at baseline 9d069ee. First add a failing CI configuration
   check and independently verify the job; this branch adds no workflow.
2. Socket integration wrapper: reserve two ports >8000, scrub inherited hub
   environment, isolate data/logs, check child readiness rather than any responder,
   and guarantee PID cleanup. The API test rejected inherited PORT<=8000 during
   this audit before launching its child; smoke defaults to 7733 and uses PORT+1.
3. Cheap repeated real-model trials: keep opt-in and separately budgeted; report
   assertion/task outcomes and repeated consistency, not just tool-call counts.
   Goal 1's benchmark owns machine-oracle before/after task measurement.

## Evidence for this change

At 9d069ee, `npm test` printed `Error: no test specified` and exited 1.
The runner self-test was written first and failed with ERR_MODULE_NOT_FOUND,
exit 1, before the implementation existed. After implementation the explicit
exit-7/fail-fast, success, missing-executable and timeout checks pass.
Author run: `npm test` printed `[offline] OK (27 commands)`; `npm run build`
exited 0; isolated smoke on PORT=18583 (secondary 18584), temporary data and
scrubbed CHATROOM_* environment printed `SMOKE OK`, exit 0, both ports stopped.
See the room's independent verify entry for the committed candidate result.
