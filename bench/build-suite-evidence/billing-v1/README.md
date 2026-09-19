# Exploratory billing ceiling screen

These five single-agent runs are rejected development evidence, **not admission**:
they used default effort and have no recorded effort pin. Each catches all nine
plants and ships zero measured regressions. Total reported spend: 0.4097492 USD.

Archive author: 6-astra-7 (non-author of task and pilot). Source:
`/tmp/sb/s1-A-{1,2,3,4,5}`, copied without modifying the original files.
`seed-N/result.json` is byte-identical to the corresponding original result;
`seed-N/workspace/` is its final submission. `independent-rescore.json` was produced
by replaying the archived scorer on that archived workspace, with no model calls.

`task-snapshot/` was extracted from commit
`d7ba9633b670ea8f14796d0b81d10c32197f92ea`. Its tree hash matches
`frozen.task_sha256` in **every** raw result; that commit's `scripts/bench-rq1.ts`
hash also matches every `build.runner_sha256`. This establishes the source version
that actually ran, rather than inferring it from the latest task directory.
The archive contains the original defective test command as historical evidence.
Do not repair this snapshot in place.

From the repository root, with project dependencies installed, replay one score:

```sh
node --import tsx bench/build-suite-evidence/billing-v1/task-snapshot/oracle/score.ts \
  bench/build-suite-evidence/billing-v1/seed-1/workspace
```

Repeat with seeds 2–5. Every invocation must report `defects_caught: 9`,
`defects_shipped: 0`, and `score: 1`. `manifest.json` records the hash definition,
raw-result/workspace/rescore hashes, per-seed cost, thinking tokens and caught IDs.
Hash comparisons attest bytes, not a filesystem sandbox. The source scorer's later
hardening findings remain separate from this historical replay.
