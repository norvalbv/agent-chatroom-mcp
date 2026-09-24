# Pre-registration: build throughput on curated pools (2026-09-23)

Written and committed before any pool was curated or any run launched. Motivation: the paper's limitations section says the maintainer's working pipeline "has never been compared with one agent, a builder–reviewer pair, or a room", and the 2026-09-23 allocation pilot showed small rooms landing a curated 10-item pool at its ceiling. This study asks the practical question with a larger pool, a time cap, hidden acceptance tests and a room size the maintainer cares about.

## Question

Given a pool of 20 curated, independent, testable items from a real repository, which setup lands more items that pass hidden acceptance tests within 30 minutes, and at what cost: one agent, three isolated agents, a three-seat room, or a fifteen-seat room?

## Pools

Three pools, run one at a time, in this order: (1) this hub (`agent-chatroom-mcp`), (2) the Alder browser game (`game`), (3) Frink (`frink`). Each pool is fixed before its runs and committed as a hash-locked manifest: repository, base commit, and 20 items, each with a brief a builder sees. Frink runs use worktrees from its last commit only; its main checkout is never touched and nothing is pushed anywhere.

For every item the curator (an AI agent, not a builder) writes an acceptance test that exercises the item's public behaviour and a reference fix. An item enters the pool only if its test fails on the base commit and passes with the reference fix applied. Tests and reference fixes live outside every repository and worktree, in a directory no brief mentions; builders never see them.

## Setups

All seats are `claude-opus-5-5`, start from the brief alone (`--no-carry` or equivalent: no settled axes, no prior-run list, auto-memory off), work in their own git worktrees from the pool's base commit, and are told the 30-minute deadline. At the deadline the harness stops every seat.

- **Solo:** one seat with all 20 items.
- **Split:** three seats, each given a fixed third of the pool (seeded split, fixed per pool before the runs), no chat. The harness merges their branches in a fixed order after the deadline.
- **Room3:** a flat room of 3 workers and a verifier (`--agents 4 --full-access --require-verification`), organising itself from the pool.
- **Room15:** the same with 14 workers and a verifier (`--agents 15`).

Rooms are scored on the integration branch they declare; if none exists at the deadline, the harness merges their worker branches as for Split. A merge conflict keeps the earlier branch's version and is recorded.

Two repeats of each setup per pool: 8 runs per pool, 24 in all, run one after another in a seeded random order per pool, never concurrently. The active subscription account is recorded for every run from the account-switch log.

## Measures

- **Primary:** items (out of 20) whose hidden acceptance test passes at the setup's final head.
- **Secondary:** cost in USD (from recorded usage; a seat stopped at the deadline is estimated from its partial usage and marked as an estimate); cost per passing item; items attempted (a commit that names the item); merge conflicts; whether the project's existing test suite still passes at the final head; hidden-test leakage (any access to the hidden directory in any seat's transcript, which voids that run).
- **Exploratory, reported separately:** a blind quality comparison of implementations of the same item across setups.

## Predictions

A difference counts when the mean of the two repeats differs by 3 or more items, in the same direction in at least two of the three pools.

1. Split lands more items than Solo (parallel hands).
2. Room3 and Split do not differ (talk adds little to parallel work on independent items).
3. Room15 lands more items than Room3, at a higher cost per passing item.

## Analysis

Per pool, the primary measure for every run and the mean per setup; across pools, the direction count above. No significance tests at two repeats per setup. Every run is reported, including voided and failed ones. Deviations are listed with the results.

## Build order

1. This pre-registration.
2. The pool harness (curation validator, arm launcher with the deadline, merge, hidden-test scorer, leakage audit), built by a small Opus room from a written brief and checked by the maintainer's assistant on a two-item dry run before any real run. Its code and the pool manifests are committed before the first run of each pool.
3. Pool 1 curation, then its 8 runs, then scoring; then pools 2 and 3 in turn.

Estimated cost at list price: about $230 per pool in runs (Room15 about $65 a run), plus curation, roughly $800 in all.

## Clarifications before the first run (2026-09-23, 15:20 BST)

Recorded before any real run; no result had been seen.

- **Fixed room sizes.** Room3 and Room15 run on a benchmark hub with `CHATROOM_NO_RECRUIT=1`: no seat can recruit, and seats get no instruction to start private dev rooms. Every setup therefore has exactly its stated seats. Solo and Split seats never had either.
- **Harness.** Built by room swarm-125917-q12c (28101a2), merged with one fix found on the real repository before any run: git calls now have a 256 MB output buffer (the hub's `git ls-files` listing is 1.36 MB, which overflowed the default and failed every validation).
- **Pool 1 (hub).** Base commit 59e0299, 20 items (h01 to h20), manifest `pools/hub/pool.json` with its sha256 lock. Split by `random.Random(20260924)` into thirds of 7, 7 and 6. Each item's hidden acceptance test failed at the base and passed with its reference fix under the harness's own `validate`. The hidden side lives in a directory outside every repository whose path is not written in any committed file. The suite command for scoring is `npm test`.

## Deviation during pool 1 (2026-09-23, 17:10 BST)

Recorded after pool 1's second run, before any further run.

- **What happened.** In run 2 (Room15, repeat 2), about 90 seconds in, one seat ran `pkill -f "offline-runner"` to stop a test runner. The launcher then passed each seat's whole brief in its command line (`claude -p "<brief>"`), and the brief mentions `offline-runner`, so the pattern matched and 14 of the 15 seats were killed within a second. One seat carried on alone and the final head passed 20/20, but the run was not a fifteen-seat room.
- **Ruling.** Run 2 is void as a harness defect, not a property of the setup, and is reported as such. It is rerun as Room15 repeat 2 in the same position in the order. Split repeat 1 had just started when pool 1 was stopped; it is discarded unscored and rerun. Run 1 (Room15, repeat 1) stands: all 15 seats exited normally and no seat ran `pkill` or `killall`.
- **Fix.** From here on every seat gets its prompt on standard input, never in its command line (commits ffe5a7c and 9e3fe25), so no process-matching command can hit a brief's text. A dry run on three items under the fix landed 3/3 for Solo and for a three-seat room, with all seats exiting normally and complete costs.

## Pool 1 result and amendment for pools 2 and 3 (2026-09-23, 19:40 BST)

Recorded after pool 1 finished and before pool 2 was curated.

**Pool 1 (hub, 20 items, 30 minutes, eight valid runs, no audit hits).** Items passing, repeat 1 / repeat 2: Solo 20/20 (4.8 and 7.8 min, $1.92 and $2.56); Split 15/15 (7.2 and 11.9 min, $2.48 and $2.43; all 20 items attempted, the same five lost both times to a `src/hub.ts` merge conflict under the pre-registered keep-earlier rule, and repeat 2's merged head failed four suite commands); Room3 20/20 (9.1 and 9.0 min, $7.06 and $6.19; repeat 2's head failed the blind-drafts regression at scoring, later shown to be a load flake: see the next section); Room15 20/20 (8.8 and 9.6 min, $22.31 and $23.30). Against the predictions, in this pool: (1) Split vs Solo went the opposite way (15 vs 20); (2) Room3 exceeded Split by 5; (3) Room15 and Room3 tied at the ceiling, Room15 at about 3.5 times the cost. The pool was at the ceiling for every setup except Split, so items passing cannot separate Solo from the rooms here.

**Amendment.** Pools 2 and 3 are curated with harder items: each item is estimated to take one agent 10 to 25 minutes, touches more than one file or needs investigation of existing behaviour, and still has a behavioural acceptance test validated red at the base and green with a reference fix. Pool size (20), deadline (30 minutes), setups, repeats, measures and predictions are unchanged. Pool 1 is analysed as the easy pool; pools 2 and 3 as hard pools, and the report states results per pool before any cross-pool count.

## Run isolation, validation reruns, and a correction (2026-09-23, 21:00 BST)

Recorded before pool 2 was validated or run.

- **Pool 1 exposure.** Every pool 1 run worked in the one real repository, so a seat could see earlier runs' branches: a Room3 repeat-2 seat's `git branch -a` listed Room3 repeat 1's integration branch, and two Room15 seats saw a listing that named Room15 repeat 1's worktree and branch. No transcript shows a seat checking out or diffing an earlier run's work, so this is exposure, not observed use; the leakage audit did not cover it (it searched only for the hidden root and hidden test names). Repeat-2 results match repeat 1 for every setup. Pool 1's results stand with this disclosed.
- **Fix, from pool 2 on.** Each run now gets its own repository holding only the base tree as one commit (`git archive`), so no other run's refs or objects exist in it. Pool 1's 40 branches were moved out of the real repository into a bundle, and its worktree registrations removed.
- **Validation.** Each item's hidden test now runs three times at base and three times with the reference fix; an item whose outcome changes is flaky and invalid.
- **Correction.** Room3 repeat 2's final head passes the blind-drafts regression 3 of 3 when run alone; its failure at scoring was a timing flake under machine load, not a shipped regression. Split repeat 2's suite failure stands: it is a deterministic crash (`hub.askMentions is not a function`) from the merge.

## Build pin and pool 2 source (2026-09-23, 22:30 BST)

Recorded before pool 2 was locked, validated or run.

- **Build pin.** Pools 2 and 3 run from branch `study/pool-throughput`, branched from main at the commit that records this note. Its src/, prompts/ and skills/ are identical to ffe5a7cd, the build nine of pool 1's ten valid runs used (Room15 repeat 1 ran on c016d79a, before seat prompts moved to stdin). The harness serves the dist/ of the checkout it runs from, so development on main cannot change the setups mid-study. Only harness measurement fixes are cherry-picked onto the pin, each noted here.
- **Pool 2 source under review.** The curated game pool validated (20 of 20 red at base and green with the reference, 3 of 3 each), but its reviewer flagged 11 of 20 items as too easy (median reference fix 8 minutes), and pool 1 already hit the ceiling for three of four setups. Before locking, an open-source benchmark is being compared against hardening these briefs; the choice and its reasons will be recorded here before any pool 2 run.

## Pool 2 source, harder items and a ceiling gate (2026-09-23, 23:39 BST)

Recorded before pool 2 was locked, validated or run, before any pilot, and before replacement items were curated. Evidence: [pool2-source-research-2026-09-23.md](pool-throughput/pool2-source-research-2026-09-23.md).

- **Source.** Pool 2 stays the game at base 4193133. Open benchmarks were compared first and none is used. SWE-bench-style datasets hold at most 1 to 6 items per base commit. The one set that reaches 20 items at one commit with a local test run (CooperBench's jinja tasks, re-based) publishes its reference patches, and a WebSearch on 2026-09-23 returned one of them, so seats with web tools could find fixes. The others need Linux-only offline modes or amd64 images, or are too large for 30 minutes. Adopting any of them would also have changed the pool's repository, language and seat tools. The game has no public repository. Seat tools, including WebSearch and WebFetch, stay as in pool 1.
- **Briefs.** Every item's brief is rewritten to state the symptom, the required behaviour, and the interface and thresholds the hidden test checks. It names no cause, no file to change and no fix. A brief may name an identifier from the reference fix only if the hidden test calls or imports it. Hidden tests and reference fixes are unchanged, so each item keeps its 3-of-3 validation.
- **Gate.** One solo pilot runs on the 20 items with the rewritten briefs, using the same launcher, seat, deadline and tools, in its own isolated repository, from the pinned build. The pilot is practice, reported separately and never counted in any measure. If it lands 16 or fewer items, the pool is locked as it stands.
- **Replacement items (curated now, in parallel, used only if the pilot lands 17 or more).** Owner's choice: curation starts now as insurance. Candidates are new game items at base 4193133 whose reference fix touches at least two non-test source files and adds at least 50 non-test lines. Each brief follows the brief rule above, and each hidden test fails 3 of 3 at base and passes 3 of 3 with the reference. No two reference fixes in the pool edit the same function body. If the pilot lands 17 or more, the 11 items the curation reviewer flagged as too easy (g01, g03, g05, g06, g08, g09, g15, g16, g17, g19, g20) are replaced by the 11 largest candidates by added non-test lines, and the next 4 are held as reserves. A second solo pilot runs under the same rules. If it also lands 17 or more, the 4 pool items with the smallest reference fixes are swapped for the reserves, and the pool is locked without a further pilot and reported as near-ceiling.
- **No item is chosen from pilot results.** A pilot decides only whether a stage runs. Which items change is fixed above, by the reviewer's flags and by reference size. The gate reads solo's own pilot score, so it can bias the pool slightly against solo; the pilot's items are never selected by which ones solo missed.
- **Suite measure.** Before lock, the game's full suite is run at base in an isolated repository built from a git archive of 4193133. If a file fails at base (the curation copy saw one test file fail to load a dependency), the suite command that is green at base is recorded here before any run.
- **Unchanged.** Pool size (20), the 30-minute deadline, setups, seat model and tools, repeats, measures, predictions and the cross-pool direction count. Pool 1 remains the easy pool. Pool 3 is curated to the replacement-item floor and passes the same pilot gate.

## Measurement fix on the build pin (2026-09-24, 01:49 BST)

Recorded before pool 2 was locked or run. Cherry-picked onto `study/pool-throughput` as b72f8d4a (from 1ae12524, reviewed): scripts/seat-cost-estimate.ts gains a claude-opus-5-5 list-price row and prices cache writes by their TTL (1-hour writes at the 1-hour rate), with prices from LiteLLM's model_prices_and_context_window.json. Without it, an Opus 5.5 seat killed at the deadline got a null cost and blanked its whole run's cost; pool 1 never hit the deadline, so its costs are unaffected (all came from the CLI's own costUSD). The rates reproduce the CLI's costUSD for all 753 Sonnet 5 entries in bench/results and for pool 1's Opus 5.5 seats. It changes only cost estimation for seats that never reported a cost; setups, seats and scoring are untouched.

Two more measurement commits were cherry-picked onto the pin, after review found that the price row alone would bias cost across setups: 2a99f4e5 (from 4eedb336) reads all list prices from a pinned LiteLLM snapshot, and e7f11c48 (from 430bf8a3) takes a killed stream-json seat's output tokens from each message's final message_delta instead of the assistant-event placeholder, which undercounted output about 90x in a probe. Without e7f11c48, a solo or split seat killed at the deadline would be priced from placeholders while room seats are priced from their session logs' final counts. e7f11c48 adds --include-partial-messages to stream-json seats only (solo and split); room seats' arguments are unchanged, and the flag changes only the event stream the harness reads, not what the model sees.

## Pool 2 details fixed before lock (2026-09-24, 02:00 BST)

Recorded before pool 2 was locked, validated or piloted.

- **Briefs.** All 20 briefs were rewritten under the brief rule. A leak reviewer (brief against reference fix, plus a script listing brief identifiers that appear in the fix but not in the test) flagged 2 (g13 named a test file next to a changed file; g19 pointed at the rule the fix changes); both were revised and passed on re-check. A blind fairness reviewer (brief and test only, never the fix) found no item a capable engineer could not pass from the brief. Hidden tests and reference fixes are unchanged.
- **Suite command.** `npx vitest run --minWorkers=1 --no-cache --exclude src/village/features/program/streetPerf.test.ts`, green at base in two full runs in an archive copy (99 files, 796 tests). The plain full run was green in 1 of 2: its only failure was streetPerf's wall-clock guard under machine contention (green 3 of 3 alone, 5 to 6 times under its limits), so that one timing file is excluded. `--no-cache` keeps vitest from writing run results into the linked node_modules. The earlier "cannot load react" failure came from the curation run deleting its node_modules link mid-run, not from the base.
- **Test environment.** This machine runs a machine-wide test queue, loaded into every node process through NODE_OPTIONS: at most three test runs at once (vitest, npm test and directly run test files), each vitest run capped at 3 workers, later runs waiting for a slot. It was in place for pool 1 as well, so seats in bigger setups wait longer for test slots in every pool. Its worker cap makes a plain `vitest run` of this game fail at once (vitest 1.6 defaults minThreads to cores minus one, above the cap of 3), which pool 1's suite never hit. Pool 2 runs, validation and scoring are therefore started with `VITEST_MIN_THREADS=1` in the harness environment, which every seat, hub and scoring process inherits; with it a plain `npx vitest run` works. Nothing in any brief mentions it.
- **Split and order.** Items are split into thirds of 7, 7 and 6 by `random.Random(20260925)` shuffling the sorted ids; the 8 runs are ordered by `random.Random(20260926)` shuffling the sorted (setup, repeat) pairs. The pilot runs first, outside that order.
- **Stage 2 with fewer candidates than planned.** Only 8 replacement candidates met the floor (r17, r02, r11, r01, r03, r06, r14, r05; 50 to 77 added non-test lines each), not 15. If the pilot lands 17 or more, those 8 replace the 8 flagged items with the smallest reference fixes: g15, g19, g01, g08, g09, g03, g06 and g16 (4 to 12 added non-test lines each). g05, g17 and g20 stay with their hardened briefs. Before the swap, each candidate is checked for function-body overlap with g05, g17 and g20 as well as the 9 kept items; a candidate that overlaps is dropped and the flagged item it would have replaced stays. There are no reserves: if the second pilot also lands 17 or more, the pool is locked as it stands and reported as near-ceiling.

**Pool 2 locked and validated (2026-09-24, 02:48 BST).** Manifest `pools/game/pool.json`, sha256 91c2bb418646f64896c53f18d96d50e47c951ada397594dfddaf3c650395aa21, base 4193133, 20 items with the hardened briefs, split `[[g01, g02, g03, g06, g09, g16, g19], [g07, g08, g12, g13, g15, g18, g20], [g04, g05, g10, g11, g14, g17]]`. `validate --repeats 3 --suite` from the pinned build with `VITEST_MIN_THREADS=1`: every item's hidden test failed 3 of 3 at the base and passed 3 of 3 with its reference fix, the suite command passed with each reference fix applied, no item was flaky, and no hidden name appears in the repository or in any brief (47 minutes). Next: the solo pilot (practice, excluded), then the gate.

**Pool 2 pilot 1 (practice, excluded from every measure; 2026-09-24, 03:16 BST).** One solo run (rep 90, its own scratch root) on the locked hardened pool: 18 of 20 items passed, about 23 minutes, $4.69, suite green, no audit hits. The gate's threshold is 16, so stage 2 runs as pre-registered: the 8 replacement candidates replace g15, g19, g01, g08, g09, g03, g06 and g16, after the overlap check against g05, g17 and g20, and a second pilot follows. (For scale only: pool 1's solo runs took 4.8 and 7.8 minutes for 20 of 20.)

**Pool 2 stage 2 locked and validated (2026-09-24, 03:56 BST).** The function-level overlap check against g05, g17 and g20 found no shared function body for any of the 8 candidates (r02 and g20 both touch the import lines of pieces.ts only), so all 8 entered. Manifest `pools/game/pool.json` now holds g02, g04, g05, g07, g10, g11, g12, g13, g14, g17, g18, g20 and r01, r02, r03, r05, r06, r11, r14, r17; sha256 7ee7b8ac50c42a47023b340cc5377ce02816a8f4f5ab3714689a12f1601bac2e (the stage-1 lock, 91c2bb41…, is superseded and was only piloted). Split by the same rule: `[[g02, g04, g05, g11, g14, r05, r14], [g12, g13, g20, r01, r03, r11, r17], [g07, g10, g17, g18, r02, r06]]`. `validate --repeats 3 --suite`: all 20 fail 3 of 3 at the base and pass 3 of 3 with the reference fix, the suite passes with each fix, nothing flaky, no hidden name in the repository or any brief (39 minutes). Next: pilot 2.

**Pool 2 pilot 2 and the gate (practice, excluded from every measure; 2026-09-24, 04:11 BST).** One solo run (rep 91) on the stage-2 pool: 13 of 20 passed, 14 attempted, about 12 minutes, $3.23, suite green, no audit hits. 13 is 16 or fewer, so pool 2 is locked as it stands (sha256 7ee7b8ac…). With no reserves left, a count of 17 or more would also have locked this same pool, labelled near-ceiling.

**Observation, not a change.** Neither pilot seat was stopped by the deadline. Each ended its own turn: pilot 1 at 23 minutes believing it had finished, pilot 2 at 12 minutes writing that it had got through 13 items "before the deadline", with 18 minutes left. Neither checked the time. The brief gives the deadline only as "you have 30 minutes from now" and no clock, as in pool 1, and every setup gets the same brief, so this stays as it is: a seat's own time-keeping is part of each setup. Results will report, per run, whether seats stopped themselves or were stopped at the deadline, and how many minutes were left.

**Pool 2 run order.** `random.Random(20260926)` shuffling the sorted (setup, repeat) pairs: room3:2 solo:2 room3:1 split:2 solo:1 split:1 room15:1 room15:2.

## Pool 2 result (2026-09-24, 06:41 BST)

**Pool 2 (game, stage-2 pool 7ee7b8ac…, 20 items, 30 minutes, eight valid runs, no audit hits, suite green at every final head, every cost from the CLI's own figures).** Items passing, repeat 1 / repeat 2 (minutes; cost):

| Setup | Rep 1 | Rep 2 | Mean | Cost per passing item |
|---|---|---|---|---|
| Solo | 20 (25.5 min; $6.15) | 8 (12.6 min; $1.97) | 14.0 | $0.29 |
| Split | 14 (9.8 min; $5.11) | 14 (9.4 min; $6.30) | 14.0 | $0.41 |
| Room3 | 19 (14.1 min; $13.61) | 19 (13.9 min; $13.24) | 19.0 | $0.71 |
| Room15 | 20 (15.1 min; $34.84) | 19 (22.3 min; $33.65) | 19.5 | $1.76 |

Against the predictions, in this pool: (1) Split vs Solo: no difference (14.0 vs 14.0). (2) Room3 exceeded Split by 5.0. (3) Room15 vs Room3: no difference (19.5 vs 19.0), at about 2.5 times the cost per passing item.

**Where the predictions stand after two pools.** (1) Split more than Solo: opposite in pool 1, no difference in pool 2, so it cannot reach two pools and is not supported whatever pool 3 shows. (2) Room3 and Split not differing: Room3 landed 5 more in both pools, the same direction in two pools, so the prediction is contradicted. (3) Room15 more than Room3: no difference in either pool, so it cannot reach two pools and is not supported; Room15 cost 3.5 and 2.5 times as much per passing item.

**Observations, reported separately from the measures.**
- Every seat in every run stopped itself; none was stopped at the deadline. Solo repeat 2 ended its turn at 12.6 minutes after attempting 9 items, with 17 minutes left, as pilot 2's seat did; Solo repeat 1 used 25.5 minutes and landed all 20. Solo's mean therefore averages two different behaviours of the same setup.
- Split lost items to merges both times (2 conflicts per run, under the pre-registered keep-earlier rule): seats 2 and 3 conflicted with seat 1 on threats.ts and simulation.ts (repeat 1) and on claimTown/module.ts, threats.ts, building/module.ts and building/pieces.ts (repeat 2). The harder items share files, which the rooms resolve by integrating onto one branch.
- The rooms were faster than the solo run that finished everything: 14 to 22 minutes against 25.5.

## Pool 3 setup (2026-09-24, 09:00 BST)

Recorded before pool 3 was curated. Owner's go-ahead: same method as pool 2.

- **Repository and base.** Frink at f4f7eacdb (its latest commit when curation starts; the GitHub repository is private). Items come from the root Electron app, whose tests run with the root vitest config and the root node_modules; the separately installed side packages (socket-server, relay, vercel-serverless, marketing) are out of scope because the harness links only the root node_modules. The main checkout (179 uncommitted changes) is never modified; curation and runs use `git archive` copies of the base.
- **Items.** Every item meets the replacement floor from the start (reference fix touches at least two non-test source files and adds at least 50 non-test lines), follows the pool 2 brief rule, fails 3 of 3 at base and passes 3 of 3 with its reference, and shares no function body with another item. The same leak review, blind fairness review and suite check as pool 2 apply.
- **In-progress work.** Frink has about 165 worktrees and many branches on this machine, and seats can read the file system. An item is not eligible if any existing branch or worktree already contains work on it. The owner agreed that the Frink sessions are asked to keep the chosen items out of Frink until pool 3's runs finish. After the runs, every transcript is searched for reads of the Frink checkout or its worktrees; hits are reported with the results (reported, not voiding, since the audit rule is pre-registered as hidden-root and hidden-name access).
- **Gate.** The same solo pilot gate as pool 2: lock if the pilot lands 16 or fewer. Curation aims for 24 floor-meeting items so that, if the first pilot lands 17 or more, the 4 items with the smallest reference fixes are replaced by the 4 largest spares, followed by one more pilot and then a lock either way.

## Pool 3 details fixed before curation finishes (2026-09-24, 11:00 BST)

Recorded while pool 3's candidates are still being selected, before any item is built, validated or piloted.

- **Curation restarted.** The first curation run's environment probe finished, but its single scout (asked for all 32 candidates at once) was restarted six times by the workflow watchdog and returned nothing, so no item was built. Curation re-runs with five scouts, one per area of the root app, and one selector; the method is otherwise unchanged.
- **Suite command.** `node scripts/ensure-package-deps.mjs && npx vitest run --no-cache`. At the base the plain `npx vitest run` fails exactly four files (the relay package's own test and three webhook tests that import it) with "Cannot find package 'helmet'": the relay side package keeps its dependencies in its own node_modules, which an archive copy with the linked root node_modules lacks. The script is the repository's own `pretest` hook (`npm test` runs it); it installs those dependencies in about a second from the npm cache, into a gitignored folder. With it the base is green: 1096 test files passed, 1 skipped. Seats get the base as it is, in every setup: `npm test` runs the hook, a bare `npx vitest run` shows the four failures.
- **Test environment.** As in pool 2: runs, validation and scoring start with `VITEST_MIN_THREADS=1` (Frink's vitest 4 ignores it) under the same machine-wide test queue.
- **Which items.** If more than 24 items pass validation (`validate --repeats 3 --suite`) and the reviews, the 24 with the largest reference fixes (added non-test lines) are kept. `random.Random(20260927)` shuffles their sorted ids: the first 20 are the pool, the last 4 are spares. If pilot 1 lands 17 or more, the 4 pool items with the smallest reference fixes are swapped for the spares (the swap is skipped for any spare that shares a function body with a pool item). With 20 to 23 passing items, all are used and the spares are whatever is left. With fewer than 20, one more curation round for the shortfall, same method, runs before the lock.
- **Split and order.** Thirds of 7, 7 and 6 by `random.Random(20260928)` shuffling the sorted pool ids (redrawn with the same seed after a swap); the 8 runs ordered by `random.Random(20260929)` shuffling the sorted (setup, repeat) pairs. The pilot runs first, outside that order.
- **Machine load (reported only).** Other sessions share this machine; its load average reached about 96 on 10 cores during curation. The runner script records the 1-minute load average at the start and end of every run; it is reported with the results and changes nothing.

## Pool 3 source frozen (2026-09-24, 11:05 BST)

Recorded before any pool 3 item is built.

- **Why.** Frink keeps changing under its owner's other sessions. At 09:01 today its working branch was reset from f4f7eacdb to a later merge, so the base commit survived only on two backup branches, which could be deleted and garbage-collected mid-study. The harness also took dependencies from the source repository's node_modules, which those sessions reinstall at will, and its validation adds temporary worktrees to the source repository's own git data.
- **Snapshot.** Pool 3's source is a standalone repository outside Frink holding exactly commit f4f7eacdb6680db597a6bf8351880dbe4f4b1d2c (same hash, tree a72eaf23…, fetched shallow), plus a copy-on-write copy of the node_modules on which the base suite had passed that morning. Fingerprint of the dependencies: 1957 package.json name@version entries, sha256 7dbb6b57b6f70cbda7c5b994ed5c5755505d9a5342579de8b80ba73f48f5106d. An archive copy of the snapshot with its node_modules linked passes the pool 3 suite command at base (1096 test files passed, 1 skipped; 14140 tests). pool.json names the snapshot as its repository, so curation, validation, runs and scoring read only the snapshot, and seats' linked dependencies point at it rather than at Frink.
- **Drift check (reported only).** Seats share the linked node_modules, as in pools 1 and 2, so a seat that installs a package changes it for later runs. After every pilot and counted run the fingerprint is recomputed and any change is reported with the results.
- **What a snapshot cannot cover.** If one of the chosen items is later built in Frink itself, its fix exists elsewhere on this machine. That stays covered by the hold request to the Frink sessions and the post-run transcript search already recorded under "Pool 3 setup".

## Pool 3 candidate shortfall and a top-up round (2026-09-24, 11:45 BST)

Recorded before any pool 3 item is built.

- **Selection so far.** Five area scouts proposed 24 candidates from Frink's documented backlog (deferred follow-ups in its decision records, todo docs, TODO and not-yet notes in the source). The selector dropped one duplicate and two that change the same function as a kept item, leaving 21 (f01 to f21), each clear on the in-progress check. Most other documented follow-ups at the base are already built, out of date after Frink's move to local-first, or below the floor.
- **Top-up.** Requiring a backlog note was a curation choice, not a pre-registered rule: pool 2's replacement items only had to be new items at the base that meet the floor. To reach 24 before the losses to building and review, a top-up round runs now, alongside building the 21. It also accepts gaps found in the code at the base (a bug that reproduces at the base, or a capability the code itself shows is unfinished), under the same floor, brief rule, in-progress check and function-body independence from f01 to f21. Top-up items are numbered from f22.
- **Unchanged.** Which items enter the pool and which are spares follows the rule recorded at 11:00 (the 24 largest if more pass; seeded choice of 20). Top-up items have no priority over f01 to f21.
