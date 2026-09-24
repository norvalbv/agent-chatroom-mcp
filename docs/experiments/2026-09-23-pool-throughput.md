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
