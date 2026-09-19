# Pre-registration: arm K (k independent single-agent attempts, oracle-free selection)

Written 2026-09-19 by the maintainer session, after the RQ1 grid (`bench/results/rq1-suite`, commit a11ea5e)
and **before any arm-K run exists**. Its purpose is to make the arm-K result a test of a stated prediction
rather than a story fitted afterwards. The build room may refine the harness details; it may not change
the predictions below, and any change to k or to a selection rule after the first arm-K grid run is a
forking path that must be logged in `paper/amendments.md` with the runs that preceded it.

## What is compared

Arm K spends about what the chatroom (arm C) spends, on k unmodified, non-communicating arm-A attempts
for the same (task, seed), then submits ONE attempt chosen without access to the oracle. The submitted
attempt is scored by the unchanged oracle. Reported cost and turns are the sum over all k attempts.

Proposed k, matched on expected spend from the completed grid (mean arm-C cost / mean arm-A cost, floored):

| task | mean arm-A cost | mean arm-C cost | k |
|---|---|---|---|
| stamp-interpreter | 0.058 | 0.602 | 10 |
| stamp-2 | 0.068 | 0.595 | 8 |
| bench-printf-format | 0.096 | 0.745 | 7 |

Arm A never approached its budget cap in the grid (four to eight turns, 20 to 48 s), so a per-attempt cap
of C_cost/k would kill attempts at their ordinary cost (at k=9 every stamp-interpreter attempt exceeds
min(C_cost)/k). The per-attempt cap must therefore leave headroom, and matching is judged on realized mean
spend per seed: arm K's must not exceed arm C's.

## What the existing data already says

The seed is a pairing key, not a randomization control (`paper/amendments.md`, 2026-09-18), so the 40 arm-A
runs per task are exchangeable draws. Their answer distributions:

- stamp-interpreter: 33 correct, 7 wrong, all 7 the byte-identical wrong answer.
- stamp-2: 28 correct, 12 wrong: 11 one identical wrong answer, 1 another.
- bench-printf-format: 14 of 40 pass the hidden tests. Earlier pilots of the same family found failing
  implementations fail on the same cases (`%.17g` of 1e-07), i.e. the wrong behaviour is the modal one.

Plug-in resampling (k draws with replacement from the 40 observed answers, plurality, ties at random,
200000 repetitions, seed 1):

| task | k=3 | k=5 | proposed k |
|---|---|---|---|
| stamp-interpreter | 0.919 | 0.960 | 0.989 (k=10) |
| stamp-2 | 0.794 | 0.851 | 0.895 (k=8) |

## Predictions (maintainer, recorded before the run)

1. **Interpreter family: voting nearly closes the gap.** Arm K passes at about 0.99 on stamp-interpreter and
   about 0.90 on stamp-2. With n=40 per arm, arm K vs arm C is NOT significant on either task (40 of 40
   against roughly 39 and 36 of 40), while arm K vs arm A is. If this holds, the chatroom's RQ1 advantage on
   this family is matched, at equal cost, by sampling and voting, and the paper must say so. This retracts a
   statement the maintainer made to the project owner on 2026-09-19 ("I expect voting to fail where
   deliberation succeeded"): a shared wrong answer defeats voting only when it is the PLURALITY answer, and
   here the correct answer is.
2. **printf family: agreement-based selection does not help and may hurt.** The single-agent pass rate is
   0.35 and the wrong behaviour is modal, so any selector that rewards agreement between attempts is
   predicted to land at or below 0.35; a self-reported-tests selector is predicted to land near 0.35,
   because nearly every attempt reports its own tests passing. The oracle ceiling (any of k attempts
   passes; NOT an arm, reported only as the bound on what selection could achieve) is about
   1 - 0.65^7 = 0.95.
3. **Falsifiers.** Prediction 1 is wrong if arm K is significantly below arm C on either interpreter task
   (Fisher exact, Holm across the arm-K comparisons), which would mean fresh attempts are more correlated
   within a seed than the pooled distribution implies. Prediction 2 is wrong if an oracle-free selector
   lifts printf significantly above arm A.

## Reproducing the resampling

```python
import json,glob,os,collections,random
random.seed(1)
for task,k in (("stamp-interpreter",10),("stamp-2",8)):
    A=[]
    for d in sorted(glob.glob(f"bench/results/rq1-suite/{task}-A-seed*")):
        r=json.load(open(d+"/result.json")); p=d+"/workspace/answer.txt"
        A.append((r["passed"]," ".join(open(p).read().split()) if os.path.exists(p) else None))
    wins=0;N=200000
    for _ in range(N):
        cc=collections.Counter(random.choice(A)[1] for _ in range(k)); top=max(cc.values())
        pick=random.choice([a for a,n in cc.items() if n==top])
        wins+=next(ok for ok,a in A if a==pick)
    print(task,k,wins/N)
```
