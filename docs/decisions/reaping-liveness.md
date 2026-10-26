---
slug: reaping-liveness
created: 2026-10-26
---

# reaping-liveness

## Target · 2026-10-26 — An idle seat is reaped only when nothing shows its client is alive

**Context:** The idle sweep reaped on MCP lastSeen alone. Over all records, 15 of 17 seat-taking reaps in open rooms took a live seat: 11 of those 15 were chairs, and 4 of the 5 worker or recruit reaps were live. On the 9f66 server run, recruit-11 waited on a background job, was reaped, and came back 50 min later, after recruit-10 had redone its finish.
**Ruling:** The sweep spares a session while its GET /mcp stream is open, a heartbeat arrived inside the window, or the latest process sample holds its CLI. Past 120 min idle, only a running job or a tool call keeps the seat. A chair's idle session closes, but the chair keeps its seat. The first spare posts one line naming what keeps the seat. Telemetry: reap_check {outcome, alive_by, waiting_on, past_ceiling, idle_min}. Built in f0fd89af, 2d8213d1, 278fe556 and 3d087d00 (claude-opus-5-5-3; reviews review/f0fd89af by the verifier, and review/2d8213d1, review/278fe556 and review/3d087d00 by claude-opus-5-5-1).
**Consequences:**
- Positive: Peers no longer need a 15-min keep-alive post. A seat stuck in a shell loop stays for at most 120 min, and one with a job for at most 6 h (JOB_MAX_S). Measured: the bt52 dev room spared 2 of 2 real seats;; probe/reap-ceiling-1 (2 real seats on 0f13d23b, 240 s ceiling, n=1, review/reap-ceiling-1 by claude-opus-5-5-1): a worker with a 287 s python job in waiting_on went 304-307 s idle and kept its seat, and the verifier, whose waiting_on was empty, was reaped at 243 s with past_ceiling true. NOT SHOWN: the 120-min default, a heartbeat-kept seat past the ceiling, and chair_kept.
- Negative: A kept chair keeps a disagree it cast on the current version until it re-votes or the text is amended. How often a chair reap used to lift a veto is not counted.
**Vision-fit:** n/a — internal tooling: rooms that organise themselves and keep working seats
**Researched:** replay of 332 room logs (scripts/reap-replay.mjs); jobs ran p95 48 min and p99 166 min (n=1628). The verifier recounted the 15 of 17 and its composition.
**Rejected:** a "wait until T" tool; auto-reconnect; fixing RSI-4's repeating quiet notice (n=1; revisit if room_idle repeats within 10 min in 2+ rooms).
**Revisit-when:** reap_check shows a seat reaped past_ceiling that then returns with work, or a spared seat sits past 120 min holding a claim others wait on.
**Scope:** scripts/offline-runner.mjs,scripts/reap-liveness-regression.ts,scripts/reap-replay.mjs,src/hub.ts,src/hub/internal.ts,src/hub/liveness.ts,src/hub/memory.ts,src/index.ts,src/server.ts
**Source:** swarm-005940-77tu (RSI-5) prop_49a4a68e v7; promoted 2026-10-26 by the owner's choice (measured items only)
