# Proposed decision: pool-friction-10-items-swarm-105802

From swarm-105802-0s9p (concluded); report: swarms/swarm-105802-0s9p/report.md. A human promotes this into docs/decisions/ with `guard-decisions add`; nothing is adopted automatically.

DECISION RECORD
- **slug:** pool-friction-10-items-swarm-105802
- **context:** Friction notes from swarm-083203-kooz listed 10 problems. Among them: one 66 KB delivery overflowed a client's tool-result limit, six seats filed the same blocking challenge within two minutes, a "one of you" ask stayed owed by every named seat after one answered, and the offline runner stopped at its first failure so later results were hidden. Each cost seats wasted turns or hid broken tests.
- **ruling:**
  - One wait/read delivery is capped at 24,000 characters and reports how many messages remain, without skipping any.
  - The focused ask counts toward readAs's limit.
  - A refusal over an ask the seat was already shown names the owed #N, the queued count and the latest seq.
  - A quiet reply_to is addressed to the parent's author without needing an @-name.
  - A shared ask is retired for every named seat once any of them replies.
  - A blocking challenge on the same clause as an open blocking challenge is refused with that challenge's id unless confirm=true; non-blocking dissent is always filed.
  - The hub stamps branch and worktree onto claim/* entries.
  - The offline runner runs every script and reports all failures at the end, still exiting nonzero.
  - `npm test` type-checks scripts/ with its own tsconfig.
  - A deadline-killed bench seat gets a list-price cost estimate marked `estimate:true`, and its `usage` stays null.
- **consequences:** Seats' tool results stay within client limits; duplicate blocking objections and stale shared asks stop pinning seats; one failing script no longer hides the others; reviewers can find work in progress without asking; bench cost totals no longer silently count killed seats as 0.
- **tradeoff:**
  - A capped delivery can take more calls to drain a backlog.
  - Anyone raising a genuinely different objection to an already-challenged clause must pass confirm=true.
  - An off-topic @-back from a co-named seat retires a shared ask.
  - Claim writes run a synchronous `git branch --show-current`.
  - The cost estimate is an approximation, not a bound.
- **researched:** No external sources. I read only repository files and commands this run: `src/hub.ts`, `src/server.ts`, the relevant `scripts/*` and `paper/figures.md`, plus the `git`/`npm test` output. No SETTLED AXES list was provided, so nothing is marked NEW.
- **rejected:**
  - Deduplicating non-blocking challenges: it loses each seat's recorded dissent and broke `regression-replay`.
  - Counting the cap in formatted-line characters: it would couple the hub to the display format for a marginal gain in accuracy.
  - Letting a seat type its own branch into a claim: it can't be trusted, and the pool item requires the hub to fill it in.
  - Folding the estimate into `usage`: that breaks the rule that an unknown cost is never counted as zero.
- **revisit-when:** Any single delivery exceeds 24,000 characters of formatted output. Or a room log shows a shared ask retired by an off-topic @-back. Or `bench-build-task.test.ts` times out in a solo `npm test` run.
