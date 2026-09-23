---
status: idea
added: 2026-09-23
from: docs/reuse-survey-2026-09-23.md (Adopting a harness wholesale)
after: pool-throughput-report
owner: benji
---
# Consider Harbor for future benchmarks

Harbor (Apache-2.0, Terminal-Bench 2.0's harness) already does per-trial isolated environments,
deadlines, hidden tests, trajectories and job orchestration, and `harbor analyze` runs a
reward-hacking rubric over trajectories. Switching mid-study would break cross-pool comparisons,
so only after pool 3.

Possible shape: an exporter from pool.json to Harbor tasks plus one custom agent for a room.
Costs: a Dockerfile per repo, an OAuth token inside each container, 15 seats per container.
Cheaper first step: try `harbor analyze`'s rubric as an extra audit on our own transcripts.
