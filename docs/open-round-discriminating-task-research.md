# Discriminating task-family research (open round 174126)

This note asks a narrow question: what kind of task could distinguish interactive synthesis from budget-matched independent sampling without changing which task information the arms receive? It ratifies `measure-task-success-on-a-machine-oracle`; it does not re-open any settled hub mechanic.

## New primary sources

- **arXiv:2607.01661**, *Diverse Evidence, Better Forecasts: Multi-Agent Deliberation Under Information Asymmetry*. With identical evidence, the reported agents largely herd; the paper's gains come from deliberately partitioned public/private evidence, rationale exchange, and confidence-weighted aggregation. This is useful mechanism evidence, but it cannot be copied directly into the present benchmark: assigning private evidence only to chatroom seats would change the information available to arms A, C, and K, while the paper also bundles routing and aggregation changes.
- **arXiv:2605.06028**, *Multi-agent decision making: A Blackwell's informativeness approach*. The paper formalizes voting and debate as garblings of pooled private information, then evaluates a product-of-posteriors estimator on fixed-choice QA. It motivates measuring how much complementary evidence a protocol recovers; it does not show that this hub approximates the pooled-information bound, and its practical result does not cover code repair.
- **arXiv:2607.11250**, *Multi-Agent LLMs Fail to Explore Each Other*. Explicit exploration improves contextual- and capability-diverse agent systems, while prompting agents to explore often underperforms random peer selection. Its heterogeneous peer-selection setting is absent from the present three-seat homogeneous room, so it is a warning against assuming that merely exposing peers' work produces useful synthesis.
- **arXiv:2604.16529**, *Scaling Test-Time Compute for Agentic Coding*. Independent coding rollouts are converted into structured summaries and reused by fresh refinement rollouts before oracle-free selection. The authors report tasks solved after every initial rollout failed, so a protocol can synthesize partial progress without live dialogue. Its main experiments use much larger rollout populations and different benchmarks, so it supplies a missing control, not this project's effect size.

## Frame correction and fair next comparison

Prior-art: **DISSOLVE_FRAME · followed**. A chatroom win over arm K's unchanged-candidate selection would identify reuse/refinement, not live interaction. The stronger equal-budget control is independent attempts → structured summaries → fresh noninteractive refinement → oracle-free selection. The existing preregistered arm B (builder then reviewer, at most one revision) is a useful minimum sequential baseline, but one builder/reviewer path does not test synthesis across several independent partial attempts.

There is also already a close local task analogue: `bench-doc-audit` plants eight independent documented discrepancies and scores all-or-nothing, but its A pilot passed 9/10 and therefore makes a weak discriminator. Authoring tasks until complementary misses appear would add task-selection and mechanism-targeting bias.

The recommended order is therefore:

1. finish the arm-B harness and provenance closure already selected by this room, labeling any tiny real run diagnostic;
2. preregister a future summary-refinement arm R on existing or naturally sourced multi-defect tasks, matched to arm C's realized spend and forbidden from seeing oracle outcomes;
3. compare A, unchanged-candidate K, noninteractive refinement R, and interactive C contemporaneously; and
4. attribute value to live interaction only if C beats R, not merely K.

Falsifier: if R matches or beats C at matched spend, the experiment detects no incremental value from live chatroom interaction over summary-mediated refinement; it cannot attribute a gain over K specifically to chatroom mechanics.

## If a new task family is still required

Do not partition facts, files, tools, or the brief by seat. Give every arm the same public workspace. A candidate family could be a multi-invariant code repair in which independent same-information attempts discover different partial fixes, but its generator, invariant groups, deterministic diff-composition rule, and admission rule must be frozen before even the A pilot. Otherwise choosing or reordering hunks with hidden component results creates an oracle-assisted upper bound rather than an attainable synthesis method.

Before any arm-C or arm-K run, an A-only admission pilot must falsify the design unless all of these hold:

1. the contemporaneous single-agent pass rate is in the fixed admission band;
2. the private oracle records at least two non-nested failure vectors, rather than one modal trap explaining the result;
3. the frozen deterministic composition of independently failing candidate diffs improves the number of invariant groups passed over each input candidate, without exposing component verdicts or selected composites to agents, prompts, public tests, or the selector; and
4. a non-author attack confirms that public tests, filenames, fixture layout, and selector probes do not reveal hidden cases.

After admission, freeze the task, scorer, selectors, brief, model identifier/provenance fields, and hashes before an interleaved C/K/R pilot. Report and preserve a null or negative pilot; do not tune, rescue, retire, or omit the family because C failed to beat a baseline. Generalize only to complementarity-screened families. A small pilot is diagnostic, not equivalence evidence; the power limits in `docs/open-round-power-inference.md` still apply.

This design tests whether conversation can synthesize independently discovered partial work. It deliberately does **not** test the easier and different proposition that a group with a union of private facts can beat one agent denied that union.
