# Arm B as the next causal baseline

This note records research for `swarm-174126-0s5m-room`; it is not a result and does not amend the
paper's pre-registration.

## External evidence

- Zhang et al., *If Multi-Agent Debate is the Answer, What is the Question?*
  (arXiv:2502.08788) compare five debate methods across nine benchmarks and four foundation models.
  Their main finding is that debate often does not beat simple single-agent Chain-of-Thought or
  self-consistency baselines despite using more inference compute. This supports testing the chatroom
  against the strongest cheap non-chat alternative before attributing a gain to deliberation. Their
  heterogeneity result is a separate design factor; it does not establish that this homogeneous room's
  mechanics help.
- Xu et al., *Towards a Science of Collective AI: LLM-based Multi-Agent Systems Need a Transition
  from Blind Trial-and-Error to Rigorous Science* (arXiv:2602.05289) argue that collaboration gain must
  be measured against a task-dependent, resource-equivalent non-collaborative baseline. For a single
  cohesive output, their proposed baseline gives one agent an equivalent total budget for deeper
  reflection; for coverage tasks it uses independent sampling under the same budget. This ratifies the
  project's arm-K comparison and implies that arm B answers a different question: whether a fixed
  builder-to-reviewer handoff captures any benefit otherwise attributed to interactive coordination.

These sources motivate the comparison; they do not predict its outcome on this repository's two task
families.

## Local contract and implementation gap

`paper/protocol.md` section 2.1 pre-registers arm B as two model instances in a fixed pipeline: the
builder produces a patch or answer; the reviewer receives only the brief and builder output, and may
approve or request at most one revision. Neither instance has chatroom tools. The falsifier is already
fixed in section 1: arm C costs more than three times arm B per correct answer without an offsetting
success gain.

That condition is not runnable at HEAD `f2a8d5a`: `scripts/bench-rq1.ts` accepts only arms A and C, and
`scripts/bench-grid.ts` accepts only A, C and K. The older `scripts/bench-bench.ts` labels two hub builds
"A" and "B", but those are build-comparison sides, not the protocol's builder/reviewer arm. Treating
that script as RQ2 evidence would be a category error.

## Recommended next action and falsifier

Implement the pre-registered arm-B pipeline in the existing oracle harness, test-first, before any
seven-way RQ3 ablation grid. Preserve the existing hidden-fixture boundary, task/scorer hashes, outcome
vocabulary, killed-seat accounting, and complete-or-unknown cost semantics. The reviewer input must be a
frozen builder artifact plus the public brief; it must not receive oracle data, arm-C transcripts, or a
shared workspace history that turns the condition into chat by another name.

First run an offline stub proving approve and one-revision paths, oracle isolation, summed usage, timeout
handling and resume behavior. Then run only a small real-model feasibility pilot after the currently
active window-control finishes and the room confirms remaining budget. Stop rather than claim RQ2 if
the arm cannot preserve oracle isolation, if its provenance differs from arm C, or if it is not actually
cheaper. A pilot on the admitted suite remains evidence about two single-trap families, not about
multi-agent deliberation in general.

## Alternatives not chosen first

- Finish the same-window C/K control: useful for regime feasibility, but at 12 runs per arm it has very
  low power to distinguish C near 1.0 from K near 0.9 and cannot identify a coordination mechanism.
- Run one RQ3 ablation: cheaper to describe, but causal attribution to one hub mechanic remains weak on
  a two-family suite and creates a multiple-comparison path before the strongest simple baseline exists.
- Author more task families first: necessary for external validity, but previous rooms screened about 45
  designs to admit only two families; it is a larger program than adding the already specified baseline.

No API-priced experiment was launched for this note.
