# Proposed decision: provenance-before-mechanism-and-a-cheap-pair-is-the-baseline

From swarm-174126-0s5m (concluded); report: swarms/swarm-174126-0s5m/report.md. A human promotes this into docs/decisions/ with `guard-decisions add`; nothing is adopted automatically.

DECISION RECORD (ready for `guard-decisions add`)

**slug**: `provenance-before-mechanism-and-a-cheap-pair-is-the-baseline`
**target**: A benchmark run records what actually served it, and the no-chat pair is the baseline the chatroom must beat.

**context (forcing failure and its cost)**: The `sonnet` alias changed its thinking budget twice in one day and the harness could not see it — `bench-rq1.ts` recorded only the requested alias and a hub-entry hash, so the shift was caught by hand from token counts, invalidating cross-window comparisons after the money was spent (~71 USD on arm K alone). Separately, RQ2 had never been run, so the paper's one win was attributed to "the chatroom" without a coordination-without-chat control.

**ruling (mechanism)**: (1) `result.json` records the served model id (stream `init` and `assistant` events), terminal `modelUsage` including thinking tokens, a whole-dist hash, the runner hash and launch HEAD, all captured before any child is spawned, alongside the requested alias (291bd5a). (2) Arm B exists in the harness: builder → reviewer on a `cpSync` snapshot workspace with no MCP → at most one revision, under one shared pipeline deadline (5572748). (3) Pilot results are reported per pre-declared phase; outcome-adaptive extensions are archived separately with a manifest and never pooled.

**consequences (value protected)**: Any future comparison can be checked for regime drift from its own artifacts; a claim that coordination helps now has to clear a pair that costs ~1/5.7 as much per run; and a truncated or adaptive run can no longer quietly become evidence.

**tradeoff (knowingly paid)**: About 12.6 USD of real spend for n=5 per arm — diagnostic only, no equivalence claim — and a larger `result.json` on every run.

**researched this run** (NEW relative to the settled-axes list, all new): arXiv:2411.00640, 2307.09009v3, 2407.01502, 2502.08788, 2602.05289, 2606.06399, 2601.19934, 2604.16529, 2605.06028, 2607.01661, 2607.11250, 2510.20963, 2512.24601v3.

**rejected**: RQ3 seven-way ablation — no power on a two-family suite. A room-funded n=12 C-vs-K repeat — 0.4–9.5% power, and the maintainer's own control already covered it. Arm R (summary-mediated refinement) — right control, but the budget would not cover it alongside arm B. The `complementary-fix` task — screened 3/3 at ceiling, fails the ten-seed admission band. Context-offload experiment — documented, unfunded.

**revisit-when**: A pre-registered, regime-controlled run at ~20 seeds per arm on stamp-interpreter plus one other family reports B and C with the new provenance fields — if C beats B there, the coordination claim survives; if not, the paper's remaining mechanism claim should be retracted.
