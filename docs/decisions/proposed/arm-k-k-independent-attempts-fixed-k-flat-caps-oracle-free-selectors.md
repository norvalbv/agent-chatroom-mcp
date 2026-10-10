# Proposed decision: arm-k-k-independent-attempts-fixed-k-flat-caps-oracle-free-selectors

From swarm-122749-7x9q (concluded); report: swarms/swarm-122749-7x9q/report.md. A human promotes this into docs/decisions/ with `guard-decisions add`; nothing is adopted automatically.

DECISION RECORD** (for `guard-decisions add`)
- **slug:** `arm-k-k-independent-attempts-fixed-k-flat-caps-oracle-free-selectors`
- **context:** The predecessor A-k draft (a46fb60) had a per-attempt cap of C_cost/k that would have killed ordinary attempts (arm A never neared its cap in the grid). It was sequential (about 1000 attempts, over 8 h), refused code tasks, and was not in the grid or statistics. Its cost fields summed unknown as zero. Without arm K the chatroom's advantage over "more single agents at the same price" is unmeasured.
- **ruling:**
  - k = floor(mean C / mean A) = 10 / 8 / 7, fixed before any run.
  - A flat 0.30 USD and 150 s per attempt, as a runaway rail rather than the matching mechanism.
  - Matching judged on realized per-seed spend.
  - A killed attempt is a null vote with its cost counted.
  - A group with nothing to submit is an arm-K fail, never dropped.
  - Plurality for exact-answer tasks, MBR-exec for printf, signature plurality as the exploratory secondary.
  - Probes come from the public README only, frozen by hash.
  - Bounded `--concurrency` with process-group kill and an outer deadline+30 s timeout.
  - Cost is known only when usage coverage is complete.
  - Holm family fixed at 6.
  - Results go to `bench/results/rq1-arm-k`, and the pilot goes to `rq1-arm-k-pilot`.
- **consequences:** No lost or zero-summed cost, no pool deadlock, and no oracle input to selection. The printf outcome is reported as a mechanism rather than as selector neutrality. The grid is resumable at about 72 USD and 2.3 h.
- **tradeoff:** The printf selector is knowingly expected to score below one attempt. The K-vs-A clause of prediction 1 is unlikely to survive Holm. The pilot was one draw per task on borrowed arm-C pairings, and it did not test the timeout paths with a real failure.
- **researched:**
  - NEW relative to the settled list, cited by sonnet-1 in `paper/amendments.md` and not fetched by me: arXiv:2203.11171, arXiv:2204.11454, arXiv:2207.10397.
  - Everything else this run was read from the repo (`rq1-suite` results, `prereg-arm-k.md`, `amendments.md`, the branch diffs).
  - Settled axes touched: `measure-task-success-on-a-machine-oracle` (oracle isolation held) and `done-means-independently-verified` (the non-author verify entry).
- **rejected:**
  - C_cost/k cap: loses on starving ordinary attempts.
  - The self-written-tests selector: loses on selecting nothing, since nearly every attempt reports passing.
  - Swapping in CodeT to rescue printf: loses on every agreement rule ranking the 26-implementation class above the 14.
  - Reusing the finished arm-A runs as attempts: loses on prereg contamination.
  - `--no-pair` pilot flag: loses on not exercising the grid path (used `--c-seed-offset` instead).
  - Sequential attempts: loses on wall time.
  - Merging two independent timeout fixes: loses on opposite parameter semantics.
- **revisit-when:** The 101-140 grid shows arm-K spend above arm C on the 40-seed mean, or the K<=C flag comes out false. Or the printf group null-vote or unloadable-candidate counts show caps starving attempts. Or `printfProbes()` changes its sha256 (rerun the calibration before further printf spend). Or the printf task stops being a two-class population.

No existing axis is re-targeted.
