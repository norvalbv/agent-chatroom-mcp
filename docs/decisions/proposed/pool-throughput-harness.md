# Proposed decision: pool-throughput-harness

From swarm-125917-q12c (concluded); report: swarms/swarm-125917-q12c/report.md. A human promotes this into docs/decisions/ with `guard-decisions add`; nothing is adopted automatically.

DECISION RECORD
- slug: pool-throughput-harness
- context: The pre-registered pool-throughput study (docs/experiments/2026-09-23-pool-throughput.md) could not start until a harness existed that validates curated items, launches the four setups against a deadline, merges, scores on hidden tests and audits for leakage. Without it, all 24 runs (about $800) would be unscorable or open to bias. During the build, a nested test-runner variable leak would have scored every hidden test as passing when the harness ran under `node --test`.
- ruling: scripts/pool-{format,run,score}.ts with scripts/pool.ts (`lock | validate | run | finalize | score | audit`):
  - Pools: a hash-locked pool.json. The hidden side (cmd, reference.patch, tests/) lives outside every repo and worktree and is read only by validate and score.
  - Run: fresh worktrees under a scratch root. Solo and split are claude -p seats through runClaudeSeat; rooms are `dist/swarm.js --flat` on a private hub. At the deadline the harness stops the process groups, then any process whose working directory is under the run dir.
  - Finalize: fixed-order merges where the earlier branch wins a conflict and the conflict is recorded; rooms use their named integration branch.
  - Score: each item is scored alone in a clean worktree, and the project suite runs in a separate clean checkout.
  - Audit: scans transcripts, session files, room logs and briefs for the hidden root and hidden test file names; any hit voids the run.
  - Offline: a two-item dry-run pool and a fake-seat mode run the whole path with no model calls.
  - Test commands run without NODE_TEST_CONTEXT.
- consequences: Each run's primary measure is machine-checked against tests builders never saw. Leakage voids a run instead of silently inflating its score. The pipeline is regression-tested offline, including room3 through the real launcher.
- tradeoff:
  - The room brief names the integration branch, which adds a line to the spec's wording.
  - Split seats share one repository and so have a side channel to each other.
  - A process a seat starts outside the run dir is not stopped.
  - A hidden test file name that already exists in the repo is refused at validate time.
  - Room seats' costs depend on a new usage file written by src/swarm.ts.
- researched: no external sources; only repository files (the pre-registration, scripts/bench-build-runner.ts, scripts/bench-build-runtime.ts, scripts/seat-cost-estimate.ts, scripts/paper-account-regime.ts, src/swarm.ts, src/claude-args.ts, src/env.ts, scripts/offline-runner.mjs). NEW relative to the SETTLED AXES list: none.
- rejected:
  - Copying every item's hidden tests into one score worktree: it loses on isolation, because a broad cmd runs other items' tests.
  - A separate clone per split seat: it departs from the spec's shared-repo worktrees.
  - Inventing an Opus 5.5 list price: an unverified price would make the cost figures unreliable.
  - Relying on swarm's own --timeout for rooms: detached dev hubs escaped it.
- revisit-when:
  - A price row for claude-opus-5-5 is added to scripts/seat-cost-estimate.ts.
  - A run's run.json shows a seat process outliving the deadline outside the run dir.
  - The study's analysis finds a split run that used the shared-repo side channel.
