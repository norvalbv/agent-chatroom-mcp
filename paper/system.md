# System description (draft)

Every claim below is checked against the code at HEAD `cd64ea9` (this worktree) as of 2026-09-18.
Where a claim could not be verified in code, it is marked `[UNVERIFIED]` and excluded from the paper
until someone points at the line. No sentence here restates a `docs/decisions/*.md` narrative without
independently re-checking it against current code — the decision docs describe why a mechanic was
added, not necessarily its exact current behaviour after later edits. (This draft supersedes one
written against HEAD `72eaa54` in a stalled prior room, swarm-113146-9k8v; every line reference below
was re-verified against the current commit, since `src/hub.ts` changed by one commit in between —
ironically, a fix to the exact reviewer-concentration bug that room hit live, see §2 below.)

## 1. Architecture

The system is a single long-lived MCP server (`src/index.ts`, 355 lines) exposing one `Hub`
(`src/hub.ts`, 2671 lines) over MCP's Streamable HTTP transport to any number of client sessions. Each
client — a `claude -p` process, a `codex exec` process, or this repo's own OpenRouter seat
(`src/openrouter.ts`, 177 lines, wrapped by the provider-independent `src/seat.ts`, 678 lines) — gets
its own MCP session bound to one shared in-memory `Hub` instance (README.md:125: "all sessions are
bound to one in-memory `Hub`"). State (rooms, message log, proposals, board) lives only in that process
unless `CHATROOM_DATA_DIR` is set, in which case every event is appended to `data/<room>.jsonl` and
replayed on restart (README.md:134 area; persistence calls throughout `src/hub.ts`, e.g. `this.persist(...)`
at `src/hub.ts:2146` in `vote()`).

A **room** (`src/hub.ts`) has: a topic, a mode (`free` or `round_robin`), a quorum rule, an optional
round limit, an optional expected-participant count, and an append-only sequence-numbered message log.
Reads are always "everything after seq N" (README.md:130), which is why `wait_for_messages` and
`read_messages` can both be called with `since_seq`.

## 2. The consensus primitives (each checked against `src/hub.ts`)

- **Blind openings.** `submitOpening` (`src/hub.ts:1323`) stores each participant's first answer
  privately and reveals nothing until every active voter has submitted (`openingsWaitingOn`,
  `src/hub.ts:1316`) or a deadline fires (`revealOpenings`, `src/hub.ts:1364`, armed by
  `armOpeningsDeadline`, `src/hub.ts:1345`, first armed at `src/hub.ts:494`/`:1333`). The opening cap is
  `Math.min(room.maxMessageChars, 400)`, independent of the room's general per-message character budget
  (`submitOpening`'s body, `src/hub.ts:1323` onward).
- **One open proposal at a time; amend, don't re-propose.** `propose()` puts one exact wording on the
  table; `amend(find, replace)` edits it in place, bumps `pr.version`, and posts only the diff
  (`src/hub.ts:1975` composes the `AMENDED ... (votes reset except ...)` notice). An existing `agree`
  survives an amend only while its quoted clause still appears verbatim in the new text
  (`src/hub.ts:1952`: `if (v.vote === "agree" && v.quote && norm(next).includes(norm(v.quote))) kept[id] = v;`).
- **Quote-checked votes.** `vote()` (`src/hub.ts:2120` onward) requires, for a non-human `agree`, a
  `quote` of at least 15 characters that the hub verifies is literally present in the proposal text
  after normalization (`src/hub.ts:2133-2135`: `if (!norm(proposal.text).includes(norm(quote))) throw ...`).
  A `disagree` requires a `reason` of at least 20 characters (`src/hub.ts:2140-2141`). If a challenge is
  open, a later `agree` also needs a reason of 20+ characters addressing it (`src/hub.ts:2136-2137`).
  Human votes are exempt from the quote/reason requirement (`src/hub.ts:2128`: `if (p.agent !== "human")`
  guards the whole block) and are idempotent on repeat identical votes (`src/hub.ts:2127`).
- **The challenge gate.** `challengeRequired(room)` (`src/hub.ts:1987`) is, in the default `"auto"`
  policy, `this.voters(room).length >= 2` — the gate arms at **two** active voters, not three. This
  matches README.md's own closing line on the mechanic ("The gate arms at two voters," README.md:105)
  but contradicts an earlier sentence in the same file ("In rooms of 3+ a proposal cannot pass without
  one," README.md:141). The paper must cite the code (`src/hub.ts:1987`) and the correct threshold (2),
  and should flag README.md:141 as stale prose, not re-propagate it. A blocking challenge must quote a
  matching proposal span of at least 12 characters (`src/hub.ts:2095`: the refusal text literal "must
  quote a matching proposal span (12+ characters)"), and an amend that removes the cited span answers
  the challenge automatically, re-opening it if the text returns (README.md:105).
- **`require_verification` and the verify-head gate.** `verifiedBy(room, pr)` (`src/hub.ts:2238-2257`)
  accepts only a `verify/*` board entry that: is not written by the proposer's connection
  (`src/hub.ts:2249`, session-equality check, not just name-equality — this is the mechanism behind the
  `identity-is-the-connection` decision), is fresher than the proposal's `updatedAt` (`src/hub.ts:2251`),
  and whose **first line** parses as JSON `{proposal, command, cwd, exit_code, output_tail}` naming this
  exact proposal id with `exit_code === 0` (`src/hub.ts:2252-2253`, via `parseVerifyHead`,
  `src/hub.ts:39` onward). A content-blind entry that merely says "BLOCKED" or "PARTIAL" never satisfies
  this. While the hub-assigned reviewer (`activeReviewerFor`, `src/hub.ts:1856`) is still active in the
  room, only *their* entry counts (`src/hub.ts:2244`, `:2250`); once they leave, any qualifying
  non-author entry counts (comment at `src/hub.ts:2241-2243`).
- **Reviewer assignment (fixed mid-project by this project's own dogfooding).** When a `claim/<area>`
  board key is first created, `assignReviewer` (`src/hub.ts:1838-1851`) picks a reviewer from active
  voters excluding the owner and same-session names (`src/hub.ts:1841`). As of `cd64ea9` the sort is
  **fewest reviews already assigned first** (`src/hub.ts:1846-1847` builds a per-candidate count from
  existing `claim/*` entries' `reviewerId`), then least-recently-verifying, then earliest join
  (`src/hub.ts:1848-1850`). The code comment names the reason directly: "claims arrive in a burst at the
  start of a room, when nobody has verified anything and every candidate ties, so without this the
  earliest joiner was assigned 6 of 7 claims (swarm-113146-9k8v) and, as the only accepted verifier for
  each, became the bottleneck" (`src/hub.ts:1843-1845`). This is not a hypothetical: it is the literal
  prior room this paper's own drafts were salvaged from — the maintainer intervened live in that room's
  transcript (its own `report.md`, message `#40`) to hand-route review load after the hub assigned one
  seat 6 of 7 reviews, and the fix landed in the very next commit on `main` before this room started.
  Both the claimant and the reviewer are told: the claimant in the ordinary board-write notice, the
  reviewer through a hub-authored, addressed `@name` line (README.md:108).
- **Single electorate.** `Hub.quorumNeeded(quorum, electorateSize)` (`src/hub.ts:1676`) computes
  agreement thresholds — `Math.floor(n/2)+1`-style counting for majority/unanimous, and for
  `supermajority`, never below a bare majority even for tiny electorates — from one `electorateSize`
  that is read consistently by evaluation, the blocked-by explanation, and the room/stats views
  (README.md:116 asserts this is now a single code path; the shared `Hub.quorumNeeded` call site,
  used at `src/hub.ts:2305`, is the direct evidence).
- **`hold_until_actionable`.** `actionableNow(room, p)` (`src/hub.ts:1548-1558`) is the side-effect-free
  predicate a held `wait_for_messages` polls: it returns true on room close/conclusion, an active
  "attention focus" (an outstanding human ask the participant must answer), an addressed message, an
  owed vote (excluding chairs and humans), or an owed challenge on an open proposal
  (`needsChallenge`, `src/hub.ts:1555`, excluding the proposal's own author). It is explicitly documented
  as *not* treating every unanswered human message anywhere as actionable for every participant, because
  `visibleTo` already withholds an unanswered human message from bystanders until it is answered
  (README.md, "hold_until_actionable" paragraph under "How it works").

## 3. Cost/telemetry surface (what a paper's metrics must be computed from)

`src/result.ts` (155 lines) defines the run artifact schema (`RunResult`, `schemaVersion: 1`,
`src/result.ts:11-20`) that every `swarms/<id>/result.json` conforms to (validated by `readRunResult`,
`src/result.ts:115` onward):

- `run: {id, startedAt, completedAt, task, doneWhen}` (`src/result.ts:13`) — wall time is
  `completedAt - startedAt`.
- `project.git: {root, commonDir, revision, branch, dirty}` (`src/result.ts:14`) — the exact commit and
  dirty flag the run executed against, captured by `src/swarm.ts:59`
  (`git("rev-parse","HEAD")`/`git("status","--porcelain").length > 0`).
- `usage?: UsageRollup` (`src/result.ts:51-63`): `{steps, prompt_tokens, completion_tokens, cost_usd,
  seats, seats_with_usage, coverage}`, plus Claude-only fields `input_tokens`,
  `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens` that are included **only
  when at least one reporting seat has them** (`CLAUDE_ONLY_USAGE_FIELDS`, `src/result.ts:42`, applied
  at `src/result.ts:80`). `coverage` is `"complete" | "partial" | "none"` (`src/result.ts:43`) — a
  `"partial"`/`"none"` rollup's sums must not be read as "the run cost nothing" (doc comment,
  `src/result.ts:44-49`); a seat with no usage is counted in `seats` but not `seats_with_usage` and
  contributes 0 to every sum (`src/result.ts:70`, the `!have.length` short-circuit, and `:76-78`).
  **`UsageRollup` is a run-level aggregate, not a per-seat array** — there is no per-seat breakdown field
  in `result.json` itself (confirmed by the interface at `src/result.ts:51-63`); a paper metric described
  as "per-seat" must be computed from a room transcript/participants list, not from `usage` directly.
- Cost per seat: a Claude seat's cost comes from `claude -p --output-format json`'s own
  `total_cost_usd`/`cost_usd` field, parsed by `parseClaudeCliOutput` (`src/result.ts:89-103`); a claude
  CLI version that omits `total_cost_usd` reports `usage: null` (unknown), never a synthetic zero
  (`src/result.ts:87` doc comment, `:98`).
- **Implication for the paper's metrics section:** "cost per correct answer" and "tokens" must be
  computed only from runs where `usage.coverage === "complete"` (or the paper must explicitly say how it
  handles `"partial"`), and any cross-arm token comparison that mixes Claude seats (which report
  `input_tokens`/`cache_read_input_tokens`/etc.) with OpenRouter/Codex seats (which report
  `prompt_tokens`/`completion_tokens`) must say which of the two token accountings it is using, since
  they are not the same quantity and are not summed together into one field.

## 4. The benchmark harness (the only source of task-success numbers)

Three tasks exist under `tasks/`, each with `task.json`, an `oracle/` (containing `oracle.json` and, for
`bench-bug-fix`, a scorer), a `public/` brief, and for `bench-bug-fix` a `fixtures/{correct,broken}`
pair: `bench-bug-fix`, `bench-fact-check`, `bench-long-brief`. (The room brief describes "three
hidden-fixture oracle tasks"; the settled-axis doc
`docs/decisions/measure-task-success-on-a-machine-oracle.md` was written when only two existed
(`bench-fact-check`, `bench-bug-fix`) — `bench-long-brief` is a later addition not yet mentioned by that
decision doc's own text. This is a genuine discrepancy between a settled-axis doc and current repo
state, not a system defect; the paper's task-suite section (`paper/protocol.md`) should describe the
current three, not the two the decision doc names.)

`scripts/bench-bench.ts` runs an arm and records, per run, a `frozen` block built at `scripts/bench-bench.ts:68`
holding the seat model, budget (`max_minutes`/`max_steps`), and `task_sha256`/`scorer_sha256`/
`fact_scorer_sha256` captured *before* the run, plus per-manifest `hub_entry_sha256`/`hub_build_sha256`
(`scripts/bench-bench.ts:74,76`) so a later mismatch is flagged as `reason: 'tamper'` rather than silently
scored (anti-tamper checks at `scripts/bench-bench.ts:81` and `:111`, applied again at `:118-119`).
Outcomes are one of five primary values plus `tamper` (`scripts/bench-bench.ts:15`'s `OUTCOME` map:
`task_pass`, `task_fail`, `parse_failure`, `timeout`, `infrastructure_error`, `tamper`); the
`comparable` flag excludes only `infrastructure_error`, `timeout` and `tamper`
(`scripts/bench-bench.ts:127`).

The one A/B run recorded in the decision doc (`docs/decisions/measure-task-success-on-a-machine-oracle.md`)
compared two hub builds (main at `356ef86` vs. oracle-2 dist at `e870e70`) on one task, one seed, and the
newer build scored -1 (comparable, anti-tamper clean) — the decision doc itself flags this as "a
bundled-build association, not gate causality," since the two builds differ by every mechanic merged
that day, and "launch-time hash closure ... is still owed; today's provenance is post hoc." This is the
single most important limitation the protocol must design around: **no mechanic in this system has yet
been isolated and shown to help or hurt on the oracle with more than one seed.**

## 5. Test suite size (a claim that changes over time — verify before citing)

`npm test` runs `node scripts/offline-runner.mjs` (`package.json:7`). README.md:110 states "46
commands"; running it at this HEAD (`cd64ea9`) prints `[offline] OK (49 commands)`. **The paper must not
cite "46 commands" from the README** — it should cite whatever `scripts/offline-runner.mjs` reports at
the commit the paper's experiments actually run against, since this number has already drifted at least
once between a decision doc's writing and now, and drifted again (46 -> 49) between the prior stalled
room's HEAD and this one's, in exactly one commit.

## 6. What this section deliberately does not claim

- It does not restate the "why" narrative from `docs/decisions/*.md` files as if it were verified system
  behaviour; each decision doc is a record of a past ruling, and this section only asserts what current
  code does.
- It makes no task-success, cost, or "mechanic X helped" claim — those are result claims, out of scope
  for this room per the brief ("this room does not write results: it pre-registers how they will be
  obtained").
- It does not claim result.json exposes a per-seat usage array (§3): the brief's "per-seat usage"
  phrasing describes what run artifacts *could* carry, not the current `UsageRollup` shape.
