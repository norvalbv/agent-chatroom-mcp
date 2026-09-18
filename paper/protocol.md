# Evaluation protocol (pre-registration)

Status: pre-registration. No results are reported here or anywhere under `paper/` from this room. This
document fixes, before any run, what will be measured, how, on what tasks, with what statistics, and what
outcome would count against the system. Every claim about how the hub currently behaves is checked
against source in this checkout (file:line, verified at HEAD `cd64ea9`) or a decision record with its own
sources (`docs/decisions/*.md`); nothing is asserted from memory of a prior run.

## 1. Research questions and hypotheses

**RQ1 (does coordination beat one agent at equal spend).** At matched budget (same model, same token
ceiling, same task), does a multi-agent chatroom room reach a higher task-success rate than a single agent
working alone?
- H1: chatroom task-success rate > single-agent task-success rate on the oracle task suite (§3).
- H0 (null, stated before any run per the maintainer's brief): the chatroom does *not* beat a single agent
  on cost-per-correct-answer, and may not beat it on task success either — the one existing A/B on this
  codebase's own attention-gate change went the *wrong* direction (pre-gate build passed
  `bench-fact-check`, post-gate build failed it, delta −1, one seed;
  `docs/decisions/measure-task-success-on-a-machine-oracle.md`). A result that reproduces that direction
  at n≥5 seeds would be evidence against the system, not a bug to explain away.

**RQ2 (does coordination beat a cheaper non-chat multi-agent baseline).** Does the chatroom beat a
builder-plus-reviewer sub-agent pair with no chat (one shot, no deliberation) on task success and on
cost-per-correct-answer?
- H1: chatroom task success ≥ builder+reviewer pair, OR chatroom cost-per-correct is not more than Xx the
  pair's (X fixed at 3, see §6) — i.e. any success-rate advantage must not come at unbounded cost. The
  maintainer's own estimate (docs/token-round-0918.md, docs/review-round-0918.md) is that a five-seat build
  room cost $70.97 at API prices for one task the pair might do for ~$15; that estimate is untested and is
  exactly what this protocol is designed to test.
- Falsifier: chatroom cost-per-correct-answer exceeds the pair's by more than 3x with no matching success
  gain.

**RQ3 (which hub mechanics carry their cost).** For each of the seven ablatable mechanics (§2.3), does
switching it off change task success, cost, or wall time, relative to the full hub?
- Per-mechanic H1: turning mechanic M off changes task-success rate on the oracle suite (two-sided; §6
  states the test and the multiple-comparisons correction).
- Per-mechanic H0: no detectable difference at the sample size in §6 — stated in advance as the expected
  outcome for at least some mechanics, since several were adopted on process-metric evidence only (reply
  rate, manifest bytes) and this project's own decision record says process metrics are not task success
  (`docs/decisions/measure-task-success-on-a-machine-oracle.md`, citing arXiv:2608.30373, arXiv:2609.03619,
  arXiv:2609.00683).

**What would count against the system, stated now, before any run:**
1. Chatroom task success not exceeding single-agent task success at matched budget (RQ1 falsified).
2. Cost-per-correct-answer more than 3x the builder+reviewer pair with no offsetting success gain (RQ2
   falsifier above).
3. Any of the seven mechanics showing a *negative* delta on the oracle suite across ≥3 seeds — repeating,
   with more seeds, the one existing attention-gate result that already went the wrong way once.
4. A held-out oracle task solved correctly by an arm at a rate indistinguishable from guessing even when
   every other arm succeeds — evidence the task, not the mechanic, drove the result (a task-suite failure,
   not a system failure, but reported either way).

## 2. Conditions

All conditions run the *same* task suite (§3), the same model per tier (§6), the same wall-clock timeout
per task, and are launched by the same scripted harness (`scripts/bench-*.ts` extended per §2.4), never by
a room like this one — this room only pre-registers; `bench/`, `tasks/`, and
`docs/decisions/measure-task-success-on-a-machine-oracle.md` describe the existing harness this protocol
extends rather than replaces.

### 2.1 Baseline arms
- **A — Single agent, matched budget.** One model instance, no chat, the task brief only, a token/turn
  budget matched to the mean per-arm cost of arm C (chatroom) on the same task (computed post hoc per task
  from `usage.cost_usd`/`usage.input_tokens+cache_read_input_tokens+cache_creation_input_tokens+output_tokens`
  in that task's `result.json`, then fixed for the paired run — budget matching is *within-task*, not a
  single number reused across tasks, because task difficulty and hence chatroom cost vary).
- **B — Builder + reviewer sub-agent pair, no chat.** Two model instances in a fixed pipeline: builder
  produces a patch/answer, reviewer sees the builder's output and the brief only (no access to a shared
  room, no board, no votes) and either approves or sends back one revision request; at most one revision
  round. No MCP chatroom tools are available to either instance.
- **C — Chatroom, full hub.** The existing `join_room`/`submit_opening`/`send_message`/`propose`/
  `challenge`/`vote`/`board_set`/`wait_for_messages` surface (`src/hub.ts`, `src/server.ts`) with
  `require_challenge` and `require_verification` on, matching how build rooms in this repo actually run
  (e.g. this room's own launch settings).

### 2.2 Fixed room size
Arm C uses a fixed seat count per task tier (declared per task in §3, not tuned per run) so that mechanic
ablations (§2.3) are the only thing varying between a run and its paired ablation run.

### 2.3 Ablations — single hub mechanic switched off, chatroom arm C otherwise unchanged
Each ablation is a separate arm, C minus one mechanic, never more than one removed at a time (so a
regression is attributable). Every mechanic named here is verified to exist in this checkout, with its
enforcement point, checked against HEAD `cd64ea9`:

1. **Blind openings off.** `submit_opening` normally holds each seat's first answer private until all
   openings are in (`src/hub.ts`, `Room.openings`/reveal-on-complete logic; user-facing description in the
   `submit_opening` MCP tool spec). Ablation: openings are visible immediately (seats see prior openings
   before writing their own), testing whether independent-first-answer reduces anchoring on this task
   suite.
2. **Quote-checked votes off.** Normally `vote(..., vote:"agree")` requires a verbatim 15+ character quote
   from the current proposal text, checked with `norm(proposal.text).includes(norm(quote))`
   (`src/hub.ts:2130-2133`). Ablation: agree votes accepted with no quote requirement, testing whether
   forced re-reading of the proposal text changes outcome quality.
3. **Challenge gate off.** Normally `requireChallenge` (room option, default `"auto"`, evaluated as true at
   2+ voters by `challengeRequired()`, `src/hub.ts:1987-1989`; the `RoomOptions`/`Room` field declarations
   are at `src/hub.ts:231` and `:256`) blocks a proposal from passing until someone other than the proposer
   posts a challenge naming its weakest claim. Ablation: `requireChallenge:false`. **Repo-drift note:** the
   inline comment at `src/hub.ts:230` still reads `"auto" = when 3+ active`, but the method it documents
   checks `this.voters(room).length >= 2` (`src/hub.ts:1988`) — the comment is stale, the enforced
   threshold is 2, matching `docs/decisions/consensus-requires-scrutiny.md` and `README.md:105`; a reader
   should not trust the comment text over the code.
4. **`require_verification` with machine-readable verdicts off.** Normally a `verify/*` board entry counts
   only if its first line parses as JSON `{proposal, command, cwd, exit_code, output_tail}` with
   `exit_code:0` and the exact proposal id (`docs/decisions/done-means-independently-verified.md`; JSON
   shape comment at `src/hub.ts:32`). Ablation: any `verify/*` text (prose or JSON) satisfies the gate, as
   before the 2026-09-18 peer-review build (`docs/review-round-0918.md`, item 1).
5. **Attention gate off.** Normally an `@`-addressed message is re-served (with a reply/pass hint) on every
   `wait_for_messages`/`read_messages` call to its addressee until they reply or `pass()`, rather than being
   one message among many (verified live in this checkout: `attentionGate`/`addressed_to_you` logic in
   `src/hub.ts` and `src/server.ts`, confirmed by grep in this run). Its decision record,
   `docs/decisions/proposed/addressing-attention-gate-certified-partial.md`, is still under `proposed/` —
   not yet promoted to a settled axis by a human — and itself lists open tradeoffs (unmeasured live-after
   effect, no resource bound on withheld backlog, unreproduced original baseline). This protocol treats the
   mechanic as real (it is enforced in code, commit `2f2cacbc7b3eccb53add5a1e5b3025a6d78f46b6` per that
   record, confirmed present in this checkout) but not as an already-settled design decision. Ablation:
   addressed messages delivered once, like any other message.
6. **Held waits off.** Normally `wait_for_messages(hold_until_actionable=true)` holds a seat's poll until
   something it must act on arrives, rather than returning on any unread message
   (`scripts/idlewaits-actionable-regression.ts`; described in `docs/token-round-0918.md` item 2).
   Ablation: `hold_until_actionable` unavailable/ignored, every seat wakes on any unread message (this
   ablation is expected to raise token cost per `docs/token-round-0918.md`'s "First measurement" table —
   RQ3 asks whether it also changes *task success*, which that measurement did not test).
7. **Assigned reviewers off.** Normally the hub assigns a reviewer when a `claim/*` area is first created —
   the active non-owner (never the same session) with the fewest reviews already assigned, ties broken by
   least-recently-verifying then earliest join (`src/hub.ts:1835-1849`, comment at `:1835-1837`; assignment
   call at `:1786`; the reviewer-notice text at `:1827`) — and prefers that reviewer's `verify/*` entry
   (`docs/review-round-0918.md` item 2). The "fewest reviews assigned first" tie-break was added at commit
   `cd64ea9` specifically because, without it, an opening burst of claims (every candidate tied at zero
   reviews and zero verify history) assigns every claim to whichever seat joined earliest: this is not a
   hypothetical failure mode but the exact bug that stalled this paper's own prior identical-task room,
   `swarm-113146-9k8v` (one seat assigned reviewer for 6 of 7 claims; see that room's transcript, message
   #40). Ablation: revert to the pre-`cd64ea9` tie-break (least-recently-verifying active non-owner,
   ignoring assignment count), reproducing the burst-assignment failure mode on purpose so RQ3 can measure
   whether it costs task success/time or only felt bad procedurally.

### 2.4 What is fixed across all arms
Model and version pinned per tier (§6); prompt template fixed per arm type (baseline prompts for A/B do not
reuse chatroom-specific instructions like quiet messaging); per-arm token/turn budget fixed and reported;
build hash pinned at launch — the executable (`dist/hub.js` sha256), the HEAD commit, the task fixture
sha256, and the scorer sha256 are all recorded in each run's frozen block, extending the existing pattern
in `bench/results/*.json` (`frozen: {seat_entry_sha256, provider_entry_sha256, task_sha256, scorer_sha256,
...}`, confirmed present in `bench/results/real-ab-r2/bench-compare.json`'s per-arm records) to every arm,
not only the two bench-harness arms it covers today. No arm sees another arm's transcript. Task order
randomized per seed.

## 3. Task suite

**What exists today, to build on rather than replace:** three hidden-fixture oracle tasks —
`tasks/bench-fact-check`, `tasks/bench-bug-fix`, `tasks/bench-long-brief` (each with `task.json` holding
only `{task_id}`, `oracle/` holding `oracle.json` and, for `bench-bug-fix`, `score.ts`, and `public/` holding
the agent-visible `brief.txt` plus corpus files; `bench-bug-fix`/`bench-long-brief` additionally have a
`README.md`; `bench-bug-fix` also has `fixtures/correct/` and `fixtures/broken/`) — scored by
`scripts/bench-oracle.ts` against `scripts/bench-bench.ts`'s harness, using the
outcome vocabulary fixed in `docs/decisions/measure-task-success-on-a-machine-oracle.md`: five outcomes
(`task_pass`, `task_fail`, `parse_failure`, `timeout`, `infrastructure_error`), a `comparable` flag that
excludes only infrastructure/timeout/tamper, and full-string-equality answer scoring after documented
conservative normalization (`bench-fact-check`'s existing scorer: answer-only equality, not substring or
containment, per the rejected-alternatives list in that decision record).

**Kinds of task and why.** The suite spans three task kinds already represented — closed-answer fact
retrieval from a private corpus (`bench-fact-check`), code bug-fix with a hidden test oracle
(`bench-bug-fix`), and long-brief instruction-following (`bench-long-brief`) — because they stress different
failure modes (retrieval/synthesis vs. code correctness vs. instruction adherence at length), and a
mechanic that helps one kind and hurts another is a real finding, not noise.

**A known wiring gap in one existing task (verified directly against `oracle.json` and `bench-oracle.ts` in
this checkout, not taken on report alone):** `tasks/bench-long-brief/oracle/oracle.json` declares
`"kind": "handoff"`, but `scripts/bench-oracle.ts`'s `scoreTask()` only special-cases `"inclusive-dates"`
(`scripts/bench-oracle.ts:16`); any other kind, including `"handoff"`, falls through to the fact-check
default path, which returns `parse_failure` whenever `<workspace>/answer.txt` is absent
(`scripts/bench-oracle.ts:42-44`) — and no agent is expected to write `answer.txt` for this task. This
*matches* the task's own documented interim behavior (`oracle.json`'s `note` field, quoted verbatim: "No
completion expected: the brief is deliberately longer than the frozen seat budget (3 min / 60 steps / 240k
context). The measured outcome is the survival verdict: seat exit code 0, at least one handoff/* board
entry in the arm's data dir, and a leave_room reason naming the handoff(s). Runner-side enforcement (seat-
exit-as-completion barrier + survival verdict in bench-bench) belongs to R9.1 (lobby claim/goal-4-hash-
closure); until it lands, treat this task's task answer as parse_failure and read handoff survival from the
arm data dir."). The practical consequence for this protocol: **`bench-long-brief` cannot currently produce
a `task_pass`/`task_fail` signal from `scoreTask()` alone** — every seed will score `parse_failure`
regardless of whether the agent actually handled the handoff correctly, until the survival-verdict runner
logic described in that note is built. This protocol therefore treats `bench-long-brief` as **not yet usable
for RQ1–RQ3's primary task-success metric** and requires wiring that survival-verdict check as a
prerequisite before it counts toward n; until then it is at most a secondary/diagnostic task reported
separately, not pooled with the other two. The primary task suite for §5's sample-size and power
calculations is therefore **`bench-fact-check` and `bench-bug-fix`** (n=2 tasks), with `bench-long-brief`
added once its scorer gap is closed — an explicit, stated reduction from "three tasks" to "two tasks usable
today," not a silent one.

**How many.** At minimum the two currently-scorable tasks, each run at n≥5 seeds per arm (§6) rather than the
n=1-seed A/B this repo has run so far, with `bench-long-brief` added once its handoff scorer is wired.
Before spending budget on new tasks, this protocol treats *seed count on existing tasks* as the first
priority (§6), since the one existing result already flagged n=1 as the weakness
(`docs/decisions/measure-task-success-on-a-machine-oracle.md`, "Anchored-bet": more tasks and
seeds sharpen the estimate, they do not change the method). New tasks are explicitly out of scope for this
pre-registration; adding them requires the same hidden-fixture discipline below and a separate
pre-registration amendment before any arm sees them.

**How fixtures stay hidden.** Each task's private answer/test lives under `oracle/` (and `fixtures/` for
`bench-bug-fix`), never under `public/`, which is the only directory the agent under test can read
(filesystem isolation, per `docs/decisions/measure-task-success-on-a-machine-oracle.md`'s "fixtures hidden
by filesystem isolation"). The harness must run the agent under test in a working directory containing only
`public/`, and score by invoking the oracle/tests from outside that directory after the agent's process
exits — this protocol requires that isolation be verified once per task (a probe that confirms the agent
process cannot `read`/`glob` outside its assigned root) before that task is used in a real run, and recorded
as a `verify/*`-style artifact.

**Why machine oracles only, no model judging a model.** Two independent reasons already on record in this
repo, both grounded in fetched sources: (1) LLM-as-judge has documented validity limits — surface-form bias
and counterfactual insensitivity (arXiv:2306.05685, arXiv:2609.02942, per
`docs/decisions/measure-task-success-on-a-machine-oracle.md`); (2) this project's own containment-style
oracle was refuted by a negation counterexample during that decision's own research
(`evidence/oracle-audit-plan-u19`, cited by that same record) — an oracle that is *not* an exact-answer or a
real test-suite pass/fail is not safe from a negated or superficially-similar wrong answer either. Full-
string answer equality and hidden-test pass/fail are the only scoring methods this protocol permits as
primary.

**Contamination and leakage.** (1) No oracle task's answer or hidden test may be derivable from any file
under `paper/`, `docs/`, or any public branch reachable from `main` at run time — a task is disqualified
from use the moment its answer appears in a committed, non-`oracle/`/`fixtures/` path. (2) Task corpora
(`bench-fact-check`'s `records.txt`-style source) must not appear verbatim in any model provider's public
training-adjacent surface (i.e., must be repo-original text, not copied from a public page) — this is
already how `bench-fact-check` is built (`docs/decisions/measure-task-success-on-a-machine-oracle.md`
rejected "a no-answer-in-public guard" only because *legitimate* public retrieval is allowed within a task,
not because leakage of the *answer itself* is acceptable; the distinction is the corpus, not the ability to
search). (3) Before each real run, a leakage check re-hashes the whole task directory tree (`hashTree(taskDir)` —
the existing method in `scripts/bench-bench.ts:66`, already covering `task.json`, `oracle/`, `public/`,
and `fixtures/` where present) against the `frozen.task_sha256` recorded at task-authoring time and refuses
to run on a mismatch (the harness's own existing "tamper" outcome, `scripts/bench-bench.ts:81,111,117-118`),
so a task edited after being seen by any arm cannot silently contaminate later seeds.

## 4. Metrics — defined exactly, from fields that exist today

All metrics are computed only from fields already present in this repo's artifacts; no new artifact schema
is required to compute any metric below (the frozen-block extension in §2.4 is the one addition, and it
reuses the existing `frozen` object shape from `bench/results/*.json`).

- **Task success.** Per task, per arm, per seed: 1 if outcome is `task_pass`, 0 if `task_fail`; excluded
  from the success-rate denominator (not scored 0) if outcome is `parse_failure`, `timeout`, or
  `infrastructure_error` — this matches the existing `comparable` flag in `bench/results/*.json`, which
  already excludes exactly these three outcomes from the "comparable" delta. Reported per task and pooled.
- **Cost per correct answer.** `usage.cost_usd` for the run (or, for a single-task arm, the task's
  attributable share of `usage.cost_usd` if the harness batches tasks in one process) divided by the count
  of `task_pass` outcomes in that arm's seed set. Undefined (reported as such, not as 0 or ∞) if zero
  `task_pass` outcomes. `usage.cost_usd` is an existing top-level field of `result.json`
  (confirmed against `swarms/swarm-102357-g062/result.json`: `usage: {steps, prompt_tokens,
  completion_tokens, cost_usd, seats, seats_with_usage, coverage, input_tokens,
  cache_read_input_tokens, cache_creation_input_tokens, output_tokens}`).
- **Tokens.** Reported as the four token fields verbatim from `usage` — `input_tokens`,
  `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens` — never summed into one number
  without labeling which are cache reads, since cache reads are priced differently from fresh input
  (`docs/review-round-0918.md`: "98 to 99% of it cache reads... caching cuts price, not token count").
- **Wall time.** `run.completedAt` minus `run.startedAt` (ISO timestamps, both present in `result.json`'s
  `run` object, confirmed in the same file) per run; for a multi-task batch, per-task wall time requires the
  harness to timestamp each task's start/end and is a harness requirement this protocol adds (§2.4/§7), not
  a new top-level artifact field.
- **Turns.** `usage.steps` where populated (OpenRouter seats write per-step counts; the same
  `swarm-102357-g062` `result.json` shows `steps: 0` for an all-Claude run because Claude seats do not
  populate this field — `docs/token-round-0918.md`: "Claude seats are launched with `--output-format json`
  and report input, cache-read, cache-creation and output tokens plus cost" but not a step count). Where
  `steps` is 0 across all seats and the run used only Claude Code seats, turns are approximated by model-turn
  count parsed from the seat's own JSON transcript output (`scripts/claude-room-usage.py`'s existing
  method, cited in `docs/token-round-0918.md`'s "First measurement" table columns "Model turns" and
  "wait_for_messages calls") and the approximation is labeled as such in every table that reports it — this
  protocol does not treat `steps` and transcript-derived turn counts as the same measurement.
- **Coverage caveat.** Every cost/token number is reported alongside `usage.coverage`
  (`"complete"|"partial"|"none"`) and `usage.seats_with_usage`/`usage.seats`; a `partial`/`none`-coverage
  run's cost/token numbers are reported as lower bounds, never averaged into a headline number alongside
  `complete`-coverage runs without that caveat stated in the same table.

## 5. Sample sizes, seeds, and reasoning

- **Effect size.** For task success (a binary proportion per arm), this protocol targets detecting a large
  effect (Cohen's h ≥ 0.8, e.g. 40% vs 80% pass rate) at α=0.05, power=0.8 using a two-proportion test —
  chosen as "large" deliberately because the existing evidence base (one A/B, one seed, one task) cannot
  support claims of a small effect, and a small-effect claim from an underpowered suite is exactly the "one
  benchmark number" failure the maintainer named. At h=0.8, a two-sample proportions power calculation
  (arcsine approximation, `n ≈ ((z_{α/2}+z_β)/h)^2` per side) gives n≈12 per arm per task; this protocol
  rounds to **n=15 seeds per arm per task** as the target for a *conclusive* per-task claim, and treats
  **n=5 seeds per arm per task** as the minimum for a *directional* result reported with that label, matching
  the "direction, not effect estimate" language already used for the single existing A/B
  (`bench/results/real-ab-r2/bench-compare.json`, confirmed field `"delta_unit": "success indicator B minus
  A; single trial, not an effect estimate"`).
- **Test.** Two-proportion z-test (or Fisher's exact test when any cell count <5, standard for small-sample
  proportions) per task per arm-pair, two-sided. For cost-per-correct and wall-time (continuous, likely
  skewed), Mann-Whitney U rather than a t-test, since cost distributions are not assumed normal and the
  existing per-room cost figures (docs/token-round-0918.md, docs/review-round-0918.md) already show wide
  spread (e.g. build rooms 21.99–70.97 USD across five rooms).
- **Multiple comparisons.** RQ3 tests seven mechanics; a per-mechanic-per-task test multiplies the family to
  7 mechanics × 2 primary tasks (`bench-fact-check`, `bench-bug-fix`; `bench-long-brief` excluded from the
  primary family per the scorer-gap note above) = 14 tests. Holm-Bonferroni correction is applied within
  each RQ's family (RQ1, RQ2 as single-family two-arm comparisons per task = 2 tests each on the primary
  suite; RQ3 = 14 tests) rather than one correction across all three RQs, since they are logically distinct
  questions (arm-type vs. mechanic-ablation) that a reader would not expect to trade off against each other.
  If `bench-long-brief` is later added, its tests join each family as a third element and the correction is
  recomputed, not appended after the fact.
- **Seeds.** A seed fixes the arm's random elements (task order within a batch, sampling temperature seed
  where the provider exposes one, and — for arm C — which seat name maps to which room role where that is
  randomized). Same seed value is reused across arms being compared directly (paired-seed design) so that
  any shared source of task-difficulty variance (e.g. an ambiguous phrasing in one seed's exact prompt
  rendering) cancels in the paired comparison; this requires the harness to accept an explicit `--seed` and
  apply it identically to every arm, which `scripts/bench-bench.ts` does not yet do for non-bench arms (a
  harness gap, not a design gap — recorded in `paper/figures.md`'s script requirements).

## 6. Fixed-across-arms details (model, prompt, budget, build hash)

- **Model:** one pinned model id and version string per tier (Claude Sonnet, Claude Haiku,
  `deepseek/deepseek-v4-flash-0731` via OpenRouter — the three tiers priced in `paper/budget.md`), identical
  across all arms within a tier-run; cross-tier comparisons are reported separately, never pooled.
- **Prompt:** the task brief (`public/brief.txt`) is verbatim identical across arms; per-arm
  scaffolding (chatroom tool instructions for arm C, the fixed builder/reviewer handoff prompt for arm B) is
  the minimum needed to make that arm functional and is versioned alongside the protocol so a later reader
  can diff it.
- **Budget:** token/turn ceiling per arm fixed as described in §2.1 (arm A matched to arm C's realized mean
  cost on that task); arms B and C run to their own natural completion (proposal accepted / builder-reviewer
  round limit) subject to the same wall-clock timeout as the existing bench harness
  (`bench/results/real-ab-r2/*.json`: `"timeout_ms": 300000`, confirmed).
- **Build hash:** `dist/hub.js` sha256, HEAD commit sha, task fixture sha256, and scorer sha256 all pinned
  and recorded per run (§2.4), extending the existing `frozen` block pattern.

## 7. Stopping rules

- A run for a given (task, arm) cell stops at n=15 seeds, or earlier if a sequential test (O'Brien-Fleming
  boundary at two interim looks: after 5 and after 10 seeds) crosses significance in either direction —
  interim looks are pre-registered here specifically to bound spend, given the cost figures in §1/§6.
- A cell is abandoned (reported as "not run to completion", not silently dropped) if infrastructure_error
  or timeout exceeds 30% of attempted seeds, since that indicates a harness problem, not a mechanic effect,
  and continuing to spend budget on it would not produce a comparable result (`comparable` flag, §3).
- No result is added to any arm's tally after that arm's seed target is reached, even if early seeds looked
  favorable — no early stopping for a favorable result, only for a harness failure or a pre-registered
  interim boundary.

## 8. Threats to validity

- **Single-codebase generalization.** All tasks and all mechanics are specific to this hub; nothing here
  claims the results generalize to other multi-agent frameworks. Stated as a limit, not hidden.
- **Bundled-build confound (already observed once).** The one existing A/B compared builds that differed by
  every mechanic merged that day, not one isolated mechanic (`docs/decisions/measure-task-success-on-a-machine-oracle.md`:
  "the two builds differ by every mechanic merged that day, so this is a bundled-build association, not gate
  causality"). §2.3's single-mechanic-at-a-time ablation design exists specifically to avoid repeating this;
  any future run that compares two builds differing by more than one mechanic must not be reported as a
  per-mechanic result.
- **Task-suite narrowness.** Three tasks across three kinds is not a broad benchmark; a mechanic that helps
  or hurts specifically on (say) code bug-fixing cannot be distinguished from one that helps or hurts
  broadly with only one task of that kind. This is stated as an open limitation, not resolved by this
  protocol — resolving it means authoring more tasks under the same hidden-fixture discipline (§3), which is
  out of scope for this pre-registration.
- **Judge-free scoring blind spots.** Exact-match/test-pass scoring cannot credit a correct answer phrased
  differently from the oracle's exact string (fact-check) or a correct-but-different-shaped fix that still
  passes hidden tests is fine, but a correct-but-differently-worded long-brief answer might not be capturable
  by `bench-long-brief`'s scorer without inspecting it — this protocol requires `bench-long-brief`'s scorer
  be read (not assumed) before it is used as a primary metric, and if it is answer-equality rather than
  hidden-test-pass, that scorer's tolerance for correct paraphrase must be documented in `paper/figures.md`
  before results are reported.
- **Provider nondeterminism.** Model outputs are not fully reproducible seed-to-seed even with a fixed
  "seed" parameter for providers that do not guarantee determinism; this is why n≥5 seeds is the floor
  rather than n=1, not a flaw this protocol can eliminate.
- **Cost estimates are provider list-price, not amortized infrastructure.** `usage.cost_usd` reflects API
  list pricing (`docs/review-round-0918.md`'s "API-price cost" column label); it excludes the maintainer's
  actual subscription-vs-API cost structure for Claude Code seats, which is a real difference `paper/budget.md`
  must state explicitly rather than this protocol silently assuming API pricing is the maintainer's true
  cost.
- **Protocol-authoring confound.** This protocol was itself written by chatroom seats coordinating with the
  exact mechanics it proposes to ablate (assigned reviewers, quote-checked votes, the challenge gate). That
  does not invalidate the design, but a reader should note the authors are not blind to which mechanics they
  expect to matter, which is a reason the falsification criteria in §1 are stated before any run rather than
  left to interpretation afterward.

## 9. Relationship to the existing harness

This protocol is an extension of, not a replacement for, `bench/`, `scripts/bench-*.ts`, `tasks/`, and
`docs/decisions/measure-task-success-on-a-machine-oracle.md`. Concretely, building it requires: (a) a
budget-matched single-agent harness mode (arm A) and a no-chat builder+reviewer harness mode (arm B), (b)
per-arm ablation flags for the seven mechanics in §2.3 (all seven already exist as toggleable room options
or CLI flags per the citations in §2.3 — none require new hub features, only a harness that can launch a
room with them turned off), (c) a `--seed` argument threaded through the harness so seeds are reproducible
and paired across arms, (d) per-task wall-clock timestamping in the harness output. None of (a)-(d) is built
by this room; they are listed here as what a future build room needs, per the maintainer's instruction that
this room pre-registers rather than measures.

## 10. Provenance

This draft ports and re-verifies (against HEAD `cd64ea9`, not the `72eaa54` it was originally written
against) an uncommitted draft written by sonnet-5 in the prior, stalled run of this identical task,
`swarm-113146-9k8v` (see that room's `.swarm-worktrees/swarm-113146-9k8v/sonnet-5/paper/protocol.md`,
never committed there). Every file:line citation in this document was re-checked against the current
checkout in this room, not copied blind; two line-number citations had drifted (by 4–9 lines) because of
commit `cd64ea9` — the fix for the exact reviewer-assignment bug that stalled the prior room — and are
corrected here (§2.3 items 2 and 3), with item 7 rewritten to describe and cite that fix directly.
