# Window-control artifact audit

Scope: read-only audit for swarm-174126-0s5m. This is not a new experimental
result and does not change the paper's RQ1 estimate.

At commit `f2a8d5a`, `bench/results/rq1-window-control/` is absent. The
generated status table therefore correctly reports the redesigned control as
pending, with zero of 24 planned C/K runs committed. The earlier three runs
and their 5.76 USD spend are intentionally uncommitted and are not evidence.

The runner's plan orders arms C, A, then K within each task and seed
(`scripts/bench-grid.ts`, `buildPlan`); filtered to `--arms C,K`, a fresh
control is C then K per seed. That is temporal blocking, not random arm order.
The post-shift redesign can detect a large C--K separation in that new regime.
It cannot validate or repair the historical pre-shift RQ1 comparison, and a
non-significant result at 12 seeds per arm is not evidence of equivalence.

The post-shift C cost recorded in `paper/amendments.md` is 1.50--2.21 USD per
run. With arm K's 10 times 0.30 USD maximum group rail, 12 C/K pairs can reach
62.52 USD. The earlier 5.76 USD for three runs extrapolates only naively to
46.08 USD and must not be treated as a safe cap. A ledger must reserve spend
before a new room-funded run. This does not contradict
`measure-task-success-on-a-machine-oracle`.

## Research

New source fetched for this audit: arXiv:2601.19934, Nicholson, *Quantifying
non-deterministic drift in large language models* (2026),
https://arxiv.org/abs/2601.19934. Its repeated-run API/local measurements
support measuring behavioral variation before attributing an intervention's
effect. It does not identify the cause of the Claude provider-side regime
shift in this project, nor validate its outcome-token proxy.
