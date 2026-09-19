# Proposed experiment: recoverable command-result context

Research-only conclusion of `swarm-174126-0s5m-context-cost-audit`,
`prop_58e6b87e` v2, independently challenged and verified, two agreeing seats.
No implementation or paid experiment was performed. This is a future experiment,
not evidence that offloading improves this system.

## Evidence

New source fetched by the breakout: *Recursive Language Models*,
arXiv:2512.24601v3, <https://arxiv.org/html/2512.24601v3>, sections 2–4 and 7.
The paper evaluates externally held input with selective access; a depth-zero
ablation helps separate access to external input from recursive subcalls. This
does not establish that offloading a live agent's entire conversation preserves
its semantics. Recursive overhead and expensive outliers also prevent importing
a cost-saving claim into this project's workload.

The breakout independently checked these paths at the room's base:

- `src/seat.ts:153` collects shell output and clamps the returned result; the
  default returned-output limit is 6000 characters (`src/seat.ts:320`).
- `src/seat.ts:637` adds the returned text to active model history.
- `src/seat.ts:478` removes older turns; checkpoint mode inserts a deletion
  marker rather than making the removed bytes retrievable.
- `src/seat.ts:405` writes generic claim pointers at handoff;
  `src/seat.ts:543` exits before trimming when handoff thresholds fire.
- Claude launch paths in `src/swarm.ts:141` and `src/spawner.ts:308` use
  `claudeArgs` separately. A change to the seat loop does not establish a result
  about Claude's managed conversation history.

## Decision proposed, with falsifier

Keep checkpoint trimming off. First test immutable command-result handles at
initial ingestion, where treatment can be isolated from rewriting past history
and invalidating cached prefixes. This applies `token-cost-is-resent-context`,
`r1-proactive-handoff`, and `measure-task-success-on-a-machine-oracle` without a
RE-TARGET. It does not authorize changing an existing default.

Both experiment arms receive the same captured **post-clamp** bytes, preview,
metadata, and exact range-read tool. The inline arm also receives the body on
the first tool return; the handle arm receives a stable handle, status, hash,
size and the same preview at that point. Neither arm rewrites previously sent
history. If full raw output is tested instead, expose those same bytes to both
arms in a separate comparison: granting only the treatment extra information
would confound the result.

Keep model, brief, tool schemas, coordination history, budgets and lifecycle
settings equal; do not add recursive subcalls. Identity, instructions,
corrections, coordination messages and tool-call linkage remain inline.
Baseline cases must fit context, and handoff must not terminate either arm
before the intervention is exercised.

Use hidden machine-oracle cases involving delayed rare facts, conflicting
later outputs and dense reuse. Require references to the original immutable
result; rerunning a command is not equivalent to recovering its earlier output.
Report all prompt/cache/output tokens, billed cost with coverage, retrievals,
retries, failures and latency, including retrieval overhead.

A baseline-success/treatment-failure observation refutes a universal
preservation claim on that fixture; stochastic draws require repeated
measurement before attributing an average difference to the intervention.
No reduction in measured end-to-end cost rejects a savings claim for the
tested workload. Before any paid run, select a quality margin, cost target,
sample size and stopping rule. No margin or quality guarantee is established
by this memo.

## Alternatives and limits

Enabling checkpoint trimming loses because deletion does not test recoverable
storage. Replacing already-sent history loses because it also changes cache
prefixes and eviction behavior. A full recursive framework changes model-call
count and reasoning strategy at once. Plain byte retention is a storage
property; successful model retrieval and preserved whole-conversation behavior
are separate claims, each requiring evidence.

The experiment was not built in this room: the parent is first closing launch
provenance and the missing builder–reviewer baseline. This design leaves a
bounded next test for context-cost work, with no transfer of accuracy or cost
claims from the cited paper.

Breakout evidence: `findings/context-audit-4`, `findings/context-audit-5`,
`experiment/context-output-offload`, and `verify/local-context-offload`.
