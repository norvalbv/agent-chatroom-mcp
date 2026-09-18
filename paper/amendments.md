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

## 2026-09-18 — A run the deadline killed gets outcome `timeout`, not scored against the workspace

**Bug found (swarm-125438-jp20-room item 3, bench-bug-fix-C-seed1/result.json from the first grid run,
`bench/results/rq1-grid1/`):** all 3 of that room's seats were killed by the harness's own deadline (`exit_code
143`, `usage: null` per seat), yet the run was still recorded `outcome: "task_pass"`, `cost_usd: 0`,
`turns.coverage: "none"` — the workspace file just happened to be untouched and score as a pass, which is not
the same as the run having had a fair attempt. Downstream, `bench-grid.ts`'s resumability logic
(`skip:done` once `result.json` exists) then treated this bogus result as permanently finished, and arm A for
that same seed was refused forever (`matchArmABudget` correctly throws on a non-positive paired cost, but
nothing ever re-ran arm C to produce a real one).

**Decision:** `timeout` is already in the five-outcome vocabulary fixed by
`docs/decisions/measure-task-success-on-a-machine-oracle.md` (`task_pass`, `task_fail`, `parse_failure`,
`timeout`, `infrastructure_error`) but nothing in the harness ever produced it. `scripts/bench-rq1.ts` now
tracks `killed_by_deadline` per seat (true only when *its own* deadline timer sent the kill, not any other
exit/signal) and, whenever any seat was killed by the deadline, records `outcome: "timeout"` unconditionally
— ahead of and instead of `scoreTask()` — regardless of whether the untouched/partial workspace would
otherwise have scored a pass or fail. A killed run is not a measurement of the mechanic; it is a measurement
of the deadline. `scripts/bench-grid.ts` no longer treats an on-disk `timeout` result as finished: on the next
invocation it removes that run's directory and retries it, the same as an interrupted run with no
`result.json` at all, so a timed-out arm C automatically unblocks its paired arm A on a later grid invocation
instead of staying stuck.

**Usage capture surviving a kill:** `claude -p --output-format json` prints its single JSON blob only on a
clean exit, so a killed seat's usage was unrecoverable outright. Both arms now run
`--output-format stream-json --verbose` (`src/claude-args.ts`, additive `outputFormat` option — the launcher
and `request_agent` recruit paths are unaffected and still default to `--output-format json`, per
`token-cost-is-resent-context`'s "so recruits report usage" ruling; this is a harness-only opt-in, not a
policy change). stdout is now NDJSON, one event per line, so a kill still leaves every event flushed before it
on the pipe. Confirmed live against the real CLI (`claude -p "Say hello..." --output-format stream-json
--verbose`, this room, one API call): the trailing `type:"result"` event has the identical shape
`parseClaudeCliOutput` already parses (`total_cost_usd`, `usage.{input,output,cache_*}_tokens`, `num_turns`,
`duration_ms`, `duration_api_ms`), so a clean-exit run's result fields are unchanged. `total_cost_usd` exists
*only* on that trailing `result` event — a killed seat's real cost genuinely cannot be recovered from the
stream (confirmed by the same live call: intermediate `type:"assistant"` events carry per-turn token usage but
no cost field) — so `usage` correctly stays `null` for a killed seat, exactly as an unmodified clean-exit
failure already read, and `rollupUsage` keeps marking it `coverage: "none"`/`cost_usd: 0` without zero-filling
an unknown cost as a real one. What *does* survive a kill is per-turn token counts, kept as a new, separate,
purely additive `partial_usage` field (`output_tokens` summed, latest `input_tokens`/cache token counts,
`assistant_messages_observed`) on each seat record — forensic signal only, never read by `rollupUsage` or any
cost-summing code, so it cannot silently inflate a reported spend.

## 2026-09-18 — Default deadline raised from 300000ms to 900000ms

**Evidence (`bench/results/rq1-grid1/bench-bug-fix-C-seed1/data/rq1.jsonl` timestamps, the first grid run):**
room created 12:47:49Z; the blind-openings reveal (3 seats, code task) did not land until 12:50:08Z — 139s
spent just on independent openings, before any seat could read another's answer, propose, edit a file,
challenge or verify. That left only ~149s of the old 300000ms deadline for everything else a code-task room
needs (file edits, a proposal, a challenge, a verification command's exit code, a vote) — mechanically not
enough, and part of why that room never concluded (compounded by item 1's tool gap). For comparison,
`bench-fact-check-C-seed1` (a simple recall task, same seat count) revealed at 34s and concluded at 111s total
— the 300s default was never actually tight for the easy task, only the code one.

**Decision:** `scripts/bench-rq1.ts`'s default `--timeout-ms` (and therefore `--deadline-ms`, which defaults
to it) is now 900000ms (15 minutes): the observed 139s reveal, plus real room-mechanics round trips (edit,
propose, a `verify/*` command's own exit code, challenge, vote) a code task needs and the old default never
gave a chance to happen, with headroom rather than a value tuned to exactly clear the one observed run. Not
derived from a distribution of many runs (this harness had none to draw from before this fix) — revisit once
the grid has produced enough real timing data to size it more precisely instead of from a single room's
timestamps.

## 2026-09-18 — `bench-long-brief` retired from the RQ1 accuracy comparison, not built (sonnet-1, swarm-140131-j6yf-room)

**Protocol text:** §3 (quoted above, "A known wiring gap in one existing task") treats `bench-long-brief` as
"not yet usable for RQ1-RQ3's primary task-success metric" and says it should be "added once its handoff
scorer is wired" — i.e. the pre-registered expectation was that the scorer gap would eventually be closed,
not that the task would be dropped. This room's brief gave the explicit option to build the missing
`"handoff"` case in `scripts/bench-oracle.ts`/`scripts/bench-rq1.ts` **or retire the task**.

**Why building it is not viable, let alone small (checked directly against this checkout):**

1. **The fixture is calibrated against the wrong harness.** `tasks/bench-long-brief/README.md` and
   `scripts/handoff-task-fixture.test.ts` derive the task's difficulty from `src/seat.ts`'s internal
   step/context-budget constants (`MAX_STEPS=60`, `MAX_CONTEXT_CHARS=240_000`, `MAX_TOOL_CHARS=6000`,
   `READ_WINDOW=400`) and the `r1-proactive-handoff` mechanic (`docs/decisions/r1-proactive-handoff.md`) that
   fires on *that* internal engine's own step/token counters. `scripts/bench-rq1.ts` (the runner this suite's
   grid actually uses, confirmed by reading it directly) spawns the real `claude` CLI as a subprocess via
   `claudeArgs()` — that CLI has no step-count or context-budget ceiling flag (already established in this
   file's first entry, "No token/turn ceiling in the `claude` CLI"), so there is no lever in the real-Sonnet
   harness to force a seat to hit the budget this fixture assumes. The 20-file/84KB brief size is not
   inherently too large for a real Claude Code seat with its own much larger context window and no externally
   imposed step cap; nothing makes it exceed a *real* seat's budget the way it provably exceeds the internal
   engine's frozen one.
2. **The metric is asymmetric by construction, which breaks the comparison this whole suite exists to make.**
   `bench-rq1.ts` gives arm A `--tools` with no `mcp__chatroom__*` entries at all (`baseTools` only, no
   `mcpJson` chatroom server) — a single arm-A seat has no `board_set`, no `claim/*`, no `leave_room`-with-
   reason concept to hand off through. "Handoff survival" (`handoff/*` board entry + `leave_room` reason) is
   a room-native mechanic; it cannot be measured on arm A at all, symmetric or not. A task whose oracle only
   arm C can even attempt is not an accuracy-comparison task under
   `docs/decisions/measure-task-success-on-a-machine-oracle.md` ("a hub mechanic is judged by a machine-
   checked task outcome on the same brief **across two builds**" — here it would be across two *arms*, and
   one arm structurally cannot produce the measured signal). It is a robustness/survival metric for room
   mechanics specifically, not a "team vs. one agent" accuracy task, which is this room's actual charge.

**Decision:** `bench-long-brief` is retired from the admitted task suite and from every grid command this
room produces (§5 of the room brief). It is not deleted (its fixture and `README.md`'s documentation of the
R9.1 dependency remain valid as a record of *why* it doesn't fit this harness), but it must not be passed to
`scripts/bench-grid.ts --tasks`. `paper/protocol.md` §3's line "added once its handoff scorer is wired" is
superseded by this entry: the scorer gap will not be closed for this suite, for the structural reason in
point 2 above, not merely because it is a lot of engineering effort.

## 2026-09-18 — Small cross-document tasks are a ceiling family for real Sonnet, arm A (sonnet-1)

**Finding:** five different `bench-cross-doc-*` task designs (on-call roster 4-hop relay; the same relay with
a primary/secondary field-indirection trap; a stale-vs-ratified budget figure needing an 85% recompute; both
of those again with the brief not naming which files to read or that a conflict exists; a three-document
policy-precedence task requiring a conference exception to override a more textually salient regional
amendment) were each piloted 5x on arm A (real Sonnet, `scripts/bench-rq1.ts`, exactly as the grid runs it).
All 25 runs (5 designs x 5 seeds) scored `task_pass`, 0 failures, ~$0.03/run, 4-8 turns each. Full numbers on
the room board, keys `pilot/bench-cross-doc-oncall-v1`, `-v2`, `-v3-and-budget-v2-and-precedence-v1`.

**Why (not merely "the trap wasn't clever enough"):** `scripts/bench-rq1.ts` gives arm A `Read, Write, Bash,
Glob, Grep`, a 900s deadline and no turn ceiling. A task directory with 3-4 short files is cheap enough that
a capable agentic seat reads every file in it as a matter of course — there is no realistic pressure to stop
early or guess from a single file, and `Bash` lets it verify any arithmetic exactly (`120000*0.85=102000` was
computed via a shell one-liner in the transcript, not mental math), which is why even a rounding-flavored
design didn't discriminate either. Multi-hop indirection and multi-way precedence logic, which are exactly
the traps this suite's task-family list suggests, are well within a tool-using Sonnet's reach when the total
reading material is small. This is a negative result specific to *small* cross-document tasks under *this*
harness's generous budget, not evidence that cross-document tasks in general cannot discriminate — a
scaled-up version (more files, genuine skim/skip risk) converges with the long-brief-constraint family
(`claim/data-cleaning-and-long-brief-constraint`, sonnet-5) and was not pursued further here to avoid
duplicating that work; see that family's admitted tasks for whether scale succeeds where these five did not.
A sixth design tested the scale hypothesis directly: `bench-cross-doc-notes`, ten short standup-note files, the
original launch date (March 14) in file 3 and a quiet correction (March 21) in file 8, no hint in the brief that
a correction exists or which file holds it. 5/5 `task_pass` (~$0.02-0.20/run, 4-16 turns; the costly outlier
still passed). The seats used `Grep` for the project name, which turns file count into a non-obstacle: a
distinctive keyword makes N files as cheap as one. Scale only costs attention when the deciding sentence
cannot be found by a keyword search (no shared distinctive term, or a correction phrased without the entity
name). Total for this family: 30 arm-A runs over six designs, 30/30 pass, ~$1.26.
`bench-cross-doc-oncall`, `bench-cross-doc-budget`, `bench-cross-doc-precedence` and `bench-cross-doc-notes`
are not included in the admitted suite.

## 2026-09-18 — Data-cleaning candidate `bench-ledger-parse` rejected: 3/5, then 5/5 after the brief was made unambiguous (sonnet-1)

A code task: repair a naive `parseLedger` for a bank CSV export whose quirks (BOM, CRLF, quoted commas,
doubled quotes, an embedded newline in a quoted payee, quoted thousands-separated amounts, `DD Mon YYYY` dates,
float-cents such as 19.99, padded payees) sit in a handful of rows of a 300-row public sample, with a second
hidden 240-row export moving the quirks to other rows (private-test oracle, generic code scorer). Scorer and
both fixtures were verified (broken fixture fails 6 of 7 named checks, correct passes 7 of 7).

- v1, five arm-A runs: 3 `task_pass`, 2 `task_fail` (~$0.07-0.12/run, 5-12 turns). Seed 1 missed the `DD Mon
  YYYY` dates (a real reasoning miss). Seed 2 collapsed the newline inside a quoted payee, which the v1 brief
  did not forbid (the passing seats kept it and said the brief did not ask to normalise): an ambiguity in the
  task, not a reasoning failure, so the 3/5 is not admissible evidence of discrimination.
- v2 (brief now states that characters inside the payee are kept as written): 5/5 `task_pass`, ~$0.067/run,
  6-8 turns. Seats scanned the whole sample, found every quirk class, and the two that were only guesses
  (US-style dates, currency symbols) do not appear in the hidden export.

Rejected by the admission rule (5/5). Cost of this candidate: ~$0.76 across 10 runs. It is the closest any
of this author's seven designs came to a split, and the split was half ambiguity. A trap that the agent's own
scan of the provided data can reveal is found by a seat that scans the data.

## 2026-09-18 — `bench-pipe-errata` rejected: a spec plus a later errata document is implemented, not traced (sonnet-1)

Exact-answer task: a 14-operation list-transform language (`spec.txt`), a later `errata.txt` that overrides
or withdraws parts of it (an erratum amending an erratum, a conditional erratum keyed on list parity, an
astral-plane input item whose length differs between UTF-16 units and code points), a 30-line program over
12 strings, six PRINT lines to concatenate into one answer. Expected answer produced by a JavaScript
reference and independently reproduced by a separate Python implementation (byte-identical). The design
borrowed the "many independent counter-prior quirks, program too long to trace by hand" lever that produced
the room's first split (`stamp-interpreter`, sonnet-2) and added a cross-document precedence layer on top.

Arm A, five runs: 5/5 `task_pass`, ~$0.038/run, 3 turns each. Every seat wrote an interpreter in a scratch
script implementing both documents at once and printed its output; two stated "I did not hand-check the
trace; the answer is the script's output". The errata add no difficulty for a seat that implements rather
than reasons: applying an override is one more `if` in the script. Twelve operations with one line of
semantics each are within a single careful script; `stamp-interpreter` differs in having a nested-scope
language (closures, `GLOBAL`, `SETS`) where the semantics interact, which is what a script can get wrong.

Family tally for this author: 8 designs (three cross-document puzzles at 2-4 files, one at 10 files, one
three-document precedence puzzle, a CSV data-quirk parser, this errata interpreter, plus the retired
long-brief) and 45 arm-A runs, 0 admitted, about $2.6 of the room's pilot budget.

## 2026-09-18 — `bench-url-resolve` rejected at the 3-seed screen: a complete spec for real-world semantics, 3/3 (sonnet-1)

Built on the maintainer's second lever (faithful reimplementation of real-world semantics with many
interacting rules, expected values from a real reference). `resolveUrl(base, ref)` for http(s): a complete
eight-step README (whitespace and control stripping, backslashes only in the front, "http:foo" against an http
base being relative but "https:foo" being a host, default-port removal, `%2e` dot segments, three different
percent-encode sets, an empty `?` or `#` kept). The oracle was 100 hidden (base, ref) cases, 38 curated and 62
seeded-random, whose expected values were produced by node's real `URL`. Before any pilot, a README-only
reference written by the task author agreed with node's `URL` on 38,924 generated (base, ref) pairs with zero
mismatches (after restricting hosts to plain ASCII, which the README states), so the README determines every
expected value. The scorer rejects any use of the `URL` class (source scan plus the global deleted at run
time); a `new URL` cheat scored 0, the stub 0/100, the reference 100/100.

Arm A, screen of three seeds: 3/3 `task_pass`, ~$0.056/run, 4 turns each. No seat compared its code with
`URL` in a shell; each wrote the resolver in one pass and every final message reports only the edge cases the
README leaves open (an all-zero port, lone surrogates, characters after a port colon), none of which the oracle
tests. Rejected under the maintainer's rule (stop at 3/3); seeds 4 and 5 were not spent.

What this adds to the record next to `bench-ignore-rules` (4/5, one slip: a regex-escaping bug plus never
running the code): a README of about forty lines with eight numbered steps is not by itself long enough to make
one seat slip. The two in-band tasks are much longer to execute (`stamp-interpreter`: 87-line spec, 104-line
program) or have 39 cases over more independent rules. Cost of this candidate: about $0.17 for the pilots.

## 2026-09-18 — Raised admission bar for the discriminating suite, and how the suite's independence is counted (swarm-150725-3vny-room)

**Why the old bar was too weak.** The predecessor rule (swarm-140131-j6yf) admitted a task on 1 to 4 passes of 5 arm-A runs. Two of the three tasks that met it (`bench-doc-audit`, `bench-ignore-rules`) turned out, with five more seeds each, to pass 9 of 10. A true single-agent rate near 0.9 leaves a team at most 0.1 to gain; no feasible number of grid seeds separates the arms on such a task. Five seeds cannot tell 0.9 from 0.6: the exact 95% interval of 4 of 5 is roughly 0.28 to 0.99.

**Rule (supersedes item 2 of the predecessor rule, applied to every task including the earlier survivors).**
1. A task's arm-A rate is measured on **at least ten seeds**, run exactly as the grid runs arm A (`scripts/bench-rq1.ts TASK A SEED --model sonnet`). Three seeds are a screen only: 3 of 3 rejects the task without further spend; a task is never admitted on fewer than ten.
2. Rate **0.3 to 0.7 inclusive**: admitted, and part of the **primary comparison**.
3. Rate **above 0.7 and up to 0.9 inclusive**: kept, labelled a **weak discriminator**, excluded from the primary comparison (it may be reported as a secondary result).
4. Rate **above 0.9, or 0**: retired.
5. `ADMISSION.md` records the rate, the seed count and the per-seed outcome (with cost and turns), plus the final text of failures so a format failure is not counted as a reasoning failure. Every admitted task also needs the non-author attack (public files determine the answer; the oracle cannot be passed without solving) recorded there.
6. Screening discipline: a variant of a family that has failed twice is not piloted without a posted reason. A task whose only fails are one and the same item (`stamp-interpreter`: token 32; `bench-printf-format`: case 458) is admitted on its rate but flagged as a single-trap task: its p is the chance of one slip, not a difficulty gradient.

**Independence: the statistical unit is the family, not the instance.** N instances generated from one template (same specification, same mechanism, new numbers or a longer program) are ONE family. They share the failure mechanism, so their seeds are not independent draws of "task difficulty", and any interval or test over tasks must resample or cluster by family. Two tasks belong to one family if a seat that had learned the trap in one would carry it into the other. Applied: `bench-shelf-lang` and `bench-shelf-long` share `SPEC.md` and are one family (both 9 of 10; tripling the program length did not move the rate). Families are counted by mechanism, not by name, so "invented-language interpreter" tasks (stamp, shelf, quill) are argued case by case in the count below, not merged or split by their label.

*[The admitted-suite table, the count of distinct families and the grid command are appended below at room conclusion.]*

**Not carried forward from the predecessor room (unproven or out of scope for this room):** `scripts/bench-ak.ts` and the A-k arm specification on `swarm/swarm-140131-j6yf/sonnet-7` (no pilot, not part of this room's brief); `bench-logic-grid-{2,3,4}` (same family as `bench-logic-grid`, retired unpiloted with a reason on the board).
