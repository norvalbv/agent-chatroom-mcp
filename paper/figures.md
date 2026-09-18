# Figures and tables

Every number below is read from a committed or reproducible artifact by a named script. None is
hand-typed into the paper. Where the generating script does not exist yet, that is stated, and its
exact input/output contract is specified so it can be written once real runs exist (this room does
not run experiments — `measure-task-success-on-a-machine-oracle`, `proposal-is-a-document`).

Source artifacts, as they exist in the repo today (all verified against HEAD `cd64ea9` in this
worktree, not from memory of a prior room):

- `swarms/<run>/result.json` — one JSON object per launcher run. The field this paper uses is
  `usage`, typed as `UsageRollup` (`src/result.ts:51-63`): `{ steps, prompt_tokens,
  completion_tokens, cost_usd, seats, seats_with_usage, coverage, input_tokens,
  cache_read_input_tokens, cache_creation_input_tokens, output_tokens }`. `coverage` is
  `"complete" | "partial" | "none"` (`src/result.ts:43`); a run with `coverage !== "complete"` must
  be excluded from cost/token tables or reported with an explicit gap (`docs/token-round-0918.md`
  §Telemetry: "unknown is never zero" — `src/result.ts:47-49`'s doc comment: "a seat that reported
  no usage is counted in `seats` but not `seats_with_usage`, contributes nothing to the sums").
  Verified against a live artifact: `swarms/swarm-102357-g062/result.json`, and against
  `swarms/swarm-102347-phin/result.json` (`usage.cost_usd: 70.9735702`, matching the brief's "70.97
  USD" figure).
- `bench/results/<arm-dir>/bench-compare.json` — one JSON object per bench A/B trial, written by
  `scripts/bench-bench.ts:128`. Fields as the current script writes them: `task_id`,
  `arms[].{arm,passed,reason,outcome}`, `comparable` (bool, `scripts/bench-bench.ts:127`), `delta`
  (±1 or null), `delta_unit` (string label, explicitly "single trial, not an effect estimate"),
  `outcome_vocabulary` (the fixed six-label set defined at `scripts/bench-bench.ts:14`:
  `task_pass, task_fail, parse_failure, timeout, infrastructure_error, tamper`), `frozen.*` (hashes
  and budget pinned per trial, `scripts/bench-bench.ts:68`), `checked_at`
  (`scripts/bench-bench.ts:121`). **Caveat found by re-verification, not in the prior draft:** the
  one committed sample, `bench/results/real-ab-r2/bench-compare.json`, predates the `outcome` and
  `outcome_vocabulary` fields — it has `task_id`, `arms[].{arm,passed,reason}`, `comparable`,
  `delta`, `delta_unit`, `frozen`, `checked_at`, but no `outcome`/`outcome_vocabulary` keys. Any
  script reading this field must not assume it is present in every historical artifact; new runs
  under the current script will have it, old ones may not. A generating script must treat these two
  fields as optional and fall back to `reason` alone for older files.
- `swarms/<run>/report.md` — human-written prose per run; not a data source for any figure (it is
  not machine-generated from the JSON, so it cannot be cited as ground truth for a plotted number).
- `~/.claude/projects/*agent-chatroom-mcp*/*.jsonl` (Claude Code session transcripts, local to the
  operator's machine, not committed) — the only source today for **per-seat** token/turn counts on
  Claude seats, read by `scripts/claude-room-usage.py`. `result.json.usage` gives only the
  **run-total**, not a per-seat breakdown, for Claude seats (confirmed: no `<name>.usage.json`
  sidecar exists for the Claude runs inspected, e.g. `swarms/swarm-102357-g062/`; the sidecar
  pattern in `docs/token-round-0918.md` §Telemetry is OpenRouter-only, per `src/result.ts:24-28`'s
  doc comment: sidecar fields come from "the openrouter/codex `<name>.usage.json` sidecar"). Any
  paper table with a per-seat column for Claude arms must say it depends on transcripts external to
  the run artifact, or it cannot be regenerated from `swarms/` alone.

## Table 1 — Task suite

**Content:** one row per oracle task (`bench-fact-check`, `bench-bug-fix`, `bench-long-brief`):
task id, oracle kind, scored dimensions, current scoring status.
**Source:** `tasks/<id>/task.json` (`task_id`), `tasks/<id>/oracle/oracle.json` (`kind`, and for
`exact-answer` the `expected`/`distractors` count only — never the value, to avoid printing the
held-out answer in the paper), `scripts/bench-oracle.ts` (which `kind`s it actually handles: today
only `"inclusive-dates"` is special-cased (`scripts/bench-oracle.ts:16`), everything else — including
`"handoff"`, used by `bench-long-brief` — falls through to the default `exact-answer`/fact-check path,
which requires `<workspace>/answer.txt` to exist (`scripts/bench-oracle.ts:44`) or scores
`parse_failure`. `tasks/bench-long-brief/oracle/oracle.json`'s own `note` field confirms this is a
known, documented gap: "until it lands, treat this task's task answer as parse_failure and read
handoff survival from the arm data dir" (verified directly from the file, not from a report). This is
a real scoring gap, not a paper simplification: `bench-long-brief` is not currently scorable as
`task_pass`/`task_fail` by the harness as written. `protocol.md` must either exclude it from the
primary task suite or list "wire the handoff/survival scorer" as a prerequisite, not an assumption.
**Script (new):** `scripts/paper-task-table.ts` — reads the three `tasks/*/{task.json,oracle/oracle.json}`
files and `scripts/bench-oracle.ts`'s exported `loadTask`/`scoreTask` to check, at generation time,
which `kind`s are actually implemented (fail loudly if a task's kind isn't handled, rather than
silently mis-scoring it into the paper).

## Table 2 — Per-arm task outcome (primary result table)

**Content:** rows = condition (single agent / builder+reviewer pair / chatroom / each single-mechanic
ablation, per protocol.md's condition list); columns = task id × seed; cell = outcome label from the
five-outcome task vocabulary (`task_pass, task_fail, parse_failure, timeout, infrastructure_error`;
`tamper` is an integrity guard on the corpus, not a task outcome — `scripts/bench-bench.ts:14`'s
`OUTCOME` map collapses provider-side synonyms like `'oracle-pass'`→`'task_pass'` into this
vocabulary); summary columns = task success rate (`task_pass` count / N trials for that task, that
arm), comparable-trial count (`comparable === true`), and count of each non-comparable reason
(`timeout`, `infrastructure_error`, `tamper`) reported separately, never folded into the denominator
(`measure-task-success-on-a-machine-oracle`: "the comparable delta excluding only infrastructure,
timeout and tamper").
**Source:** every `bench/results/<arm-dir>/bench-compare.json` produced by the run grid in
budget.md, one file per (condition, task, seed).
**Script (new):** `scripts/paper-outcome-table.ts <results-glob>` — globs `bench-compare.json`
files, groups by `(task_id, arm-label-from-directory-convention)`, emits the table above as
markdown and as `paper/generated/table2.json`. Must refuse to run (exit non-zero) if any input file
is missing `frozen.task_sha256` or `frozen.seat_entry_sha256` (an unpinned trial is not
citable — `measure-task-success-on-a-machine-oracle`'s own finding: "the two builds differ by every
mechanic merged that day, so this is a bundled-build association, not gate causality" was exactly
this failure mode). Falls back to the `reason` field alone (never crashes) for older
`bench-compare.json` files lacking `outcome`/`outcome_vocabulary` (see the source-artifacts caveat
above).

## Table 3 — Cost and tokens per condition

**`usage`'s fields are two disjoint accountings, not one** (`src/result.ts:24-49`,
`SeatUsageRollup`'s and `UsageRollup`'s doc comments): `steps`/`prompt_tokens`/`completion_tokens`
come from the openrouter/codex `<name>.usage.json` sidecar; `input_tokens`/
`cache_read_input_tokens`/`cache_creation_input_tokens`/`output_tokens` (`CLAUDE_ONLY_USAGE_FIELDS`,
`src/result.ts:42`) come from a Claude seat's single `--output-format json` reply instead. A field a
seat's provider does not produce is `undefined`, not `0`. Since budget.md's grid mixes Sonnet/Haiku
(Claude) and deepseek (OpenRouter) arms, **a table or figure must say explicitly which accounting
each row/column uses and never sum `prompt_tokens` and `input_tokens` together as one "tokens"
number** — they are not the same quantity and a mixed-arm run's rollup can have both non-empty at
once (a chatroom condition with both Claude and OpenRouter seats).
**Content:** rows = condition; columns split by accounting: **Claude columns** (`input_tokens`,
`cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`) and **OpenRouter/Codex
columns** (`steps`, `prompt_tokens`, `completion_tokens`) reported side by side, never merged; plus
`cost_usd` (the one field every provider populates — `src/result.ts:38` — `cost: number`, not
optional) and `seats_with_usage`/`seats` (coverage). Two derived metrics, each stated with which
accounting it draws from: **cost per correct answer** = `cost_usd` ÷ (count of `task_pass` across
that condition's trials, from Table 2) — always computable, `cost_usd` is universal — and
**cache-read share** (Claude arms only) = `cache_read_input_tokens` ÷ (`input_tokens +
cache_read_input_tokens + cache_creation_input_tokens`) (the formula
`scripts/claude-room-usage.py:30` already uses for its printed `cache-read%` column).
**Source:** `swarms/<run>/result.json.usage` for each scripted harness run in the grid, joined to
Table 2 by run/condition id.
**Script (new):** `scripts/paper-cost-table.ts <result.json-glob> <table2.json>` — sums `usage`
fields per condition **without adding fields from different accountings together**, divides
`cost_usd` by Table 2's `task_pass` counts, emits markdown + `paper/generated/table3.json`. Rows
with `coverage !== "complete"` are printed with a `(partial)` marker, never silently averaged in.

## Table 4 — Per-seat token/turn breakdown (secondary, Claude arms only)

**Content:** rows = room/run; columns = seats, model turns, tokens processed (input+cache), tokens
per turn, tokens per seat, cache-read %, output tokens — the exact shape
`scripts/claude-room-usage.py` already prints (used as-is in `docs/token-round-0918.md`'s "First
measurement" table and `docs/review-round-0918.md`'s cost table).
**Source:** local Claude Code session transcripts, **not** a committed artifact — this table can
only be regenerated on the machine that ran the sessions, and must carry a caption saying so; it is
supporting/exploratory, not the primary result (Table 2/3 are).
**Script (existing):** `scripts/claude-room-usage.py <room-substring>...` — no new script needed;
paper/figures.md only needs to invoke it and capture output at generation time, per run in the
grid.

## Figure 1 — Cost vs. task success scatter

**Content:** one point per condition: x = cost per correct answer (Table 3), y = task success rate
(Table 2); one series per model tier (Sonnet / Haiku / deepseek, per budget.md's pricing grid).
**Script (new):** `scripts/paper-fig1.ts table2.json table3.json` — pure function of the two table
JSON files above; no independent data reading, so it cannot drift from the tables printed in the
same paper.

## Figure 2 — Ablation delta

**Content:** bar chart, one bar per single-mechanic ablation (blind openings off, quote-checked
votes off, challenge gate off, `require_verification` off, attention gate off, held waits off,
assigned reviewers off), y = task success rate delta vs. the full-chatroom condition (same sign
convention as `bench-compare.json`'s `delta`: ablation minus baseline), with the comparable-trial
count annotated on each bar so a bar built from fewer comparable trials is visibly thinner evidence
(direct response to the harness's own documented failure mode: "one task, one seed per arm is
direction only").
**Script (new):** `scripts/paper-fig2.ts table2.json` — derived entirely from Table 2; each bar must
carry an error bar or an explicit "n=1, direction only" label per `measure-task-success-on-a-machine-oracle`'s
anchored-bet, not a bare point estimate.

## What is deliberately not a figure

No figure or table in this paper is built from `reply_rate`, `mentions`, consensus tallies, or any
other process metric on its own (the attention-gate A/B's own history — reply proxy moved
70.7%→81.4% while task success moved the other way — is the cited reason,
`measure-task-success-on-a-machine-oracle` §Context). Process metrics (message counts, quiet-message
counts, turns) may appear only as secondary/diagnostic columns alongside a Table 2/3 outcome
column, never as a standalone headline number.

## Reproducibility statement (goes in the paper, not just this file)

Every table/figure script above takes only committed or freshly-generated artifact paths as input,
writes its numeric output to `paper/generated/*.json` alongside the markdown/plot, and is listed in
`paper/check-citations.sh`'s sibling (a `paper/regen.sh`, out of scope for this deliverable —
figures.md defines the contract; wiring `regen.sh` is future work, not claimed as done here).
