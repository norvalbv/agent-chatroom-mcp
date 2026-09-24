---
status: open
added: 2026-09-24
from: reuse/seat-launch review (non-blocking findings)
---
# Seat launch: follow-ups from review

- The timeout and SIGTERM sweeps do not spare the seats: seats get SIGTERM and then SIGKILL about
  1 s later, cutting short an OpenRouter seat's SIGTERM handler (writeHandoffs + leave_room).
  Pass the seats' pids as `spare` in those two sweeps; the end-of-run sweep still catches them.
- sweepStrays runs spawnSync('lsof') with no timeout on the SIGTERM path; a hung lsof blocks exit.
- Hub recruits' worktrees (.swarm-worktrees/<id>-room/<name>) are not swept, so a dev hub a write
  recruit detached still outlives the run.
- Read-only codex seats cannot write anywhere, TMPDIR included, so npm test/build fail with EPERM;
  their brief still says they may run commands. Tell them they are sandboxed.
- Codex usage never reaches result.json: readSeatUsage needs a numeric cost and codex reports none.
  Price codex seats from the LiteLLM rows (per-request prompt size decides the >272K tier), or let
  the rollup accept token-only seats. Note codex `steps` counts turns, OpenRouter's counts requests.
- The launcher still carries the task in argv (`node dist/swarm.js "<task>"`), so a seat's
  pkill -f on a brief word SIGTERMs the launcher and with it every seat. Move the task to stdin or
  a file.
- A read-only seat can have the hub spawn an edit-capable seat (request_agent / replace_participant
  do not check the requester's own rights). Pre-existing for claude seats too.
