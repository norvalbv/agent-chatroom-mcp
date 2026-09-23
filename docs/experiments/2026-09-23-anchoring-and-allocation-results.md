# Results: anchoring and allocation pilots (2026-09-23)

Plan: `2026-09-23-anchoring-and-allocation.md` (committed and pushed at 15b08da before launch). One room per arm, so these are pilots.

## Test 1: anchoring (openings only)

Rooms swarm-105500-cxu1 (carry) and swarm-105600-li9s (no-carry), 8 Opus workers each. The 16 worker openings were stripped of names, shuffled with seed 20260923 and clustered by three independent blind judges (Claude Opus 5.5). All three produced the same three clusters.

| Arm | Distinct ideas (median of 3 judges) | Openings citing a prior run, report, paper or decision |
|---|---|---|
| Carry | 1 (8/8 openings: "the prior room's cuts never reached main; merge them") | 8/8 |
| No-carry | 2 (5 openings: independent attempts plus a check, cut the ritual; 3: the benchmark shows the room adds nothing, default to solo or a builder-reviewer pair) | 8/8 |

**Pre-registered verdict: not supported** (difference of 1 cluster; the threshold was 2). Carried-forward context decided what the seats anchored on (the PRIOR RUNS list), but removing it did not stop anchoring: without it, every seat anchored on the repository's own paper and benchmark results instead.

## Test 2: allocation

Rooms swarm-105802-0s9p (self-organised) and swarm-105804-4ssq (assigned), 3 Opus workers and a verifier each, same 10-item pool, `--no-carry`, run concurrently. Scored by independent Opus checkers: for every item, the room's regression test was copied onto main 15b08da (it failed there) and run at the integration head (it passed), and the fix and test were read against the pool item. I ran the full offline suite on both integration heads in clean worktrees.

| Measure | Self-organised | Assigned |
|---|---|---|
| **Items landed (primary)** | **10/10** | **10/10** |
| Red on main / green at integration, checked independently | 10/10 | 10/10 |
| Full offline suite at the integration head | OK, 121/121 (58a924d) | OK, 124/124 (2a701f5) |
| Collisions (pre-registered: two workers built or began building one item) | 0 (one claim race on item 3, refused by the hub's claim ownership 1.2 s later, before any work) | 0 |
| Distinct items worked | 10 | 10 |
| Minutes to each worker's first commit | 1.2, 1.5, 5.5 | 0.9, 1.0, 1.3 |
| Wall minutes to conclusion | 31.4 | 30.8 |
| Cost (result.json) | $17.48 | $15.37 |
| Non-system chat messages | 41 | 42 |

How the work was divided: in the self-organised room all three workers named item 7 in their blind openings, then claimed items with `if_absent` within seconds and each took three or four items up front. In the assigned room each worker announced its assigned item and took the rest after landing it.

**Pre-registered verdict:** the primary measure hit its ceiling in both arms (10/10), so it cannot separate them. The prediction that the self-organised arm would have at least one collision was **not supported** (0 under the pre-registered wording). The prediction that the assigned arm would have zero collisions and land at least as many items holds, trivially.

**Exploratory, not pre-registered:** a single blind judge (Claude Opus 5.5, told nothing about the arms, reading only the two integration diffs) preferred the assigned arm's implementation on 7 items, the self-organised arm's on 2 (items 2 and 3), and called 1 a tie (item 1). The concrete differences it cited include cost estimation for killed seats (item 10), a hub-owned workspace field that seat text cannot fake (item 8) and a cap measured on the delivered text (item 4). One judge and one room per arm; treat this as a lead, not a result.

## Reading

With a pool of distinct, concrete, testable items, both rooms were productive: 10 verified items in about 31 minutes for $15 to $17. Once such a pool exists, seats partition it themselves through claims, and handing out items added no measured throughput. What both arms shared, and the open research rooms (swarm-083203-kooz, swarm-092653-202z) lacked, is the pool itself: someone outside the room turning findings into distinct targets. Anchoring on shared context does not go away when injected context is removed, because the repository itself is the shared context.

## Deviations from the plan

- Both allocation rooms ran with `--quorum supermajority`, which the plan did not state.
- The assigned room's verifier stayed in the room for about ten minutes after the room concluded; the launcher closed it at its timeout. Conclusion time is unaffected.
- Checks were done by Opus agents and by me, as planned; the blind implementation comparison was added after the data and is exploratory.
