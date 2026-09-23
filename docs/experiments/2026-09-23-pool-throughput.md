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

**Pool 1 (hub, 20 items, 30 minutes, eight valid runs, no audit hits).** Items passing, repeat 1 / repeat 2: Solo 20/20 (4.8 and 7.8 min, $1.92 and $2.56); Split 15/15 (7.2 and 11.9 min, $2.48 and $2.43; all 20 items attempted, the same five lost both times to a `src/hub.ts` merge conflict under the pre-registered keep-earlier rule, and repeat 2's merged head failed four suite commands); Room3 20/20 (9.1 and 9.0 min, $7.06 and $6.19; repeat 2's head failed the blind-drafts regression, a regression the room shipped); Room15 20/20 (8.8 and 9.6 min, $22.31 and $23.30). Against the predictions, in this pool: (1) Split vs Solo went the opposite way (15 vs 20); (2) Room3 exceeded Split by 5; (3) Room15 and Room3 tied at the ceiling, Room15 at about 3.5 times the cost. The pool was at the ceiling for every setup except Split, so items passing cannot separate Solo from the rooms here.

**Amendment.** Pools 2 and 3 are curated with harder items: each item is estimated to take one agent 10 to 25 minutes, touches more than one file or needs investigation of existing behaviour, and still has a behavioural acceptance test validated red at the base and green with a reference fix. Pool size (20), deadline (30 minutes), setups, repeats, measures and predictions are unchanged. Pool 1 is analysed as the easy pool; pools 2 and 3 as hard pools, and the report states results per pool before any cross-pool count.
