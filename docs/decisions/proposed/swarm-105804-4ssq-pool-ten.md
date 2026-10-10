# Proposed decision: swarm-105804-4ssq-pool-ten

From swarm-105804-4ssq (concluded); report: swarms/swarm-105804-4ssq/report.md. A human promotes this into docs/decisions/ with `guard-decisions add`; nothing is adopted automatically.

DECISION RECORD
- slug: swarm-105804-4ssq-pool-ten
- context: The friction notes from swarm-083203-kooz listed ten problems in how seats receive messages, get refused, handle challenges, run tests and report cost. For example, one 66 KB delivery overflowed a client's tool-result limit, six seats filed the same blocking challenge, and one flaky script hid every later test result.
- ruling:
  - One wait/read delivery is capped at 24k rendered chars and reports how many messages remain.
  - The focused ask counts toward readAs's limit.
  - A refusal over an ask the seat was already shown says the reply to #N is still owed.
  - A blocking challenge quoting the same clause as an open one returns that challenge's id unless confirm=true.
  - A quiet reply_to implies the parent message's author as audience.
  - scripts/ is type-checked via `tsconfig.scripts.json`.
  - The offline runner runs every script and lists all failures at the end.
  - claim/* entries carry a hub-filled branch and worktree.
  - A one-of-you ask is retired for every named seat once one of them replies (an @-back retires the oldest ask only).
  - A seat killed at its deadline gets a cost estimated at list price, marked estimate:true and null when unknown.
- consequences: Tool results stay under client limits. Every message is still delivered exactly once. One flaky script can't hide the rest of the suite. Duplicate objections are collapsed. Bench cost reports no longer show 0 for killed seats.
- tradeoff: A large backlog now takes several wait/read calls. Each claim write spawns one synchronous `git` call. Per-connection worktree maps are never pruned. OpenRouter seats get no worktree. The containment match can treat a short quoted clause (12+ chars) as a duplicate of a longer one.
- researched: only the repo itself (`src/hub.ts`, `src/server.ts`, `scripts/*`, `paper/figures.md`). No new external sources.
- rejected:
  - Capping delivery by message count alone: a few large messages can still overflow.
  - Retiring every open ask on an @-back: it would not match the rule a seat's own @-back follows (oldest ask only).
  - Deduplicating non-blocking and command challenges: regression-replay legitimately files two non-blocking objections on one clause, and a command challenge is its own evidence.
  - Enabling checkJs for the `.mjs` scripts: out of scope.
- revisit-when: a client tool-result limit falls below about 30k chars, or a delivery-cap probe shows a lost or duplicated message, or a bench run shows `estimated_cost` of null for a model that should be priced.
