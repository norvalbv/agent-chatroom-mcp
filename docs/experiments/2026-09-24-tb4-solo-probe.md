# Terminal-Bench 4 solo probe (pre-registered 2026-09-24, before any run)

**Question.** On hard, off-the-shelf tasks, with a 30-minute cap per task, how many does one agent solve? The answer
decides whether a room is worth running on the same tasks.

**Tasks.** Five Terminal-Bench 4.0 tasks (terminal-bench/terminal-bench@4.0.0, 66 tasks), chosen before any run as the
shortest by the dataset's own expert time estimate that fit this machine (2 CPUs, 4 GB, no GPU), one to two per domain:
photonic-waveguide-routing (0.75 h, software), music-harmony (1.0 h, media), bun-sourcemap-leak (1.5 h, software),
foodstuff-beta-activity (1.5 h, science), freecad-platform-drawing (1.5 h, hardware). Chosen by time estimate, not
by any pass-rate data (none was read).

**Setup.** Harbor 0.23.0, the claude-code agent, `claude-opus-5-5` on the owner's subscription (an OAuth token from
`claude setup-token`, entered at run time, never written to a file). Agent time cap 30 minutes per task (the dataset's
8-hour cap x 0.0625). WebSearch and WebFetch disallowed, because these tasks' solutions are public; the container keeps
network access for the model API. A spend cap of 12 USD per task (30 minutes at the highest per-seat-minute rate
measured in Study 3). One task at a time. Scoring is the dataset's own verifier (reward 1 = solved).

**Decision rule, fixed now.** Solo solves 0 to 4 of 5: run a room on the same five tasks at the same cap (room size
and cost stated to the owner first; nothing runs without the owner's go-ahead). Solo solves 5 of 5: stop; the tasks
are within one agent's reach at this cap.

**Expected cost.** About 25 USD (10 to 60), from Study 3's measured 0.07 to 0.40 USD per Opus seat-minute.
