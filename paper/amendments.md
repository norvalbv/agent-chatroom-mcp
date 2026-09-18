# Amendments to paper/protocol.md

Every place the RQ1 build (room `swarm-120129-s12h-room`) had to deviate from, or fill a gap in,
`paper/protocol.md` as pre-registered. Each entry is dated, states the reason, and states exactly what
was done instead. Written before any grid run, per the maintainer's instruction that a pre-registration
silently changed is worthless.

## 2026-09-18 — No token/turn ceiling in the `claude` CLI; budget matching uses `--max-budget-usd` + a wall-clock cap

**Protocol text:** §1/§2.1/§9 say arm A's budget is "a token/turn ceiling ... matched to the mean per-arm
cost of arm C ... on the same task", and §9(b) says the harness needs "a budget-matched single-agent
harness mode", without specifying the mechanism.

**Gap found:** `claude --help` (checked directly in this checkout, this run) has no `--max-turns` and no
raw token-ceiling flag. It does have `--max-budget-usd <amount>` — "Maximum dollar amount to spend on API
calls (only works with --print)" — a dollar ceiling, not a token or turn ceiling.

**What was built instead (item 3, sonnet-4, `scripts/rq1-usage-budget.ts`'s `matchArmABudget`):** "Arm A
budget matching (deviation from protocol.md §2.1/§6's abstract 'token/turn budget'): arm A's ceiling is
operationalized as two concrete claude CLI limits, both derived from arm C's realized spend on the exact
same (task, seed) pair (paired, within-task, within-seed — not a single number reused across tasks or
seeds): (1) `--max-budget-usd` set to arm C's total realized `cost_usd` on that run; (2) a harness-enforced
wall-clock cap (the CLI has no turn-ceiling flag) set to arm C's realized wall-clock duration on that run.
'Matched' therefore means arm A may spend up to what arm C actually spent in dollars and up to as long as
arm C actually took in wall time — not a token-count match (the CLI doesn't expose one) and not a
turn-count match (no turn-ceiling flag exists)." `matchArmABudget` refuses (throws) if arm C's cost or wall
time is non-positive, since arm A cannot be budgeted from a run that didn't actually spend anything
measurable. `--max-budget-usd` stops the seat *after* a turn whose predicted next turn would exceed it, per
its own help text ("after each turn with a predicted next..."), so a seat can still slightly overshoot the
ceiling on its last turn; this is CLI-imposed slack, not a harness bug, and the realized `cost_usd` is
recorded per-run so a reader can see any overshoot.

## 2026-09-18 — Fixed seat count for arm C, not stated in §3

**Protocol text:** §2.2 says arm C "uses a fixed seat count per task tier (declared per task in §3, not
tuned per run)".

**Gap found:** §3 (task suite) never states a seat-count number for any task — checked by full-text grep
of `paper/protocol.md` for "seat" in this run, no numeric seat count appears anywhere in §3.

**What was built instead:** arm C runs with **3 seats** (workers, no separate lobby/consolidator) for both
`bench-fact-check` and `bench-bug-fix`. Reasoning: 3 is the minimum seat count at which the full hub's
`require_challenge` gate binds (`challengeRequired()` requires 2+ active voters,
`docs/decisions/consensus-requires-scrutiny.md`) while still leaving a reviewer distinct from both the
proposer and the sole challenger for `require_verification`'s reviewer assignment
(`docs/decisions/done-means-independently-verified.md`) — 2 seats would force the same seat to challenge
and verify, or leave no seat to verify at all. This is a tier declared now, for these two tasks, at this
seat count; it is not tuned per run, matching §2.2's own requirement. Side effect worth flagging: this
room's own quorum rule (`consensus-requires-scrutiny`) makes supermajority `⌈0.75×3⌉ = 3` — i.e. at n=3
seats, arm C's room quorum is effectively unanimous in practice, not a partial supermajority as it would be
at a larger seat count. A reader comparing arm C's consensus difficulty across task tiers with different
seat counts should account for this.

## 2026-09-18 — `bench-long-brief` excluded from the harness build

**Protocol text:** §3 already states, independently of this build, that `bench-long-brief` "cannot
currently produce a `task_pass`/`task_fail` signal from `scoreTask()` alone" and is "not yet usable for
RQ1–RQ3's primary task-success metric".

**What was built instead:** the harness mode built in this room only supports `bench-fact-check` and
`bench-bug-fix`. This is not a new deviation — it ratifies what §3 already said — but is recorded here
because the room brief explicitly listed it as an exclusion and a reader of only §9 (which does not repeat
the exclusion) should not assume the harness covers all three tasks.

## 2026-09-18 — Turns for Claude seats: `num_turns` from the response JSON, not transcript parsing

**Protocol text:** §4 ("Turns") says `usage.steps` is 0 for Claude seats and, where that is the case,
"turns are approximated by model-turn count parsed from the seat's own JSON transcript output
(`scripts/claude-room-usage.py`'s existing method ... labeled as such in every table that reports it)".

**Finding (real Haiku probe, 1 of this room's 6 allowed real-model calls):** a `claude -p --output-format
json` reply's top-level JSON already includes `num_turns` (and `duration_ms`/`duration_api_ms`) alongside
`total_cost_usd`/`usage` — the same blob `parseClaudeCliOutput` already reads for cost and tokens. No
external transcript file (`~/.claude/projects/*.jsonl`) needs to be parsed to get a per-seat turn count for
a Claude seat.

**What was built instead:** this is an *improvement* on §4's assumption, not a deviation from it —
`scripts/bench-rq1.ts`'s result file has a top-level `turns: {per_seat: [{name, num_turns}], summed, seats,
seats_with_turns, coverage}`, with every `num_turns` sourced directly from the seat's own response JSON, not
from transcript parsing, and with no `approximated` flag because none is needed. Recorded here because a
reader of §4 alone would expect Claude-seat turn counts in this paper to require an external, machine-local
transcript file and to be labeled approximate, and that expectation would be wrong for anything produced by
this harness.

## 2026-09-18 — `--seed` is a naming/pairing key, not a control on any random element

**Protocol text:** §5 ("Seeds") says "A seed fixes the arm's random elements (task order within a batch,
sampling temperature seed where the provider exposes one, and — for arm C — which seat name maps to which
room role where that is randomized)."

**Gap found (checked directly against `scripts/bench-rq1.ts`, not assumed):** the harness's `--seed`
argument is used only to name and pair result files (`<task>-<arm>-seed<seed>/result.json`) and, in
`bench-grid.ts`, to find arm A's matching arm C result. It is never passed to the `claude` CLI — `claude
--help` (checked this run) has no `--seed` or `--temperature` flag to pass it to — and it does not
randomize which seat name maps to which room role: arm C always launches `seat-1`, `seat-2`, `seat-3` in
that fixed order regardless of seed value. Each harness invocation also runs exactly one task, so there is
no batch to order.

**What this means for RQ1:** "same seed value reused across arms" (§5) is honored in the narrow sense that
arm A and arm C for a given seed number are paired and their budgets/timing compared — but the seed
currently controls no actual source of randomness. Two runs of the same (task, arm) with different seed
numbers are expected to differ only through the model's own non-determinism (§8's "Provider
nondeterminism"), not through any harness-controlled random element. A reader must not interpret
same-vs-different seed numbers as a controlled variable the way §5 describes; it is a bookkeeping label for
pairing and deduplication only, until/unless the claude CLI exposes a sampling-seed flag or the harness adds
its own seat-role randomization keyed on seed.

## 2026-09-18 — `bench-fact-check`'s `records.txt` repaired: the corrected affiliation was not textually determined

**Defect found (RQ1 grid1 pilot, `swarm-125438-jp20-room` item 6):** `bench/results/rq1-grid1/bench-fact-check-{A,C}-seed1/result.json` — every real Sonnet seat in both arm A (single seat, full tool access) and arm C (3-seat room, independent deliberation, unanimous 3/3 vote) answered "Institute for Computational Reasoning, Vienna" for the corrected affiliation. `oracle/oracle.json` expects `"Society for Formal Methods, Vienna"`. Both readings were textually defensible from the pre-fix `records.txt`: its final sentence named "Society for Formal Methods, Vienna" only as the *source of the confirmation* for "departmental appointment record" ("Source: departmental appointment record, Society for Formal Methods, Vienna ... The Berlin line is the transcription error"), which does not state that this organization is itself Mira Chen's affiliation — it is equally consistent with that organization confirming an appointment at the Institute in a city other than Berlin. This is not a fresh defect: `git log` shows this exact "Source:" sentence (commit `2a8fb69`, "docs(fact-check): add authoritative public reference to records per bench-1 correction") was already a prior, unsuccessful attempt to close this same ambiguity; `oracle.json`'s expected value predates it (`1311d35`) and was never itself in question.

**Why this is not a forking path (dropping/changing a task after seeing results):** the defect is in the task's own stimulus text, not in the answer key, and it produced the identical failure mode in both arms independently (single-seat and 3-seat-deliberation alike converged on the same non-oracle reading) — it is not an arm-specific artifact one side could exploit, and the pre-registered `oracle.json` expected value is left unchanged (repairing text to fit a fixed, pre-existing answer key is not the same act as changing the answer key to fit observed model output). Corroborating design intent: `scripts/oracle-tasks.test.ts`'s commented-out "DIFFICULTY guard" (withdrawn by audit #163) already documents that this task is meant to be answerable by direct retrieval of a stated fact from `records.txt`, not by inference from omission — "the supplied reference is legitimate retrieval evidence." The pre-fix text failed that design intent (it required inference, and both inferences were defensible), so this is a repair to the pre-existing design, not a new design decision made in light of results.

**What was built instead:** `tasks/bench-fact-check/public/records.txt`'s final sentence was rewritten from an ambiguous source-citation to an explicit, direct correction:

  OLD: "Source: departmental appointment record, Society for Formal Methods, Vienna (secretariat confirmation, ref SFM/2024/118), cross-checked against the public staff directory at the institute's website. The Berlin line is the transcription error."

  NEW: "Correction: the Mira Chen line above was transcribed from the wrong record entirely — 'Institute for Computational Reasoning, Berlin' does not appear in any current appointment record for her, in Berlin or elsewhere. Her actual, current affiliation, per departmental appointment record (secretariat confirmation, ref SFM/2024/118) cross-checked against that organization's public staff directory, is: Society for Formal Methods, Vienna."

The new text explicitly forecloses the city-only-swap reading ("does not appear ... in Berlin or elsewhere") before making a direct declarative statement of the corrected affiliation, rather than citing an organization only as a confirming source. `oracle/oracle.json`'s expected value is unchanged. Per the room brief's requirement that a second seat try in earnest to argue a different reading before the repair is admitted: sonnet-1 attempted the strongest available counter-reading (that "Society for Formal Methods" could be a records-keeping secretariat rather than an employer) and found it does not survive the new text's two sentences read together (room transcript, `swarm-125438-jp20-room` messages #34–35). A regression test (`scripts/oracle-tasks.test.ts`, "records.txt licenses exactly one corrected affiliation, not two") asserts the new text's disambiguating language is present and fails against the old text (verified directly: reverting to the pre-fix text makes the new test fail with `must explicitly rule out any Vienna-city variant of the original institute name`).

<!-- Further entries appended by item 1/2/3 builders as deviations are found; do not remove this notice
until the room concludes. -->
