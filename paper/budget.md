# Budget: the run grid priced three ways

This is a planning document for the maintainer, not a results section. It prices the
experiment grid that `paper/protocol.md` pre-registers, using (a) real per-run costs
already in this repository and (b) current provider rate cards, fetched during this run.
Every number below states its formula and its inputs so it can be checked or
recomputed; nothing is asserted without a source.

*Re-verified 2026-09-18 (room swarm-113947-ne8o-room, HEAD cd64ea9): all three `result.json`
`usage` blocks in §3 re-read and match exactly; the Anthropic pricing page and the OpenRouter
live models API were re-fetched and both rate cards are unchanged (`deepseek/deepseek-v4-flash-0731`
is still listed at prompt $0.06/MTok, completion $0.12/MTok, cache-read $0.012/MTok — it does not
appear in an HTML-rendered view of the models page, only in the raw JSON, so fetch the API directly,
not a rendered page); `docs/measurement-swarm-214936.md`'s R8(3) line and the harness's lack of a
`usage`/`cost` field (`scripts/bench-bench.ts`, `scripts/bench-oracle.ts`) were confirmed unchanged.*

## 1. What "priced three ways" means here

The three tiers are the three providers named in the room brief:

1. **Claude Sonnet** seats (model id `claude-sonnet-5`) — what every chatroom room in
   `swarms/*/result.json` has actually run on so far.
2. **Claude Haiku** seats (model id `claude-haiku-4-5-20251001`) — cheaper, already the
   default for the lean-flag probes in `docs/review-round-0918.md`.
3. **`deepseek/deepseek-v4-flash-0731`** via OpenRouter — already the default seat model
   in the benchmark harness itself (`scripts/bench-bench.ts:68`,
   `model:process.env.OPENROUTER_MODEL??'deepseek/deepseek-v4-flash-0731'`), and the
   model actually used in the one real A/B on record
   (`docs/decisions/measure-task-success-on-a-machine-oracle.md`).

For each tier I reprice the **same measured token volumes** from real runs at that
tier's rate card. This is a repricing, not a remeasurement: it assumes a Haiku or
deepseek seat would need the same number of tokens to do the same work as the Sonnet
seat that actually ran, which is very likely false in both directions (a weaker model
may need more turns to reach the same outcome, or may fail outright; a model with a
different tokenizer changes the token count for the same text — Anthropic's own pricing
page notes Claude 4.7+ models produce "approximately 30% more tokens for the same text"
than the previous tokenizer). Repricing tells you what the grid would cost *if* token
volume were held constant; it does not tell you whether a cheaper model would finish the
task at all. `paper/protocol.md`'s task-success metric is the only way to know that, and
must be run — not repriced — before any cost-per-correct-answer number is reported.

## 2. Rate cards (fetched 2026-09-18)

### Claude API (Anthropic), from https://platform.claude.com/docs/en/about-claude/pricing

| Model | Base input | 5m cache write | Cache read (hit) | Output |
|---|---|---|---|---|
| Claude Sonnet 5 | $2.00 / MTok | $2.50 / MTok | $0.20 / MTok | $10.00 / MTok |
| Claude Haiku 4.5 | $1.00 / MTok | $1.25 / MTok | $0.10 / MTok | $5.00 / MTok |

(MTok = 1,000,000 tokens. The Sonnet 5 rate is confirmed as the permanent standard
price, not a lapsing introductory rate: "The $2/$10 per million input/output token
pricing for Claude Sonnet 5 ... is now the standard price. The previously scheduled
increase to $3/$15 ... will not occur.")

### OpenRouter, from `GET https://openrouter.ai/api/v1/models` (live pricing API, fetched
2026-09-18; per-token, converted to per-MTok below)

| Model | Prompt (input) | Completion (output) | Cache read |
|---|---|---|---|
| `deepseek/deepseek-v4-flash-0731` | $0.06 / MTok | $0.12 / MTok | $0.012 / MTok |

No separate cache-*write* rate is published for this model on OpenRouter (unlike
Anthropic's premium 5m-write multiplier); the reprice below therefore bills
cache-creation tokens at the plain prompt rate for the deepseek column, which likely
slightly *overstates* Anthropic-style write cost and *understates* nothing — stated as
an assumption, not measured.

## 3. Repricing three real chatroom runs

These are the three rooms in `swarms/*/result.json` whose `usage` block has
`coverage: "complete"` (all others sampled are either absent or partial). Fields quoted
are exactly `usage.input_tokens`, `usage.cache_read_input_tokens`,
`usage.cache_creation_input_tokens`, `usage.output_tokens`, `usage.cost_usd`,
`usage.seats` from each room's `result.json`. `cost_usd` is Claude Code's own
self-reported billed cost for the Sonnet run that actually happened — ground truth, not
a reprice. The Haiku and deepseek columns are the same token counts repriced at each
tier's rate card (formula: `input*price_in + cache_read*price_read + cache_creation*price_write + output*price_out`, all divided by 1e6).

| Room | Seats (result.json `usage.seats`) | input | cache_read | cache_creation | output | Sonnet (measured `cost_usd`) | Haiku (repriced) | deepseek-v4-flash-0731 (repriced) |
|---|---|---|---|---|---|---|---|---|
| swarm-102357-g062 (lean-flag build) | 5 | 960 | 74,217,404 | 1,018,297 | 304,438 | **$21.99** | $10.22 | $0.99 |
| swarm-100622-6jdx (peer-review research, read-only) | 10 | 1,024 | 60,099,895 | 1,610,101 | 376,980 | **$22.34** | $9.91 | $0.86 |
| swarm-102347-phin (peer-review build) | 6 | 2,354 | 279,597,966 | 2,108,427 | 657,972 | **$70.97** | $33.89 | $3.56 |

Recomputing the Sonnet column from the same token counts and the rate card in §2
undershoots the CLI-reported `cost_usd` in all three rooms, but not by a consistent
margin: $20.44 vs. $21.99 measured (g062, 7.1% under), $19.82 vs. $22.34 (6jdx, 11.3%
under), $67.78 vs. $70.97 (phin, 4.5% under). The gap is not closed by this data and its
size varies by room, so it is not a fixed correction factor; a plausible explanation is
1‑hour cache writes ($4/MTok on Sonnet 5) or a data-residency multiplier mixed into
`cache_creation_input_tokens` in some rooms and not others, neither of which the
artifact field breaks out. Treat the measured `cost_usd` as authoritative for Sonnet and
the recompute as a rough (4.5–11.3%) sanity bound, not as proof the formula is exact for
the other two columns.

Note on seat counts: `docs/review-round-0918.md`'s own cost table reports
"Review build | 5 | ... | 70.97 USD" (5 *worker* seats) while `result.json.usage.seats`
for that same room is 6 (it includes the verifier seat, whose tokens the review-round
table's session-transcript count excluded). Both numbers describe the same run; they
differ because they count different seat populations. `paper/protocol.md`'s metrics
section should say explicitly which population "seats" means before any grid runs,
since it changes tokens-per-seat and (if per-seat costs are ever reported) cost-per-seat.

## 4. The gap this grid cannot be priced through yet

The scripted harness (`scripts/bench-bench.ts`, `scripts/bench-oracle.ts`) that the
brief says experiments will actually run on — not chatroom rooms like this one — has
**no cost or token-usage capture at all**. `bench-result.json` and `manifest.json`
(checked directly at `bench/results/real-ab-r2/{A,B}/`) record pass/fail, duration_ms,
anti-tamper hashes and the frozen `seat_budget` (model, max_minutes, max_steps) but no
`usage` object of any kind; the seat's own `seat-report.json` records `duration_ms`,
`log_chars`, `answer_chars` — again no tokens or cost. This is a known, already-recorded
gap, not a new finding of this run: `docs/measurement-swarm-214936.md` lists it under
R8(3) ("opt-in model trials with deterministic oracles **and recorded cost**,
coordinated with goal 1") as still open.

Consequence for this budget: the per-run costs in §3 come from `swarm/*/result.json`
(the chatroom room launcher), which is not the code path the actual grid will run on.
**Before the grid in §5 can be priced from real numbers instead of the extrapolation
below, `scripts/bench-bench.ts` needs the same `usage` capture `src/result.ts` already
does for rooms** — that is implementation work outside `paper/`, for the maintainer or a
future build room to scope, not something this room can do (only `paper/` may change
here). Until then, every number in §5 is an extrapolation from §3's chatroom-room
figures, explicitly labeled as such.

## 5. The run grid

Sizing depends on `paper/protocol.md`'s condition list; the smallest version below
covers the room brief's minimum (single agent, builder+reviewer pair, full chatroom)
plus the two cheapest-to-add ablations. The larger version adds all seven ablations the
brief names. Both use the three-task suite that exists today
(`tasks/bench-fact-check`, `tasks/bench-bug-fix`, `tasks/bench-long-brief` —
correctness-scored for the first two, survival/handoff-scored for the third per
`tasks/bench-long-brief/README.md`; `paper/protocol.md` should confirm the seed count
per its own power analysis before this is final).

### Grid A — smallest grid that answers "is the chatroom worth its cost over cheaper baselines"

| Condition | Seats | Basis for per-run token estimate |
|---|---|---|
| Single agent (matched budget) | 1 | `bench/results/real-ab-r2` control arm already runs this shape (1 seat, `expected_participants: 1`); duration 33–116s observed, no token count captured (§4 gap) |
| Builder + reviewer pair, no chat | 2 | Not yet run anywhere in this repo. The maintainer's estimate in the room brief ("about $15" for the same work a 5-seat build room did at $70.97) is **untested** — no artifact backs it. Flag, do not price as measured. |
| Chatroom (full mechanics) | matches task | Use §3's per-seat-count figures as the nearest real analogue: a 5–6 seat build room cost $21.99–$70.97 (Sonnet, measured); a research-only room without commits cost $22.34 for 10 seats |

3 conditions × 3 tasks × N seeds. `paper/protocol.md` sets N from its power analysis;
at N=5 that is 45 runs.

Costed at 5 seeds, single task-cost proxy = the cheapest observed real analogue per
condition (§3's smallest chatroom room, $21.99, as the chatroom proxy; deepseek-tier
reprice of that room, $0.99, as a lower bound if the chatroom itself were also moved to
the cheap tier):

| Tier | Chatroom condition (15 runs, using $21.99/run analogue) | Single-agent + builder-reviewer (30 runs, unmeasured — no per-run figure to multiply) |
|---|---|---|
| Sonnet | ~$330 | not priceable from repo data (§4 gap + no builder/reviewer run exists) |
| Haiku | ~$153 (repriced from same room, §3) | not priceable |
| deepseek-v4-flash-0731 | ~$15 (repriced from same room, §3) | not priceable |

The blank cells are the honest answer, not an omission: this repo has never run a
single-agent or builder+reviewer condition against the oracle tasks with cost capture,
so there is no measured or repriceable number to put there. The maintainer's $15
estimate for builder+reviewer is a target to test against, not an input to this table.

### Grid B — full ablation grid (adds the 7 single-mechanic-off arms)

10 conditions (3 baseline + 7 ablations: blind openings off, quote-checked votes off,
challenge gate off, `require_verification` off, attention gate off, held waits off,
assigned reviewers off) × 3 tasks × N seeds. At N=5 that is 150 runs — roughly 3.3x
Grid A. Each ablation condition is structurally a chatroom room with one hub flag
toggled, so its nearest real-cost analogue is the same §3 room figures as the "Chatroom
(full mechanics)" row; the multiplier scales roughly linearly with run count:

| Tier | 105 chatroom-shaped runs (7 ablations + full, 15 runs each) |
|---|---|
| Sonnet | ~$2,309 (105 × $21.99, same per-run analogue as Grid A) |
| Haiku | ~$1,073 (105 × $10.22, same room repriced, §3) |
| deepseek-v4-flash-0731 | ~$104 (105 × $0.99) |

Plus the same unpriceable single-agent and builder+reviewer rows as Grid A (they do not
multiply by ablation count — there is nothing to ablate in a single seat or an
unmoderated pair).

## 6. The maintainer's choice

This room does not pick a grid size or a model tier — the brief is explicit that the
maintainer decides. What this document adds is: the three tiers differ by roughly
**22x** (Sonnet vs. deepseek, from §3's like-for-like reprice) and Haiku sits at
roughly **10x** deepseek and **0.46x** Sonnet on the same token volumes. Before
committing to a grid size:

1. **Cost capture must be added to `scripts/bench-bench.ts`** (§4) — without it, every
   number above stays an extrapolation from chatroom-room runs, not the harness the
   experiments will actually run on.
2. **The single-agent and builder+reviewer baselines must each be run once**, on any
   tier, to get a real per-run token count — right now neither has one, so Grid A and B's
   two cheapest-looking conditions are also the two with no cost evidence at all.
3. Once (1) and (2) exist, the smallest grid that still answers the primary
   "does the chatroom's cost premium buy a measurable task-success gain" question is
   Grid A (45 runs) rather than Grid B (150 runs); Grid B answers *which* mechanic
   drives any gain or loss, at roughly 3.3x the cost, and should be run only after Grid A
   shows a gain worth attributing to something.

## 7. Caveats

- Every dollar figure in §3 that is not explicitly marked "measured `cost_usd`" is a
  repricing of real token counts at a different rate card, not a new measurement.
- The Sonnet recompute in §3 undershoots the CLI-reported cost by 4.5–11.3%, varying by
  room; the same unexplained (and room-varying) gap likely exists in the Haiku and
  deepseek columns and is not corrected for, because its source (probably 1h cache
  writes or a pricing multiplier not broken out in `result.json`) is not identified.
- Tokenizer differences between models mean the "same token volume" assumption in §1 is
  known to be approximate, not exact, even before considering that a weaker or stronger
  model would plausibly take a different number of turns to reach the same outcome.
- The deepseek cache-write assumption (billed at prompt rate, §2) is stated, not
  measured; OpenRouter's live pricing API does not expose a cache-write field for this
  model to check it against.
- No number in this file should be read as a task-success cost-per-correct-answer
  figure. `paper/protocol.md` is the only place that metric is defined, and it requires
  runs that have not happened.

## Sources

- https://platform.claude.com/docs/en/about-claude/pricing (fetched 2026-09-18; Claude
  Sonnet 5 and Claude Haiku 4.5 model-pricing table, prompt-caching multiplier table,
  standard-vs-introductory-pricing note)
- `https://openrouter.ai/api/v1/models` (OpenRouter's live models/pricing API, fetched
  2026-09-18; `deepseek/deepseek-v4-flash-0731` entry: `pricing.prompt`,
  `pricing.completion`, `pricing.input_cache_read`)
- `swarms/swarm-102357-g062/result.json`, `swarms/swarm-100622-6jdx/result.json`,
  `swarms/swarm-102347-phin/result.json` — `usage` blocks, read directly in this run
- `docs/review-round-0918.md` — "Cost of the day, worker seats" table, for the
  worker-seat-count vs. `result.json`-seat-count discrepancy noted in §3
- `docs/measurement-swarm-214936.md` — R8(3), the pre-existing record of the
  recorded-cost gap in the benchmark harness
- `scripts/bench-bench.ts`, `bench/results/real-ab-r2/{A,B}/{manifest.json,bench-result.json}`,
  `bench/results/real-ab-r2/{A,B}/workspace/seat-report.json` — read directly, confirming
  no usage/cost fields exist in the harness's own artifacts
- `tasks/bench-long-brief/README.md` — task suite now has three tasks, not two
