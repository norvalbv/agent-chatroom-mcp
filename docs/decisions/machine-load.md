---
slug: machine-load
created: 2026-10-26
---

# machine-load

## Target · 2026-10-26 — A hub blocked on its own work is not reported as the machine stalling

**Context:** 6 of 9 server stall episodes and 5 of 5 break-out stalls were the hub's own spawnSync `git worktree add`, at 5% hub CPU and load ≤2.8. The probe reported every process on the machine as stalling.
**Ruling:** A worker-thread reference clock separates cause "blocked" from cause "machine". Worktrees are made with async execFile, one at a time. Telemetry: machine_stall.ref_drift_ms and cause, run-metrics hub_blocks, and a worktree event {ms, waited_ms, ok}. Built in 6acfc33c, 7581dc80, 0300a3a3, 0a669061 and 3837c012 (machine-load; reviews by claude-opus-5-5-1).
**Consequences:**
- Positive: request_agent went from 2.9 s to ≤0.33 s (stub recruits, n=2 per build; recounted by the author from saved JSON). The false MACHINE line appeared 2 of 2 times before and 0 of 4 after. A real write recruit (probe/recruit-settings-1, n=1) got its worktree in 22 ms. A large repo with a real recruit is NOT SHOWN.
- Negative: Recruits still start 1-1.3 s apart, because git runs one worktree at a time.
**Vision-fit:** n/a — internal tooling: rooms that organise themselves and keep working seats
**Researched:** NEW sources/nodejs-dont-block-the-event-loop; NEW sources/jhiccup-readme; NEW sources/arXiv:1511.02960; NEW sources/scikit-learn-parallelism.
**Rejected:** a default thread cap (OMP/OPENBLAS=1); renicing seats by default; sparse worktrees; a spawn guard during latency windows.
**Revisit-when:** a room logs machine_stall with cause machine while ref_drift_ms stays small, or idea/seat-job-cpu shows a seat job behind a stall.
**Scope:** scripts/claude-lean-flags-regression.ts,scripts/hook-bypass-regression.ts,scripts/machine-blocked-regression.ts,scripts/offline-runner.mjs,scripts/recruit-base-regression.ts,scripts/recruit-stall-probe.ts,scripts/recruit-worktree-async-regression.ts,scripts/seat-env-regression.ts,scripts/worktree-hooks-regression.ts,src/hub/internal.ts,src/index.ts,src/metrics/escalation-metrics.ts,src/run-metrics.ts,src/spawner.ts,src/spawner/worktrees.ts,src/telemetry/machine.ts,src/telemetry/reference-clock.ts
**Source:** swarm-005940-77tu (RSI-5) prop_49a4a68e v7; promoted 2026-10-26 by the owner's choice (measured items only)
