---
status: idea
added: 2026-09-23
from: reuse/sandbox build report (probes and risks)
after: swarm-stray-sweep
owner: benji
---
# Turn --sandbox on by default

The sandbox contains pkill, kill and writes outside the worktree, and builds, tests and commits
work sandboxed. Before it becomes the default:
- sandboxed seats cannot stop a process they started in an earlier call, so the stray sweep must
  land first or dev hubs pile up;
- sandboxed seats cannot launch agent dev rooms (nested claude -p is denied the API), which
  self-improvement rooms on this hub rely on;
- codex seats are not covered;
- Claude Code's sandbox leaves all of /tmp/claude-<uid> writable (its TMPDIR), which exposes every
  agent's scratchpad worktrees on this machine;
- the controller routes (insecure-local-controller-routes) stay a kill path;
- only one sandboxed room has been observed.
A first step: default it on for CHATROOM_NO_RECRUIT pool and bench hubs once the sweep lands.
