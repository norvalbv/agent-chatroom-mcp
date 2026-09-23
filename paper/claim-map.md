# Claim map for the paper cut

Version 2, 2026-09-22. Version 1 was written by Claude Opus 5.5 at commit `28961b2`: one read of all 13 sections (17,248 words, 37 pages), with numbers checked against `paper/generated/`, `paper/tables/` and `bench/results/`. Two Codex models then reviewed it independently and read-only, each trying to refute every row:

- **gpt-6-astra:** 6 rows confirmed, 4 wrong, 5 overstated.
- **gpt-6-sol:** 8 rows confirmed, 2 wrong, 4 overstated, 1 not checkable.

This version adopts every correction that at least one reviewer made and that checks out against the files. Section 9 lists what changed.

**Scope of every result below:** `claude-sonnet-5` under the `sonnet` alias, 18 to 20 September 2026, on the subscription accounts recorded in `bench/results/account-switch-log/switches.json`. Nothing here is a claim about newer models.

Two names are used throughout:

- **Study 1:** seeds 101 to 140, arms A, C and K, account 1, short thinking.
- **Study 2:** seeds 501 to 520, five arms, mostly account 4, long thinking.

The paper currently calls both of them "confirmatory".

## 1. What the paper can claim

| # | Claim | Evidence | Status |
|---|---|---|---|
| K1 | Study 1, interpreter family. One agent passed 61/80, the chatroom 80/80, the vote 75/80. | `paper/tables/results-family.tex`: chatroom vs one agent, Fisher p = 0.0000011. `results-armk-exploratory.tex`: vote vs one agent, p = 0.0033, exploratory. | Holds. The family pooling and the Fisher test were post-data revisions; the pre-registered per-task test is reported alongside. |
| K2 | Study 1, printf. One agent passed 14/40, the chatroom 6/40, the vote 7/40. | `results-family.tex`: Fisher p = 0.069. Pre-registered z-test p = 0.039 (`bench/results/rq1-suite/rq1-table.md`). Vote vs one agent: Holm p = 0.578. | Holds as observed rates. Whether "lower" is significant depends on the test. |
| K3 | On printf, one agent's 40 attempts form two execution-identical clusters on all 9,650 probes: 14 pass and 26 fail. A correct attempt was available in 37/40 vote groups, but the selector picked one in only 7/40. On the interpreter tasks, the failures were a shared minority answer: 7 identical failures out of 40 on one task, and 11 identical plus 1 other on the second. | `paper/amendments.md`, printf calibration; `bench/results/rq1-arm-k`; the answer files. | Demonstrated for the vote selector. For the chatroom it is an association only, because its failing cases were not recorded. |
| K4 | The chatroom was never distinguishable from the vote. | `results-armk.tex`: vote vs chatroom Holm p ≥ 0.578 on every task. Pooled 75/80 vs 80/80, p = 0.059, exploratory. | Holds as "not distinguished", never "equal". |
| K5 | Chatroom cost per correct answer relative to one agent. | Study 1: 8.56× and 6.16× on the interpreter tasks, 18.17× on printf (`paper/generated/rq1-family-table.json`). Study 2, long thinking, interpreter: 10.37×, 1.407 vs 0.136 USD. Vote vs chatroom: 0.637 vs 0.602 and 0.545 vs 0.595 USD on the interpreter tasks; 3.87 vs 4.97 USD on printf. | Holds. Dated, list-price, specific to the account. |
| K6 | The active account was strongly associated with observed thinking. Account 4: 384/385 runs at 4,000 or more thinking tokens. Accounts 1 and 3: 0/51. | `paper/generated/account-regime.md`: medians 7,709 vs 968 and 716, about 8.0× and 10.8×. Output-token ranges separate by account for both task families. Counts cover runs with thinking telemetry; 5 of 1,947 eligible runs straddled a switch and are excluded. | Association. The cause is not observable from the client. |
| K7 | Under long thinking, one agent was near ceiling on `stamp-interpreter`. | Window control, long cohort: 78/80 single attempts. Study 2: 18/19 at 0.136 USD per correct answer. `stamp-2` was not measured under long thinking. | Descriptive, across cohorts, not randomised. |
| K8 | Study 2, long thinking, exploratory: no arm was distinguishable from one agent. Every Holm p = 1. On `stamp-interpreter` the pair passed 19/19 at 0.269 USD per correct answer, against the chatroom's 19/19 at 1.407. | `paper/generated/rq1-confirmatory.json`. Comparisons use 19 seeds per arm on the interpreter and 15 on printf. | Holds as "not distinguished, about a fifth of the cost". The pre-registered cost prediction was for the short-thinking stratum; this stratum meets the inequality but does not confirm that prediction. |
| K9 | One agent's short-thinking estimates on `stamp-interpreter` varied from 0.475 to 0.825. | Admission pilot 5/10; Study 1 grid 33/40; vote attempts 270/400; cap control 41/60; the window control's full short sample 19/40, including crossover seed 209. | Holds. The source of the variation is not identified. |
| K10 | The pre-registered vote prediction failed one clause. The vote beat one agent on `stamp-2` (Holm p = 0.009) but not on `stamp-interpreter` (Holm p = 1.000). | `paper/prereg-arm-k.md`; `results-armk.tex`. | Holds. This negative result must survive the cut. |
| K11 | Chatroom summaries report correction after disagreement: at least 26 of 40 `stamp-interpreter` rooms and 14 of 40 `stamp-2` rooms say an opening had the known error and another seat corrected it. | `docs/arm-c-process-trace.md`: manual tallies of seat summaries, lower bounds. | Diagnostic self-report only. It does not identify which mechanic caused the correction. |
| K12 | Recorded verification practice. Of 260 structured verification entries in 36 rooms and sub-rooms (17 to 23 September 2026, mixed models, not the benchmark runs), 241 parse under the hub's head parser, 238 report exit code 0 and 128 name a commit. By the strongest check each reports: 127 builds or existing tests only, 43 the scripted smoke client, 11 reading only, 54 a check the verifier wrote, 25 a real browser (all game rooms), 0 agents on a changed build. Among 110 entries by a seat other than a known proposal author: 33/110 own check, 10/110 browser. | `paper/generated/verify-practice.json`, from `bench/results/verify-practice/` (extract with full entry text, room kinds, two coders plus adjudication in `codes.json`; agreement 256/260, kappa 0.98). | Exploratory, post hoc. Classes record what an entry says was run, not observed execution; both coders are the same model. |
| K13 | In four audited rooms, the first auditor's coding puts re-running the author's test, suite or build as the largest category (154/331 acts) with the lowest defect-flagged share among categories with a stated method (39/154), against 42/73 for reading the diff and 25/38 for a check the author had not supplied. | `paper/generated/review-audit.json`, from `bench/results/review-audit/audit-2026-09-23.json` (first auditor's per-act labels; second auditor's re-counts as text). | Association only. The second auditor found omitted acts, disputed labels, repeats and self-checks; labels include mixed methods and disputed findings. |
| K14 | A passing report of the author's own command satisfies the verification gate: it checks a structured head (proposal, exit code 0), a non-proposer on a different connection, freshness against the proposal text and the assigned reviewer, and nothing about what the command exercised. No verification entry ran agents on a changed build; in the first hub room, a pilot's author ran agents on an integration build containing others' changes, not as verification. | The hub's verification gate as built; K12; both auditors of both hub rooms. | A property of the design. No controlled comparison of rules, so no effect size. |

**Caveats that must survive the cut**

- In Study 1, arms A and C were interleaved per seed, but arm K ran later the same day.
- Budget matching is on the mean only. The vote arm exceeded the paired chatroom's spend on 19, 10 and 9 of 40 seeds.
- The tasks are single-trap tasks admitted by pilot, and seeds repeat fixed task instances.
- The two `stamp` programs are one family, not independent evidence.
- Costs are API list prices under particular accounts.
- Study 2 has 10 missing cells. Printf seed 501 is excluded from inference, mixed-account seeds are excluded, and one printf chatroom cost is unknown.

## 2. Fix these before anything is cut

| # | What the paper says | Where | Correction |
|---|---|---|---|
| F1 | The vote arm "overlaps the regime shift by clock". This justifies a long hedge about classifying runs by output tokens rather than clock time. | Cost table caption, written by `scripts/paper-fig-tables.ts` line 80; `figures.tex` lines 24 and 37; `results.tex` lines 79 and 165 | The early onset estimate, "15:30 to 16:45 local", which the amendments later translate to 14:30 to 15:45 UTC, did overlap the vote arm's 13:22 to 15:33 UTC. The account-switch log later placed the change at 16:38 UTC, after the vote arm ended. State the logged switch time, say the early estimate was superseded, and delete the overlap hedging. Do not claim the estimate's "local" meant UTC. |
| F2 | "The largest accuracy difference measured in this project" and "moved single-agent accuracy more than any aggregation arm did". | `results.tex` line 102; `threats.tex` line 64 | Descriptively, the long vs short single-agent contrast on `stamp-interpreter` is 0.975 against 0.475 to 0.825, depending on the short sample. That is as large as or larger than any Study 1 aggregation gain: up to 0.30 on `stamp-2`, 0.2375 pooled. Keep it as a cross-cohort association and remove the causal "moved". |
| F3 | RQ2, the pair, "was not run". | `method.tex` lines 7 to 9 | The pair ran in Study 2 and in a 15-cell pilot: A 1/5, pair 4/5, chatroom 5/5. |
| F4 | The shift is described as a model change under the alias. | `system-cost.tex` lines 14 to 24 | It was an account-associated serving change under the same recorded model id. |
| F5 | Hub mechanics are described "as implemented", with no build named. | `system.tex` | The verify gate and reviewer assignment date from 18 September, before both studies. Kick, replace and heartbeat (22 September) came later. Describe the evaluated build by its recorded hub revision; Study 1 chatroom cells record entry hash `66f9d135…`. |
| F6 | "Confirmatory" names two different studies. | `results.tex` line 17 and others | Rename them Study 1 and Study 2, keeping each analysis's pre-registered or exploratory status. |

## 3. Cut the repetition

Counts are digit-bounded.

| Point | Repeats | Sections |
|---|---|---|
| Printf 14/40, 6/40, 7/40 | 28 in prose, plus 4 tables | 5 |
| Single-agent volatility 0.50, 0.825, 0.675 | 7 | 4 |
| Scoring of pre-registered prediction 1's three clauses | 5 | 3 |
| z-test vs Fisher on printf | 5 | 3 |
| Cache reads at a tenth of the price | 4 | 3 |
| Thinking shift from 1.6K to 10K tokens | 4 | 4 |
| 4-4 tie-break losses | 3 | 3 |
| Difference-in-significance warning | 2 passages, repeated phrasing inside each | 2 |

Structural repetition:

- **Threats** restates Results and Discussion.
- **Figures:** four figures redraw two tables.
- **Tables:** six tables cover Study 1.
- **System-cost** is 2,070 words of engineering history on one-run-per-arm observations.

## 4. Not measured as an effect

- **Your pipeline:** prompt, prior-art agent, plan, build, devkit review. It is named once (`system-cost.tex` line 101) and never compared with one agent, a pair or a room.
- **The marginal value of non-author review.** The pair arm ran: Study 2 and the pilot. The build-suite A/B/C diagnostic scored 9/9 in every cell, which is ceiling. K11 is self-report. There has been no ablation.
- **The individual hub mechanics.** Regression tests show they operate. One bundled-build comparison exists (`bench/results/real-ab-r2`, one trial). None was ablated.
- **Held waits:** 115.6M vs 53.6M tokens, with one room each on different tasks. Observational only.
- **OpenRouter sticky-session caching:** mock-tested only.
- **Checkpoint trimming:** no answer-quality test.
- **The account and effort effects as causes:** not randomised.
- **Vote vs chatroom under one stable serving condition:** never run at adequate power.

## 5. The benches: why it reads as the same small test over and over

| Directory | Question | Runs | Account | In paper |
|---|---|---|---|---|
| `rq1`, `rq1-grid1`, `rq1-grid2` | Harness shakedown on retired tasks | 25 | 1 | No |
| `suite-3vny` and admission screens | Which of about 45 task designs discriminate | 3 to 10 seeds each | 1 and 3 | Summarised |
| `rq1-suite` | Study 1: one agent vs chatroom | 240 | 1 | Yes |
| `rq1-arm-k-pilot`, `rq1-arm-k` | Vote arm | 3 pilot, then 120 groups of 1,000 attempts | 1 | Yes |
| `rq1-drift-control` | Does the 0.30 USD cap cause the drop | 60 | 1 | Yes |
| `rq1-window-control` | Chatroom vs vote in one time window | 24 | 4, then 1 | Yes |
| `rq1-arm-b-pilot` and sentinel | Pair vs chatroom | 15 | 1 | No |
| `rq1-confirmatory-pilot`, `-pre-amendment`, `-quota-invalidated` | Study 2 plumbing | 20 | Mixed | No |
| `rq1-confirmatory` | Study 2 | 190 | Mostly 4 | Yes |

`stamp-interpreter` was measured in eight experiments, all but one at n ≤ 60, and one agent's rate ranged from 0.475 to 0.975 across them. More cells of the same design would not change a conclusion here.

## 6. Outside the paper: the swarm skill's effort rule

`skills/swarm/SKILL.md` line 72, in both copies, says "Raise effort before adding seats", citing the 78/80 long-thinking cohort. That cohort differed by account, not by effort setting. What was measured about the setting:

- **Short-thinking account:** mean thinking tokens were 1,076 at default and 1,164 at high, n = 3 each.
- **Long-thinking account, Study 2:** thinking rose 1.3× on the interpreter and 1.7× on printf. Accuracy went from 18/19 to 19/19 on the interpreter and 11/15 to 11/15 on printf, with no detectable gain.

Proposed wording: "Before adding seats, check what thinking the active account actually serves, and benchmark a single agent at higher effort. The effort setting did not reproduce the account-associated difference."

## 7. What carries over to newer models

- **Does not carry over:** pass rates, costs, and which tasks sit at ceiling.
- **Carries over:** the method; the lesson that serving-condition provenance must be recorded; and the minority-versus-majority pattern, as a hypothesis.

## 8. The short paper

**Claim 1.** In Study 1, direct tests did not distinguish the three-seat chatroom from voting over independent attempts. On the interpreter family, the chatroom beat one agent (80/80 vs 61/80); the vote beat one agent significantly on `stamp-2` but not on `stamp-interpreter`. On printf, where the common failure was the majority of independent attempts, both aggregation arms had lower observed rates than one agent. That difference was significant only under the pre-registered z-test. (K1 to K5, K10)

**Claim 2.** Under the same recorded model alias and settings, the active subscription account was strongly associated with thinking: medians of 7,709 against 968 and 716 tokens. On the long-thinking account, one agent was near ceiling on `stamp-interpreter`, at a fraction of the chatroom's cost per correct answer. The source of the account difference is unknown. (K6, K7, K9, F2)

**Claim 3.** The account changes left Study 2's pre-registered short-thinking comparisons essentially unobserved: no eligible short-thinking interpreter seed and one printf seed. Its 15-to-19-seed long-thinking comparisons are exploratory and distinguish no arm from one agent. The study stopped at 190/200 cells. Comparisons of multi-agent systems need serving-account provenance recorded when each run happens. (K8)

**Plus one section, "What this does not show":** section 4 above and section 7.

| Section | Words |
|---|---|
| Introduction | 500 |
| System, one paragraph plus the evaluated build | 400 |
| Method: two studies, oracle, arms, statistics | 900 |
| Results: one Study 1 table, the Study 2 table, the account table, one figure | 1,500 |
| What this does not show | 500 |
| Related work | 500 |
| Reproducibility appendix, pointing to `paper/README.md` | 300 |
| **Total** | **about 4,600 words, 10 to 12 pages** |

## 9. What the review changed from version 1

| Item | Change |
|---|---|
| F1 | My "timezone mislabel" explanation was unsupported; both reviewers. Replaced with "superseded estimate". |
| F2 | My "about the same size" was wrong: the account contrast is at least as large as the aggregation gains (astra). Kept the verdict against causal wording (both). |
| F5 | The verify gate and reviewer assignment predate the studies (both). |
| K5 | Added printf's 18.17×. |
| K3, K6, K7, K8, K9 | Scope and wording narrowed (both). |
| K10, K11 and the caveat list | Added (both). |
| Section 3 | Printf count corrected from 37 to 28: my search matched 36/40 and 37/40 (astra). |
| Section 4 | Retitled and extended (both). |
| Section 6 | Wording replaced (both). |
| Section 8 | All three claims narrowed (both). |
