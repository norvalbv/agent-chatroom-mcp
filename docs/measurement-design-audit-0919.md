# Measurement design audit for the open round

2026-09-19; `swarm-174126-0s5m`, seat `6-astra-17`; read-only audit of base `f2a8d5a`.
No paid model runs or runtime changes belong to this contribution.

## Existing evidence and new source

Ratify the conclusion of `swarm-164742-5jvl` by reference: its paper explicitly does
not establish K/C equivalence, explain the within-regime single-agent gap, or report
RQ2/RQ3 as run. Ratify `swarm-122749-7x9q`'s separation of oracle-free selection,
realized cost matching, and unknown usage. Those are controls to retain, not forks to
reopen. The governing axes remain `measure-task-success-on-a-machine-oracle`,
`done-means-independently-verified`, and `token-cost-is-resent-context`.

NEW source fetched directly on 2026-09-19: Chen, Zaharia and Zou,
[How Is ChatGPT's Behavior Changing over Time?](https://arxiv.org/html/2307.09009v3),
arXiv:2307.09009, version 3. Its comparisons of service snapshots found changes in
task behavior and instruction/format adherence. It motivates monitoring behavior,
not just model labels. It does not identify the cause of this project's Sonnet
change and does not demonstrate that unchanged token totals imply unchanged accuracy.

## Findings relevant to the next experiment

1. **Time blocking is useful but is not randomization.**
   `scripts/bench-grid.ts`'s `buildPlan()` explicitly orders C, A, K within each seed.
   A and K need a prior C cost record. Running all arms in one window narrows a
   confound; calling that sequence randomized would be false. A new design that
   randomizes order needs separately calibrated, frozen budgets and an explicit
   protocol change. Preserve the historical arm definitions when reproducing them.

2. **Output tokens detect some changes; their stability does not prove absence.**
   The statement in `paper/sections/threats.tex` that pass-rate numbers are
   "therefore not put in question by the shift" is too strong if justified only
   by stable output-token totals. The artifact evidence rules out the observed
   large token expansion in those runs; it does not rule out all behavioral drift.
   Keep the cross-window K/C inference qualified. This is an inference correction,
   not a claim that any historical result is known to be invalid.

3. **Admission and confirmation are separate uses of observations.**
   Freeze task semantics and selector before fresh comparison runs. An admission
   pilot estimates feasibility and difficulty; reusing its favorable observations
   as the confirmatory baseline conditions the result on selection. Screening a
   different provider/model can cheaply guide exploration but does not establish
   the admission rate for the eventual confirmatory model. Report rejected
   candidates and tuning rounds rather than retaining only the winning task.

4. **An additional task is not necessarily an additional mechanism family.**
   A longer program under the same scope-capture trap improves within-family
   replication. It does not by itself broaden the paper beyond that failure
   mechanism. A new family needs a distinct reason for failure and an independently
   validated oracle, not just a new filename or longer input.

5. **Equal caps do not imply equal spend.**
   Keep complete usage and realized mean cost comparison. Retain costs and outcome
   categories for terminated or unsuccessful runs. Predeclare how incomplete
   usage and blocks interrupted by budget exhaustion affect analysis; do not drop
   inconvenient observations after seeing scores. A cost-matching failure limits
   the claim even when the higher-spending arm passes more often.

## Recommendation and falsifier, stated before this seat builds anything

Choose a bounded feasibility/admission pilot or a large-effect discovery run, with
its task, model configuration, selector, budget allocation, stop rule and analysis
fixed before spend. Report a small close K/C result as unresolved, not equivalent.
This recommendation is defeated if the selected room design already closes these
threats and has adequate power for its stated claim; evaluate that design directly.

No new hub mechanic follows from this audit. Retain the existing oracle method and
record the chosen experiment as a prospective protocol. The rejected alternatives
are silently calling deterministic ordering randomized, pooling across providers
or detected regimes, and treating more seeds as more task families.

Prior-art: skipped — this contribution audits inference and introduces no machinery,
boundary, or dependency. Its local findings and the new primary source are recorded
above. The room's independent power audit is separate; this note claims no new power
calculation or empirical model outcome.
