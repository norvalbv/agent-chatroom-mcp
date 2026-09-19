# What the next small experiment can distinguish

Research and prospective planning, 2026-09-19, swarm-174126-0s5m.
No new model runs, no change to the historical grids, and no claim of task success.

## Evidence and scope

New source fetched: Evan Miller, *Adding Error Bars to Evals: A Statistical Approach to
Language Model Evaluations*, arXiv:2411.00640,
<https://arxiv.org/html/2411.00640v1>. Sections 2, 3 and 5 distinguish uncertainty from
sampling questions from uncertainty from repeatedly sampling answers, discuss clustered
questions, and recommend prospective power analysis. Section 4 explains why pairing helps
when scores share question-level difficulty. This supports planning the statistical unit
before spending; it does not supply a task-specific effect estimate for this project.

Local implications below are our deductions, not findings of that paper. Repeated runs of
the same program can estimate its stochastic success probability more precisely, but do
not create new independent task families. The current harness's seed is a naming/pairing
key, not a controlled random draw (paper/amendments.md). Merely giving independent runs
equal seed labels does not create the paired-question covariance that buys precision.

Ratified by reference: swarm-122749-7x9q/report.md already says a perfect 40/40 arm needs
the other arm to fall to 34/40 for unadjusted Fisher significance, and forbids treating
nonsignificance as a match. swarm-164742-5jvl/report.md independently refuses equivalence,
causal claims about the chatroom's mechanism, and conclusions from a partial window
control. These reports are available in the parent checkout's swarms/ directory.

Settled axes retained: `measure-task-success-on-a-machine-oracle`,
`done-means-independently-verified`, and `token-cost-is-resent-context`. No RE-TARGET.

## Planning calculation

The amendment reporting the new model regime quotes arm-C costs of $1.50–2.21 per run.
If K is cost-matched to C, all $60 is available, and these costs persist, only
floor(60 / (2 * C_cost)) = 13–20 runs **per arm** fit. Pilot, A controls, failed runs and
reserve reduce this number. This range is an assumption for planning, not a measured
forecast or a hard enforcement cap.

For independent Bernoulli runs with fixed probabilities, exact prospective power is

    sum over a,b: BinomialPMF(a; n,p) * BinomialPMF(b; n,q)
                 * I(FisherTwoSided(a,n-a,b,n-b) < 0.05).

The table enumerates all outcomes using the repository's existing Fisher implementation;
no simulation or historical model output is involved. Values are probabilities rounded to
four decimals. This is the unadjusted single-comparison test, so it must not be presented
as power after a multi-comparison correction. Unknown correlation or regime changes
invalidate these assumptions.

| Runs per arm | p=.9, q=1 | p=.8, q=1 | p=.7, q=.9 | p=.5, q=.8 |
|---|---:|---:|---:|---:|
| 8 | .0004 | .0104 | .0295 | .1204 |
| 12 | .0043 | .0726 | .0950 | .2102 |
| 20 | .0432 | .3704 | .2417 | .4095 |
| 40 | .2063 | .8387 | .5340 | .7494 |

At n=12, even a genuinely perfect arm against an 80%-successful arm produces a significant
result only about 7.26% of the time. If one observed arm is perfect, the other must lose at
least five runs at n=8, 12 or 20 before unadjusted two-sided Fisher p<.05. For n=12 this
means 12/12 versus 7/12 (p=.037267), not 12/12 versus 10/12. At n=40 the first rejection is
40/40 versus 34/40 (p=.025547), reproducing the earlier room's warning.

## Recommendation and falsifier before further spend

Prefer a validated new-family pilot plus measurement provenance to spending the entire
budget on a small repeat of the existing comparison. A feasible pilot can test whether an
oracle-clean candidate has an intermediate single-agent rate and acceptable observed cost;
it cannot establish external validity by itself. Keep its exact admission rule and stopping
rule fixed before sampling, retain rejected candidates, and freeze a fresh confirmatory
sample independently of admission. A candidate's admission failure is informative evidence,
not a reason to tune the brief until the same seeds pass the rule.

If the room instead runs the reduced window control, its claim should be a same-window
replication/feasibility result with uncertainty and realized spend, not proof that the
historical time confound is removed or that C and K are equivalent. The prospective
alternative p_C=1, p_K=.8 is a useful concrete planning case: n=12 has power .0726, so a
nonsignificant outcome does not falsify a twenty-point advantage. A final result needs an
explicit inconclusive category.

For any future claim of practical equivalence, choose an acceptable effect margin and
an interval-based decision criterion before observing outcomes, then size the design for
that criterion. No equivalence margin is adopted here. Per-mechanic changes remain RQ3;
the no-chat builder/reviewer baseline is RQ2. Neither should compare newly sampled arms to
historical C without a contemporary C control.

## Regime indicators must respect the treatment

Output tokens can reveal an abrupt shift across otherwise comparable launches of the
same task and role. They cannot, by themselves, classify different experimental arms
as different provider regimes. B and C intentionally change roles, communication and
turn counts; a larger C token total may be an effect of the intervention being measured.
Excluding runs because of that difference risks conditioning the comparison on a
treatment-induced variable.

Record per-seat token traces, role, timestamps, requested and reported model identifiers,
and explicit reasoning metadata when available. Use known boundary evidence and
within-role comparisons; label ambiguous regime membership unknown. A pre-registered,
interleaved identical-task A sentinel could provide a more comparable signal if budget
allows. Matching identifiers, close timestamps, or stable aggregate output alone do not
prove invariant provider behavior. No sentinel or automatic regime classifier was built
or measured in this room.

## Reproduce the prospective calculation

Run from the repository root. The snippet reads only the existing pure statistics module,
asserts probability normalization and reproduces the prior room's threshold.

```sh
node --import tsx --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { fisherExactTest } from './scripts/rq1-stats.ts';
function binomial(n,p) {
  const out=[];
  for(let k=0;k<=n;k++) {
    let v=1;
    for(let i=1;i<=k;i++) v*=(n-i+1)/i;
    out.push(v*p**k*(1-p)**(n-k));
  }
  assert.ok(Math.abs(out.reduce((a,b)=>a+b,0)-1)<1e-10);
  return out;
}
assert.ok(fisherExactTest(40,0,35,5).p_value>=.05);
assert.ok(fisherExactTest(40,0,34,6).p_value<.05);
for(const n of [8,12,20,40]) {
  const reject=Array.from({length:n+1},(_,a)=>
    Array.from({length:n+1},(_,b)=>
      fisherExactTest(a,n-a,b,n-b).p_value<.05));
  const row={n};
  for(const [p,q] of [[.9,1],[.8,1],[.7,.9],[.5,.8]]) {
    const x=binomial(n,p),y=binomial(n,q);
    let power=0;
    for(let a=0;a<=n;a++) for(let b=0;b<=n;b++)
      if(reject[a][b]) power+=x[a]*y[b];
    row[`${p},${q}`]=Number(power.toFixed(4));
  }
  console.log(JSON.stringify(row));
}
JS
```
