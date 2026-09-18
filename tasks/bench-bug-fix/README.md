# Inclusive UTC date repair (draft-2 v3)

Only `public/` is copied into a seat's workspace. `public/dates.ts` and
`fixtures/broken/dates.ts` are identical: the planted defect is `t < e`.
`fixtures/correct/dates.ts` changes only that comparison to `t <= e`.
Both versions validate both endpoints by UTC round-trip and reject reversed
ranges with `Error('invalid date range')`.

The private `oracle/score.ts` imports the workspace's `dates.ts` and checks the
nine frozen cases. It emits deterministic JSON `{score, oracle_results}` with
named exit codes (0 pass / 1 fail). CLI exit is 0 for success, 1 for a failed or
missing code artifact, 2 for missing arguments. No clock, random or network is
used by the oracle. Process timeout and infrastructure classification belong to
the harness. Invalid artifact code is not treated as a successful chat answer.

Independent fixture commands (from repository root, no hub or ports needed):

```sh
node --import tsx tasks/bench-bug-fix/oracle/score.ts tasks/bench-bug-fix/fixtures/broken
# exit 1; 5 of 9 fail
node --import tsx tasks/bench-bug-fix/oracle/score.ts tasks/bench-bug-fix/fixtures/correct
# exit 0; 9 of 9 pass
node --import tsx --test scripts/oracle-tasks.test.ts
```

Path separation is NOT a security sandbox. Seats and untrusted submitted code
need external filesystem/process isolation; the current local harness does not
prevent a seat from reading outside its workspace or modifying evaluator state.
