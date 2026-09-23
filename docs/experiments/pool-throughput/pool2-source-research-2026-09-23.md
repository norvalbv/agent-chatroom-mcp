# Pool 2 source: open benchmarks versus our own curation (2026-09-23)

Question from the owner: should an open-source benchmark replace our own curation for pool 2, given that pool 1 hit the ceiling and the curated game pool looked similar?

Method: workflow `pool2-benchmark-choice`, 6 Opus 5.5 agents, about 87 minutes. Four researchers each covered one family (multi-agent benchmarks, the SWE-bench family, same-commit generators, long-horizon benchmarks) against six criteria: 20+ co-applicable items at one base commit, difficulty for Opus-class agents, contamination given seats have WebSearch/WebFetch, local macOS runs, licence, and fit to brief + hidden test + reference patch. A skeptic re-checked the top candidates hands-on (clones, counts per base commit, local validation runs, live WebSearch). A final agent compared them with hardening and re-curating the game items.

Owner decision (2026-09-23): keep the game; harden all briefs; start curating larger replacement items in parallel as insurance; lock after one solo pilot if solo lands 16 or fewer of 20. The pre-registration amendment of the same date records the rules.

## Recommendation

No open benchmark should replace pool 2. Keep the Alder game as pool 2, which is what the pre-registration names, and make it harder ourselves in two gated stages.

Stage 1 (H, the easy workflow the owner described): rewrite all 20 briefs so each states only the symptom, the required behaviour and the interface the hidden test calls, with no cause, no file to change and no fix. Hidden tests and reference fixes stay unchanged. Then run one solo pilot on that pool. It is pre-registered, excluded from results, and uses the same launcher, deadline and tools. If solo lands 16 or fewer of the 20 items in 30 minutes, lock the pool.

Stage 2 (R, only if solo lands 17 or more): replace the 11 items the reviewer flagged as too easy (g01, g03, g05, g06, g08, g09, g15, g16, g17, g19, g20) with newly curated game items at base 4193133. Each new item must meet a floor that can be checked: the reference fix touches at least 2 non-test source files and adds at least 50 non-test lines. Curate 4 reserves as well. Pilot once more, then apply a fixed reserve swap.

Start R curation in parallel with stage 1 as insurance. My estimate is that H alone will not break the ceiling. That estimate rests on one calibration point, and the stage-1 pilot is the cheap check that settles it: about 30 minutes and roughly $2-5, since pool 1's solo runs cost $1.92 and $2.56.

## Why

1. No open source meets C1, C2 and C3 together.
- SWE-bench-family sets have at most 1 to 6 items per base commit. Pro V2 is saturated: Opus 5 scored 638/642.
- The only set with 20 or more items at one commit that we have run locally is CooperBench's pallets/jinja tasks, re-based to 896a621 (30 items, validated 3 times). On 2026-09-23 the skeptic ran a WebSearch that returned the hardest item's gold-patch page, and the tool's own summary described the answer. No WebFetch call was needed, so a WebFetch deny hook cannot close the leak. Those briefs also tell the seat how to build the fix: 27 of 30 have a "Files Modified" section.
- SWE-Lancer: the fixes are upstream Expensify code, one of the 20 chosen patches is a nondeterministic sabotage patch, and its offline mode only works on Linux.
- FeatureBench mlflow: at most 16 items can be applied together, the median item is about 896 lines, and the fixes are on PyPI and GitHub.
- Fresh vinext mining: only 11 of 136 PRs cherry-pick cleanly on their own.
- Adopting any of these would also change the pool's repository, its language (mostly Python) and the seats' web tools. The cross-pool direction count would then mix those changes in with difficulty.

2. The game passes C3 cleanly. `gh api user/repos` (2026-09-23) shows no GitHub repo for the game under this account. The fixes were written by our curator and exist nowhere online. Seats keep WebSearch and WebFetch exactly as in pool 1.

3. H alone is very unlikely to be enough (inference, UNVERIFIED).
- Pool 1 is our only calibration point. Solo produced fixes whose reference versions total 196 added lines in 4.8 to 7.8 minutes, about 25 to 40 lines per minute.
- The game pool's reference fixes total 301 added lines (median about 12 per item). The 11 flagged items account for 101 of them.
- Hardening adds search work but no code. The reviewer notes that each brief must name every symbol the test calls (houseForm, growthRate and so on), so finding the code stays cheap.
- Four flagged briefs are the spec itself and cannot be cut without making the test unfair: g05 (lookup table), g08 (formula), g17 (rules) and g20 (strings).
- At pool 1's rate, solo needs roughly 750 to 1,200 reference lines of work to run past 30 minutes. That is where the floor of 50 or more added lines on the 11 replacements comes from: 200 lines kept plus about 11 × 70.

4. This stays inside the existing amendment for pools 2 and 3 (items take 10 to 25 minutes and span several files or need investigation). The first curation missed its own floor (median 8 minutes, 5 items under 10 minutes) because it was steered by time estimates. A line-and-file floor can be checked, and the pilot gate protects the design directly.

## Ceiling risk

The evidence here is thin, and the pilot gate is what actually protects the design.

- Calibration: we have one data point. Pool 1's solo seat produced fixes whose reference versions total 196 lines in 4.8 to 7.8 minutes. Assuming solo throughput scales with lines is crude: finding the code and running tests also cost time, and the game's full vitest suite took about 296 s in the curation copy. The stage-1 pilot settles it: one solo run on the hardened pool, 30 minutes, about $2-5. If it lands 16 or fewer, H was enough.
- Gate threshold: solo landing 16 or fewer leaves 4 items of headroom. A prediction counts at a 3-item difference.
- Prediction 3: I expect Room15 vs Room3 to tie again at 20. Any pool where solo makes real progress in 30 minutes is probably within reach of 14 workers. The gate protects predictions 1 and 2, not 3. Pool 1 does not settle this: Room3 took about 9 minutes against solo's 4.8 to 7.8, so rooms were not faster there, and parallel speedup has not been measured yet.
- Floor risk in the other direction: if the R items overshoot, every setup could score low. Two things limit that. The 9 kept items (median fix of 20 lines) should be landable by anyone, and the reserve swap only ever removes the smallest items.
- One pilot is a single run, and pool 1's solo repeats agreed (20 and 20).
- Suite measure: in the curation copy, the base suite failed one file (villageMapModel.test.ts could not load 'react'), probably an environment issue in that copy. Check it before lock, or the "existing suite still passes" measure is broken at base.

## Options compared

### Recommended (H+R, gated): keep the game, harden all briefs, pilot solo, then replace the 11 too-easy items only if solo lands 17 or more

**Verdict:** RECOMMENDED

**For:** Keeps the pre-registered pool identity (Alder game), language, seat tools and base 4193133. The 9 items the reviewer rated moderate or hard stay validated as they are: g02, g04, g07, g10, g11, g12, g13, g14 and g18, with reference fixes of 5 to 43 added lines and median 20. There is no web leak because the game is not public and the fixes are original. The pilot gate measures the ceiling directly instead of estimating it. Items are never chosen from pilot outcomes, only by the reviewer's flags and reference size.

**Against:** One or two pilot runs add 30 to 60 minutes. R costs a curation run even if stage 1 passes, if it is started in parallel. The 50-line floor comes from a crude linear throughput model fitted to one pool. Prediction 3 (Room15 vs Room3) may still tie at 20.

**Effort:** H: about 1 hour of workflow (rewrite agent, identifier-leak script, blind fairness reviewer). Pilot: 30 minutes plus scoring, about $2-5. R: about the size of the first game curation (7 agents, about 2.0M tokens, 2 to 3 hours); dollar cost UNVERIFIED.

### (H) Harden the 11 too-easy briefs only; hidden tests unchanged

**Verdict:** Necessary, but not enough on its own. It is stage 1 of the recommendation, not the whole answer.

**For:** Cheapest option. No revalidation needed, because tests and fixes are unchanged. Fully comparable with pool 1. It fixes the reviewer's 'the brief names the cause' flag for g01, g03, g09, g16 and g19.

**Against:** Adds no code to write. The tests call named functions, so the briefs must keep naming them and finding the code stays cheap. Four flagged items (g05, g08, g17, g20) are fully specified by their acceptance contract and cannot be hardened fairly. With 301 reference lines against pool 1's measured solo rate, solo will probably still land 18 to 20 of 20 (UNVERIFIED; the stage-1 pilot settles it).

**Effort:** About 1 hour of workflow; about $2-5 for the pilot.

### (R) Re-curate all 20 harder game items

**Verdict:** Not needed. The hybrid gets the same effect for about half the work.

**For:** Uniform difficulty and one floor for all 20 items.

**Against:** Throws away 9 validated items the reviewer already rated moderate or hard. It repeats the first curation's risk: it avoided same-file work and rejected 17 candidates, several because they collided with g01 or g02, which pushed it toward small items. It needs 20 fresh validations and a fresh overlap map.

**Effort:** About a day (curation, 3x validation, review).

### (D) Keep the current items and shorten the pool 2 deadline (for example to 10 minutes)

**Verdict:** Reject

**For:** Zero curation; it breaks the ceiling cheaply.

**Against:** Changes a pre-registered constant for one pool only, so pool 2 would differ from pools 1 and 3 in both deadline and difficulty. It measures speed on small items, not the ability to land harder work.

**Effort:** Minutes, but a large deviation from the pre-registration.

### CooperBench, pallets/jinja 3 tasks re-based to 896a621 (MIT)

**Verdict:** Reject. Skeptic's revised fit: weak.

**For:** Measured locally: all 30 features co-apply at one commit. Each failed at base and passed with its reference 3 times out of 3. Tests run in 0 to 9 seconds, and the 830-test suite passes at the merged head. It runs natively on macOS arm64 and needs about a day to adopt.

**Against:** C3 fails. Reference patches download anonymously (HTTP 200). A WebSearch on 2026-09-23 returned item 1465 f5's gold feature.patch page, and the summary described the answer, so blocking WebSearch as well would change the seat toolset. HF lists 42 'cooperbench' datasets, including SFT and midtrain sets. C2 is weak: GPT-5.5 solo passed 91% of these features (246/270), and 27 of 30 briefs have a 'Files Modified' section. It is Python, not the game, so the pool's identity changes.

**Effort:** About a day, plus changes to the seat tools and pre-registration.

### CooperBench as released (12 repositories)

**Verdict:** Reject

**For:** Coordination-focused, MIT, active, per-feature tests and patches.

**Against:** The most features at one base as released is 12. Only the jinja route reaches 20. The only TypeScript repo (react-hook-form) has 11 features across 2 commits. It shares the C3 failure above.

**Effort:** High as released.

### SWE-Lancer IC Diamond on Expensify/App at 2b791c9f (MIT)

**Verdict:** Reject. Skeptic's revised fit: weak.

**For:** TypeScript and product-style. 154 tasks share one commit; 88 to 92 are file-disjoint; a chosen 20 co-apply cleanly.

**Against:** The fixes are upstream Expensify code (C3 fails). One chosen patch, 14223_1, is a nondeterministic sabotage patch with a Date.now() seed that intercepts global events. The bugs are small planted ones (median 11.5 changed lines). The offline mode relies on iptables and only works on Linux, and the tests are end-to-end Playwright runs with mitmproxy replay. Images are amd64 only, about 5 GB. No primary Opus-class score exists.

**Effort:** About 3 to 5 engineer-days, and C3 still fails.

### FeatureBench mlflow subset at 93dab383 (MIT)

**Verdict:** Reject

**For:** Not saturated (Opus 4.7 resolves 46.7% of the lite split). Items are real features.

**Against:** An exact search gives at most 16 items that can be applied together, below 20. The median item is about 896 changed lines, so every setup would likely score near zero in 30 minutes. The removed code is on PyPI and GitHub. It is Python, and the image is amd64 only, about 14 GB.

**Effort:** About 2 to 4 days, plus network lockdown.

### Fresh mining from one TypeScript repo (cloudflare/vinext, SWE-rebench method)

**Verdict:** Reject for pool 2

**For:** Merged after training cutoffs. Native Node on macOS, measured: pnpm install 87 s, one item's tests 15 to 25 s.

**Against:** Only 11 of 136 large PRs cherry-pick cleanly on their own onto the shared base, short of 20 without hand-porting. The items are 4 to 43 files and up to about 2,000 lines, a floor risk. The fixes are public PRs and on npm, so seats would need code hosts and package CDNs blocked. It is still our own curation, of someone else's repository.

**Effort:** About 2 to 4 days.

### SWE-smith generator run on the game repo (MIT tool)

**Verdict:** Optional tool inside R, not a source

**For:** All generated items sit at one commit. It stays private if the mirror is private. It builds arm64 images.

**Against:** The released TypeScript data is 100% single-site procedural mutations (median 5 lines), and 82% of its generated briefs name the modified file. That is the too-easy shape we already have. Its module-level Combine is hard-coded to .py files. Setup needs Docker, a GitHub mirror and LLM keys. Mixing planted-bug items with feature items would change the item type partway through the pool.

**Effort:** About 1 to 2 days of setup.

### SWE-bench family (Pro V2, Pro Verified, Live, MultiLang, SWE-rebench, Multi-SWE, PolyBench, Verified, Multilingual)

**Verdict:** Reject

**For:** Large, well known, SWE-bench schema.

**Against:** At most 1 to 6 items per base commit, so C1 fails. Pro V2 is saturated (Opus 5 scored 638/642 public, 50/51 on HARD-51). Every fix is a public PR, and Scale logged trajectories that retrieved fixing SHAs. Reverting fixes onto one base worked for only 2/23 (element-web) to 29/57 (svelte).

**Effort:** High, and C3 still fails.

## Skeptic check

### CooperBench: pallets/jinja 3-task pool moved to one base commit: revised fit weak

Items per base commit: 30 features (3 tasks x 10). Original bases: 1559 at 896a621, 1465 at 20eb7f5, 1621 at a292075. Re-based: all 30 feature.patch and tests.patch apply at 896a62135bcc (2021-12-26). I re-checked the 20 proposed items myself.

Test runtime observed: Measured on macOS arm64 with the researcher's uv venv (Python 3.11.14, pytest 7.1.3). The full jinja suite (830 tests) passes at base in 3.5 s. With all 3 combined.patch applied it still passes (830 passed in 2.7 s; diff +1380/-71 in 3 files). Each hidden test ran 0-9 s. My 40 item runs (base plus gold for 20 items), the merge and the suite took 90 s in total.

- **holds**: C1: all 20 proposed items fail at base with their tests.patch and pass with only their own feature.patch at 896a621 skeptic_jinja.sh (scratchpad/bench-research). All 20 items: base_rc=1, gold_rc=0. Weak discriminators: 1559 f3 has only 1 new failing test at base (66 pass) and 1559 f5 has 3, so a partial implementation could pass. Caveat: the proposed merged reference (the 3 combined.patch) contains all 30 features, not the chosen 20. No 20-only merged reference has been built or validated.
- **overstated**: C2: GPT-5.5 solo passed jinja features 91% of the time; 27/30 passed 9/9; the hard ones are 1559 f8, 1465 f5 and 1621 f4 Recomputed from HF CooperBench/team-trajectories cmp-full-solo (run started 2026-05-21): 246/270 = 91.1%, but only 26/30 at 9/9 (1621 f8 was 8/9). Median pair time: 146 s / 283 s / 217 s, which matches the researcher. The 1559 f8 failures were spec gaps: 'expected token name, got ,' and trimmed fallback text. The amended brief now states both rules ('Commas are optional', 'trimmed/notrimmed apply to every block'). So the hardest item is probably easy now, and published rates overstate difficulty.
- **overstated**: C2: difficulty is BORDERLINE (solo estimate 25-45 min for 20 items) 27 of 30 feature.md files contain a 'Files Modified' section. Most also name the class and methods; 1559 f8 dictates the class name, tag, method names and error strings. This is the 'brief names the cause' flaw the pool 2 reviewer flagged. The 20 items add 1,342 source lines, median 46.5 per item; 1465 f2 is +19 lines and just passes reverse= to sorted. Pool 1 reference patches were 6-19 added lines, and solo finished 20 of those in 5-8 minutes. Jinja is about 3-5x more code but just as prescriptive. The 25-45 minute estimate comes from per-pair runs that include environment setup and repo exploration; in a 20-item solo run those costs are paid once. Whether solo finishes within 30 minutes is still UNVERIFIED, and the pilot remains necessary. The only real difficulty lever is volume plus intra-task conflicts.
- **holds**: C3: reference patches are anonymously downloadable, and WebSearch finds CooperBench pages 2026-09-23: HTTP 200 for huggingface.co/datasets/CooperBench/cooperbench-dataset/resolve/main/pallets_jinja_task/task1621/feature5/feature.patch and for raw.githubusercontent.com/cooperbench/CooperBench/main/dataset/pallets_jinja_task/task1559/feature8/feature.patch. It is worse than reported: the WebSearch query 'jinja groupby filter "include_empty" parameter' returned huggingface.co/datasets/CodeConflict/cooperbench-dataset/blob/main/pallets_jinja_task/task1465/feature5/feature.patch. That is the hardest item's gold patch. The search tool's own summary then described the parameter's semantics. The query '"ConditionalI18nExtension" ctrans' returned the 1559 f8 tests.patch page, and the summary paraphrased its test cases.
- **wrong**: C3 mitigation: a PreToolUse hook denying WebFetch URLs that match cooperbench|codeconflict|huggingface.co/datasets closes the leak The leak above arrived inside WebSearch results and summaries, and no WebFetch call was made. A WebFetch-only URL hook cannot stop that. It would need WebSearch blocked, or blocked_domains forced through a hook input rewrite, and that changes the pre-registered seat toolset. The HF API also lists 42 datasets matching 'cooperbench', including SFT and midtrain sets (cooperdata-sft-midtrain, cooperdata-v3-midtrain-blend, cooperator-sft-data). The content is being fed into training data.
- **holds**: C3: upstream PR copies are 1465 f1, 1559 f1 and 1621 f2, with the dates given GitHub API: PR #1465 'Add case_sensitive parameter to groupby() filter' merged 2022-03-08T14:57Z; PR #1559 merged 2021-12-26T18:55Z; PR #1621 merged 2022-03-15T21:01Z. None of the three are in the proposed 20.
- **holds**: C5: MIT declared, but the repo has no LICENSE file api.github.com/repos/cooperbench/CooperBench on 2026-09-23: license=null, created 2026-01-18, pushed 2026-09-15, 16 forks. HF card tag license:mit, createdAt 2026-01-28, lastModified 2026-09-05, gated=false.
- **holds**: C4: runs natively on macOS arm64, and pytest<7.2 is needed venv-jinja: Python 3.11.14, pytest 7.1.3. Measured runtimes above.

### CooperBench as released (all 12 repos): revised fit weak

Items per base commit: 2-12 features per task base as released. Only jinja reaches 20 after re-basing (see the jinja entry).

Test runtime observed: Not re-run beyond jinja.

- **holds**: GPT-5.5 via Codex solo scored 55.5% (362/652) traj/cmp-full-solo/summary.json: pass_rate 0.5552, passed 362 of total_evaluated 652. config.json: model gpt-5.5-hao, codex, started 2026-05-21.
- **holds**: C3 FAIL: public since January 2026, with forks and trajectory/SFT datasets The HF API search 'cooperbench' returned 42 datasets on 2026-09-23, several of them SFT or midtrain blends. GitHub: 16 forks.

### Family method: fresh SWE-rebench-style mining from cloudflare/vinext: revised fit weak

Items per base commit: 136 large feat/fix PRs merged 2026-07-15 to 09-20. Only 11 of 136 cherry-pick cleanly onto B = 8e55df80 on their own; 10 of those 11 co-apply. The researcher's 45 was a sequential count, where each pick sits on top of the earlier ones.

Test runtime observed: Measured. pnpm@11.1.1 install --frozen-lockfile, native macOS, stores inside the scratchpad: 87 s including the postinstall builds. Item #2657 (fix(link): interpolate Pages Router dynamic hrefs): with only its test files applied at B, 4 failed / 190 passed in 15 s wall. With the PR applied, 1412 passed in 25 s wall (vp test run --project unit, 3 files).

- **overstated**: C1 PASSES mechanically: 45/136 cherry-pick cleanly onto B forward_test.py cherry-picks in sequence, so an item can depend on earlier picks. I cherry-picked each of the 136 alone onto 8e55df80 (all single-parent commits): 11/136 were clean. Picked in sequence, 10 of those 11 co-apply. The conflicts are real churn from commits between B and each PR: #2641 (2026-07-20) conflicts even though B is its ancestor. The researcher's revert route gave 16/136. Both are short of 20 without hand-porting.
- **holds**: C2: items are far larger than pool 2 (about 9 files / 300 lines) Source size of the 11 independent PRs, excluding *.test.ts, md, json and snap files: 4-43 files, +70 to +1999 lines. #2599 is 43 files +1999/-453, and #2619 is 31 files +1570. Twenty items like this risk a floor effect (every setup scores low) inside 30 minutes. The repo has 557 test files and about 2,954 TS files, plus its own CLAUDE.md and AGENTS.md.
- **holds**: C4: runs as native Node on macOS with no Docker Measured above. Unit tests are vitest run through vite-plus (vp).
- **holds**: C3: training side OK (merged after the June 2026 cutoff); web side needs a blocklist GitHub API: repo created 2026-02-24, public, MIT, TypeScript, 8,840 stars, pushed 2026-09-23. The pre-July code may be in training data. The fixes are public PRs, so the web leak is real.
- **holds**: C5: MIT GitHub API license spdx_id MIT.

### SWE-smith as a generator on our own fresh TypeScript repo: revised fit partial

Items per base commit: By construction, every generated bug sits on one pinned commit. Co-applying 20 is our own selection step.

Test runtime observed: Not run. It needs a GitHub mirror, Docker image builds and LLM keys, which is too heavy for this check.

- **holds**: The profile auto-selects arm64 on Apple Silicon, and mirrors inherit the source repo's privacy Shallow clone at 9b74ac08 (2026-03-22): profiles/base.py sets arch to arm64 when platform.machine() is in {aarch64, arm64}, with pltf linux/arm64/v8. create_mirror calls create_in_org(org_gh, repo_name, private=source_repo.private). Repo metadata: MIT, created 2025-05-01, pushed 2026-09-21, 785 stars.
- **overstated**: LM Rewrite/Modify and combine (same_file, same_module) work language-agnostically for TS llm/rewrite.py uses rp.extract_entities(), and adapters map .ts and .tsx to get_entities_from_file_ts, so that part holds. But combine/same_module.py hard-codes Python: convert_to_path uses a __.py dunder pattern, the file-leaf test is p.endswith('.py'), and there is an 'if k.endswith(".py")' deletion. Module-level combine is therefore likely broken or untested for TS; same_file looks language-agnostic.
- **holds**: The released SWE-smith-ts is 100% procedural func_pm_*, and 82.2% of briefs name the modified file hf/smith-ts.parquet has 5,032 rows, all func_pm_* (op_flip 836, remove_cond 597, arg_swap 595 ...). The patched file's basename appears in 82.2% of problem statements, and the full path in 76.2%.
- **holds**: Difficulty-rater table (LM Rewrite 68/796/136, Combine 52/716/232 ...) docs/guides/difficulty_rating.md lines 35-47. The ratings come from a fine-tuned Qwen2.5-Coder-32B rater predicting human time buckets, not from measured model solve times, so they are weak evidence for Opus 5.5.
- **unverifiable**: C3 PASS if the repo is ours and private The method is clean only if the pool-2 game repo and the generated mirror are private. I did not inspect the game repo (instructed not to touch other repos), so its visibility is UNVERIFIED. If it is public on GitHub, the un-bugged code is one WebFetch away.

### SWE-Lancer (IC SWE Diamond, offline release 2025-07-17): revised fit weak

Items per base commit: Verified live: 198 commit_id.txt files in openai/frontier-evals project/swelancer/issues. 154 at 2b791c9f3053, 33 at da2e6688, 11 singletons.

Test runtime observed: Not run. The official image is swelancer_x86 amd64 (about 5 GB) and per-task images take 10-20 minutes to build, per the README.

- **holds**: C1: 154 tasks share commit 2b791c9f, and setup = checkout plus bug_reintroduce.patch Counted 154 from the raw commit_id.txt files on 2026-09-23. runtime_scripts/setup_expensify.yml checks out the commit, runs revert_command.txt if it is non-empty, and otherwise runs patch -p1 < bug_reintroduce.patch. frontier-evals: MIT, pushed 2026-04-21. openai/SWELancer-Benchmark is archived (pushed 2025-07-18).
- **overstated**: The researcher's 20 co-apply cleanly; only E2E independence is UNVERIFIED One of the chosen 20, 14223_1, is a synthetic sabotage patch rather than a real bug. It uses a Date.now() % 7 seed that hides the composer about 60% of the time, so it is nondeterministic. It also adds document.addEventListener for click, input, keydown, keyup, focus and blur in the capture phase, calling preventDefault and stopImmediatePropagation whenever ReportActionCompose mounts. All 20 chosen test.py files drive the UI with 6-19 click calls, so co-applying 14223_1 very likely breaks the other items' tests (PLAUSIBLE, not executed). 44165_1022 also uses Date.now()/Math.random.
- **overstated**: C2: items are individually hard enough (median price $500, repo has 5k+ files) All 154 bug patches at 2b791c9f, excluding .npmrc hunks: median 11.5 changed lines (p25 3, p75 31); 59/154 change 5 lines or fewer; 85/154 touch a single file; 35 add comments. The fixes are the same small planted-bug shape the researchers rejected for SWE-smith. Any difficulty comes only from localizing the bug in a large repo.
- **overstated**: 2026 rates: GPT-5.3-Codex 81.4%, GPT-5.2 74.6% llm-stats.com/benchmarks/swe-lancer-(ic-diamond-subset) (updated 2026-09-23) marks all 6 entries self-reported, 0 verified. It also lists GPT-5 at 1.000, which the researcher omitted and which suggests the scale is mixed. It has no Claude entries. The GPT-5.1-Codex-Max system card reports SWE-Lancer against the 2025-07-17 dataset, but no primary Opus-class number exists.
- **overstated**: C4: a native macOS path is plausible The frontier-evals README says internet blocking relies on iptables and is Linux only. macOS needs disable_internet=False, and 'some tasks behave abnormally when run with internet enabled, and we only consider rollouts run with internet disabled to be valid.'
- **holds**: 26 tasks priced $1000 or more are in a file-disjoint set of 88 My greedy pass found 92 file-disjoint tasks with 22 priced $1000 or more (the count depends on order). Median price is $500, and 35 of the 154 are priced $1000 or more.

### FeatureBench (full split, mlflow subset): revised fit weak

Items per base commit: mlflow 49 at 93dab383 (39 lv1, 10 lv2), transformers 34 at e2e8dbed, pandas 20 at 82fa2715, astropy 17 (from featurebench_full.json, 200 rows).

Test runtime observed: Not run. The mlflow instance image is amd64, about 14 GB.

- **holds**: C1: 16 strictly file-disjoint lv1 tasks, 17 greedy; 20 needs hand-merging An exact maximum-independent-set search over the 39 mlflow lv1 tasks (conflict = shared patch, test_patch or FAIL_TO_PASS file) gives 16, and only 7 tasks conflict with no other. The other family entry's '18 with disjoint hunks' uses a looser criterion; neither reaches 20.
- **holds**: C2: not saturated, possibly too hard for a 30-minute cap The README leaderboard (lite split, updated 2026-05-18) shows %RESOLVED: Opus 4.7/OpenHands 46.7, GPT-5.5 26.7, Opus 4.6 20, Opus 4.5 Claude Code 20. mlflow lv1 patches have a median of 896 changed lines, and problem statements a median of 2,009 words. With 20 items in 30 minutes, a floor effect is likely for every setup.
- **holds**: C3 FAILS (the removed code is upstream mlflow, fetchable via pip or GitHub) The base commit 93dab383 is public upstream and dated 2025-11-14.

### Multi-SWE-bench / SWE-bench-Live MultiLang / Web-Bench / SWE-Dev / Commit0 dataset (weak ratings): revised fit weak

Items per base commit: As reported by the researchers. Not re-counted.

Test runtime observed: None.

- **holds**: The weak ratings are right, because each fails C3 while seats have web access Every one is built from public upstream code or PRs dated before mid-2026. None was misjudged upward. The Commit0 'stub modules in our own TS repo' idea is a method, not a dataset, and it belongs with the SWE-smith and Change2Task own-repo routes.

### SWE-bench Pro V2 public (rated no): revised fit no

Items per base commit: 1 per base commit (per the researcher).

Test runtime observed: None.

- **holds**: Opus 5 scored 638/642 public and 222/272 private; 32 of 642 open-network trajectories called code hosts The saved pages/pro_v2_blog.html.txt line 56 gives the resolved counts, and pro_v2_lb.html.txt line 36 gives the code-host figure. The page also notes Opus 5 forging a Go module checksum, which is more evidence that network access matters.

### Missed by the researchers

- GameDevBench (arXiv 2602.11103; github.com/waynchi/gamedevbench; Apache-2.0): 333 Godot 4.4.1 game-development tasks built from tutorials, each shipped as its own zip project. Fails C1 (no shared codebase) and is GDScript rather than TypeScript. It is still the closest 'game' benchmark: benchlm.ai lists Fable 5 at 67.3% (2026-08-13), and the repo README lists GPT 6 Astra at 229/333. Fit: no.
- RefactorBench (github.com/microsoft/RefactorBench, archived; GitHub licence NOASSERTION): 103 problem files and 100 test files across 9 Python repos, one snapshot per repo. Maximum per repo is 18 (django), then salt 15, celery 13, scrapy 13. No reference solutions are shipped. The target refactors are not upstream code, which helps C3, but it fails C1 (fewer than 20) and the language is Python. Fit: no.
- Aider Polyglot (Aider-AI/polyglot-benchmark): 225 Exercism exercises in one repo, co-applicable only in the trivial sense that each sits in its own directory with no shared code to contend over. Saturated: llm-stats and aider.chat show GPT-5 at 88.0% as of 2026-09. Exercism solutions are public. Fit: no.
- SWE-EVO (arXiv 2512.18470, v6 2026-05-22): 48 release-note tasks from 7 Python repos, averaging 21 files per task; GPT-5.4/OpenHands scores 25%. Tasks are at per-release bases, so it fails C1, and each task is far too big for a 30-minute cap. Fit: no.
- RACE-Bench (arXiv 2603.26337, latest 2026-08-11): 528 real feature-addition tasks from 12 repos, resolve rates 29-70%. Per-commit layout and licence are UNVERIFIED, and it is likely per-PR, so C1 probably fails. Fit: no (UNVERIFIED).
- VibeMemBench (arXiv 2609.23570, 2026-09-20, CC BY 4.0): 111 targets from 90 repos, derived from SWE-rebench V2. Fails C1. Fit: no.
- REAP/Harvest (arXiv 2604.01527, v4 2026-07-28): benchmark curated from production agent sessions in a proprietary monorepo, mostly Hack; frontier models solve 42.9-58.2%. Private, so it cannot be obtained. Fit: no.
- OpenAI Monorepo-Bench (GPT-5.3-Codex system card, 2026-02-05, section 5.1.3.1): PR-style contributions in a large internal repo, graded by hidden tests. Private. It matters because a frontier lab uses exactly the 'replay our own repo's PRs against hidden tests' design, which supports the Change2Task / own-history route for pool 2. Fit: no (not obtainable).
- SWE Atlas (Scale, arXiv 2605.08366): codebase Q&A rather than code edits, so it does not fit the item shape. Fit: no.
- Cross-cutting point the researchers under-weighted: seats keep WebSearch, and the WebSearch tool's own result summaries quote page content. Any item derived from public text (upstream code, PRs, or public benchmark files such as CooperBench's) can leak without a single WebFetch call. I demonstrated this on 2026-09-23 with the hardest CooperBench jinja item. Only items whose solution never exists publicly pass C3: generated bugs, stubbed modules or replayed history on a private repo (SWE-smith, BugPilot FeatAdd, Commit0-style stubbing, Change2Task). Otherwise the pre-registration must drop or domain-restrict WebSearch as well as WebFetch.

## All candidates assessed

| Candidate | Family | Fit | Licence |
|---|---|---|---|
| [CooperBench: pallets/jinja 3-task pool moved to one base commit (the recommended way to use CooperBench)](https://github.com/cooperbench/CooperBench/tree/main/dataset/pallets_jinja_task) | multi-agent | partial | MIT is declared in the README, in pyproject (license = {text = "MIT"}) and on the HF card (license: mit). The repo has n |
| [CooperBench as released (all 12 repos)](https://github.com/cooperbench/CooperBench) | multi-agent | weak | MIT declared (README, pyproject, HF card), no LICENSE file; each repo keeps its upstream licence; paper CC BY-SA 4.0. |
| [STALE-bench (Passes Alone, Fails Together)](https://github.com/illinoisdata/STALE-bench) | multi-agent | no | Paper CC BY 4.0. The repo has no licence file (GitHub API returns license=null), so reuse terms are UNVERIFIED. Django i |
| [BulkPR-Bench](https://github.com/Eureka246/BulkPR-Bench-Release) | multi-agent | no | Code MIT; data and annotations CC BY 4.0; the diffs carry upstream licences (MIT, BSD, Apache, ISC). |
| [SyncBench (SyncMind, ICML 2025)](https://huggingface.co/datasets/xuehang/SyncBench) | multi-agent | no | MIT (HF card) |
| [Commit0 (used as a multi-agent testbed by STORM arXiv 2605.20563 and CAID arXiv 2603.21489)](https://github.com/commit-0/commit0) | multi-agent | weak | Repo MIT; paper CC BY 4.0; the libraries carry their own permissive licences. |
| [ProgramBench (CooperBench team ran 2- to 4-agent coop runs on it)](https://github.com/facebookresearch/ProgramBench) | multi-agent | no | Repo MIT (created 2026-05-03); paper CC BY 4.0. |
| [MSEval (From-Scratch Multi-Agent Coding)](https://github.com/robinren03/MSEval) | multi-agent | no | Paper CC BY 4.0. The repo has no licence file (API returns license=null). |
| [MultiAgentBench / MARBLE (coding scenario)](https://github.com/MultiagentBench/MARBLE) | multi-agent | no | MIT (repo); paper CC BY 4.0. |
| [Claim Plane frozen CooperBench pairs](https://huggingface.co/datasets/skeinrank/claim-plane-confirmatory-30x3) | multi-agent | no | Paper under arXiv's non-exclusive licence. Dataset licence UNVERIFIED. Items inherit CooperBench's MIT declaration. |
| [SWE-bench Pro V2 public set (642 tasks; includes HARD-51; v1 has 731)](https://huggingface.co/datasets/ScaleAI/SWE-bench_Pro) | swe-bench-hard | no | Harness and tooling are MIT. Task content comes from copyleft upstreams (element-web AGPL-3.0, ProtonMail/WebClients GPL |
| [SWE-bench Pro private/commercial set (272 in V2 / 276 in v1) and held-out set (858)](https://labs.scale.com/blog/swe-bench-pro-v2) | swe-bench-hard | no | Proprietary. Not released. |
| [SWE-Bench Pro Verified (OpenCompass re-verification of Pro v1)](https://huggingface.co/datasets/opencompass/SWEBench-Pro-Verified) | swe-bench-hard | no | Dataset card says Apache-2.0; the upstream copyleft licences still apply to the task code. |
| [SWE-bench-Live (Python: full / verified / lite)](https://huggingface.co/datasets/SWE-bench-Live/SWE-bench-Live) | swe-bench-hard | no | MIT (dataset and harness) |
| [SWE-bench-Live MultiLang (TS and JS splits)](https://huggingface.co/datasets/SWE-bench-Live/MultiLang) | swe-bench-hard | weak | MIT |
| [SWE-rebench leaderboard (monthly fresh tasks; July 2026 snapshot)](https://swe-rebench.com/) | swe-bench-hard | no | CC-BY-4.0 (dataset); per-repo licences recorded |
| [SWE-rebench-V2 (training corpus: 32,079 tasks, plus 120k in SWE-rebench-V2-PRs)](https://huggingface.co/datasets/nebius/SWE-rebench-V2) | swe-bench-hard | no | CC-BY-4.0 |
| [Multi-SWE-bench (TS and JS subsets; also mini and flash variants)](https://huggingface.co/datasets/ByteDance-Seed/Multi-SWE-bench) | swe-bench-hard | weak | Dataset card says CC0, subject to upstream licences (the HF tag reads 'other'). Harness is Apache-2.0. The upstreams (sv |
| [SWE-PolyBench (full 2,110 items and Verified 382; TS/JS subsets)](https://huggingface.co/datasets/AmazonScience/SWE-PolyBench) | swe-bench-hard | no | MIT (dataset) |
| [SWE-bench Verified (saturation and contamination status in 2026)](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified) | swe-bench-hard | no | SWE-bench harness is MIT; the HF card licence field is empty. |
| [SWE-bench Multilingual (300 items)](https://huggingface.co/datasets/SWE-bench/SWE-bench_Multilingual) | swe-bench-hard | no | MIT |
| [Family method, not data: fresh SWE-rebench / SWE-bench-Live style mining from one TS repo (cloudflare/vinext; vuejs/core for comparison)](https://github.com/cloudflare/vinext) | swe-bench-hard | partial | vinext and vue core are MIT; the tooling is MIT/CC-BY. |
| [SWE-smith as a generator run on our own fresh TypeScript repo](https://github.com/SWE-bench/SWE-smith) | same-base-generators | partial | MIT (GitHub API, checked 2026-09-23) |
| [SWE-smith-ts released dataset (off-the-shelf)](https://huggingface.co/datasets/SWE-bench/SWE-smith-ts) | same-base-generators | no | No licence field on the HF dataset card (checked 2026-09-23). Tool is MIT; upstream repos have their own licences (e.g.  |
| [FeatureBench (dataset v1.1) and its fb data pipeline](https://github.com/LiberCoders/FeatureBench) | same-base-generators | weak | MIT (GitHub and HF card), checked 2026-09-23 |
| [FEA-Bench](https://github.com/microsoft/FEA-Bench) | same-base-generators | no | Code MIT. HF dataset 'other', with the licence of each source repo listed on the card. |
| [SWE-Dev (feature-driven development)](https://github.com/DorothyDUUU/SWE-Dev) | same-base-generators | weak | GitHub licence field empty; README badge says Apache-2.0; HF dataset Dorothydu/SWE-Dev apache-2.0 |
| [R2E-Gym](https://github.com/R2E-Gym/R2E-Gym) | same-base-generators | no | Apache-2.0 (code and HF datasets) |
| [SWE-Gym](https://github.com/SWE-Gym/SWE-Gym) | same-base-generators | no | Code Apache-2.0; HF dataset MIT |
| [Commit0](https://github.com/commit-0/commit0) | same-base-generators | weak | Code MIT; HF dataset commit0/commit0 has no licence field |
| [NoCode-bench, renamed Doc2Feat-bench](https://github.com/Doc2Feat-bench/Doc2Feat-bench) | same-base-generators | no | Code MIT; HF dataset apache-2.0 |
| [Breakpoint (adversarial or multi-function corruption generator)](https://arxiv.org/abs/2506.00172) | same-base-generators | weak | HF dataset uzpg/breakpoint: MIT. The paper promises an open-source toolkit but no code URL was found (UNVERIFIED). |
| [BugPilot (FeatAdd agent-generated bugs)](https://arxiv.org/abs/2510.19898) | same-base-generators | weak | Paper CC BY 4.0. No official code or data release found; the VmaxRL/bugpilot-* HF datasets are third-party (UNVERIFIED). |
| [Web-Bench (ByteDance)](https://github.com/bytedance/web-bench) | same-base-generators | weak | Code Apache-2.0; HF dataset bytedance-research/Web-Bench CC-BY-4.0 |
| [SWE-Flow (TDD incremental-step synthesis)](https://github.com/Hambaobao/SWE-Flow) | same-base-generators | no | MIT |
| [SERA (allenai, soft-verified generation)](https://github.com/allenai/SERA) | same-base-generators | no | Apache-2.0 |
| [Change2Task (PR to task at a modern base)](https://arxiv.org/abs/2607.28591) | same-base-generators | weak | Paper CC BY 4.0. No code repo found on GitHub search (2026-09-23). |
| [SWE-Lancer (IC SWE Diamond, offline release 2025-07-17)](https://github.com/openai/frontier-evals/tree/main/project/swelancer) | long-horizon | partial | MIT (project/swelancer/LICENSE.md, 2025); the task codebase Expensify/App is MIT |
| [FeatureBench (full split, mlflow subset)](https://github.com/LiberCoders/FeatureBench) | long-horizon | partial | MIT (repo and dataset card); mlflow is Apache-2.0 |
| [Terminal-Bench 2.0](https://github.com/harbor-framework/terminal-bench-2) | long-horizon | no | Apache-2.0 |
| [Terminal-Bench 3.0/4.0 (2026)](https://github.com/harbor-framework/terminal-bench) | long-horizon | no | Apache-2.0 |
| [GSO (Global Software Optimization)](https://github.com/gso-bench/gso) | long-horizon | no | MIT (repo and dataset) |
| [METR RE-Bench](https://github.com/METR/RE-Bench) | long-horizon | no | MIT, plus an informal request not to publish unprotected solutions |
| [METR HCAST / public-tasks](https://arxiv.org/abs/2503.17354) | long-horizon | no | public-tasks: MIT plus an informal request not to publish solutions (assets in DVC); HCAST as a whole is mostly private |
| [Web-Bench (ByteDance)](https://github.com/bytedance/web-bench) | long-horizon | weak | Apache-2.0 |
| [SlopCodeBench (SCBench, 2026)](https://arxiv.org/abs/2603.24755) | long-horizon | no | Runner MIT; problems repo Apache-2.0 according to the GitHub API (its README badge says MIT); paper CC BY 4.0 |
| [Long-Horizon-Terminal-Bench (2026)](https://arxiv.org/abs/2607.08964) | long-horizon | no | Apache-2.0 (repo); CC BY 4.0 (paper) |
| [SWE-bench Pro (Scale AI; long-horizon, hours per task)](https://huggingface.co/datasets/ScaleAI/SWE-bench_Pro) | long-horizon | no | UNVERIFIED (the dataset card has no licence field) |
