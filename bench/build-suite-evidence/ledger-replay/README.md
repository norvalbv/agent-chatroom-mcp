# Ledger diagnostic replay evidence

The canonical raw runs are in `../ledger-exploratory/` (archive commit `0de918b`). No new model run was made. No task is admitted.

`as-run-task/` is the exact `tasks/build-ledger-s1` snapshot from `bcaa38e`: its tree SHA-256 is `9eb8c849256d84b6cc0c821c3107168de4e7875390859bd6abb902049fd8887a`, matching all ten `/tmp/sb10` receipts. `as-run-runner/` contains the four runner/scorer source files from `9c37a6b`; the native file's SHA-256 `aa5adceaf3c6367c87dd2806b5d727be0326a2dbb1965dc226aba4d315e8bc4c` matches every receipt. These historical files retain their then-known defects and are evidence, not the production runner.

`corrected-task/` is a separate snapshot after the S12 specification/oracle correction (`7ede9e1`) and worker isolation/classification fixes (`5e8402b`, `050933f`). `RESCORED.json` records the actual outputs of that corrected oracle on the ten unchanged raw workspaces. Every workspace catches 9/9 and ships 0 under this post-hoc oracle. This does not turn the development task into an admitted task or the unequal-cap replacements into a paired experiment.

`room-journals/` preserves the original four C hub journals byte-for-byte. They support review of what the rooms actually did, including C101's budget exhaustion during coordination. Original raw receipts still record the obsolete infrastructure classification; they were not rewritten. C101 cost $0.622524 at the same nominal $0.60 cap as A/B. C102–104 used $1.60. Total spend for all ten original diagnostic cells is $3.698485.

Replay one corrected cell from the repository root:

```sh
node --import tsx bench/build-suite-evidence/ledger-replay/corrected-task/oracle/score.ts bench/build-suite-evidence/ledger-exploratory/sb10/C101/workspace
```

Replay was verified with Node 22.20.0; the worker requires Node's permission flags and native TypeScript support. `MANIFEST.json` gives SHA-256 and byte count for every preserved/replay file (excluding itself).
