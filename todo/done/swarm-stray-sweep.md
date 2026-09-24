---
status: done
added: 2026-09-23
from: docs/reuse-survey-2026-09-23.md (Process containment and the stray sweep)
done: 2026-09-24 d0ac6a61 via reuse/seat-launch
---
# Sweep stray processes when a plain swarm run ends

swarm.ts's timeout and SIGTERM paths only c.kill() direct children, so a dev hub a seat detached
can outlive `node dist/swarm.js`. Reuse pool-run's stopStrays (the lsof-cwd sweep) there.

The sweep matches by cwd, so a process that changes directory escapes it; already accepted in
pool-run.
