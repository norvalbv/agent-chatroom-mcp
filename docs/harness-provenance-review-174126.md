# Harness provenance audit, 2026-09-19

Findings against `f2a8d5a`, room `swarm-174126-0s5m-room`, seat `6-astra-20`.
The resulting additive repair is described below; historical outcomes are unchanged.

## Decision context

`measure-task-success-on-a-machine-oracle` already calls for identifying the build
actually served. `done-means-independently-verified` requires independent execution
and review. Neither axis needs re-targeting. The completed paper room
`swarm-164742-5jvl/report.md` is ratified on its limited claim: the historical C/K
comparison is nonsignificant, not an equivalence result; the window control was
pending when that report was written. The arm-K room
`swarm-122749-7x9q/report.md` also correctly distinguishes the exact build piloted
from subsequent integration changes and tests of failure paths.

## New research

[AI Agents That Matter](https://arxiv.org/html/2407.01502v1), Kapoor et al.,
arXiv:2407.01502, fetched on 2026-09-19 (abstract and full HTML). Sections 2, 5,
and 6 support evaluating cost together with accuracy, selecting holdouts to match
the claimed generality, and standardizing evaluations to permit reproduction.
Appendix E describes model and task-subset discrepancies in reproduced agent
evaluations. This supports recording the actual execution conditions. It does not
prescribe the particular hash fields below or demonstrate a defect in this project.

## Local findings

In `scripts/bench-rq1.ts`:

- `result.model` stores the requested `--model` value. `runClaudeSeat` consumes
  assistant usage and the terminal result but discards initialization model
  identifiers and terminal `modelUsage` keys. A requested alias is consequently
  not evidence of the model identifier the CLI reported serving.
- `build.hub_entry_sha256` is captured after readiness. There is no whole-build
  hash. Editing an imported `dist/hub.js` leaves `dist/index.js` unchanged, so an
  identical entry hash does not imply identical hub behavior.
- `build.head_revision` is read while constructing the result after execution.
  This is not a launch-time revision record if the checkout changes during a run.
- The accepted arms are A and C. The B in `bench-bench.ts` denotes another hub
  build, not the builder–reviewer pipeline in `paper/protocol.md`.

`scripts/bench-bench.ts` already records a whole-dist hash and a provenance scope
that explicitly excludes dependencies. Reuse that contract rather than inventing
an incompatible meaning for the same field in the RQ1 runner.

## Falsifier before any implementation

An offline executable stub should report a served model different from the
requested alias. The result must retain both values and identify their sources.
A stub hub build should then change an imported sibling while leaving its entry
unchanged: the entry hash must stay equal and the whole-build hash must differ.
Finally, changing a temporary checkout's HEAD after launch must not replace the
launch revision recorded in the result. Missing provider metadata must remain
explicitly unknown, never be filled with the requested alias.

These checks falsify a provenance fix independently of task success; they do not
measure a deliberation advantage. Provider identifiers themselves cannot prove
unchanged hidden weights, reasoning allocation, or routing, so even complete
metadata does not license pooling across suspected regime changes.

## Recommendation and alternatives

Before future paid comparisons, close these runner-specific gaps with additive
metadata and offline stub tests, then independently review the diff. Preserve
historical artifacts; do not retrofit unknowable launch facts. Keep requested
model, reported served identifiers, launch revision, and build hash distinct.
Report exactly what is hashed, including exclusions for dependencies and provider
internals. Record output tokens as a regime indicator, not a behavioral identity.

Adding further hub mechanics loses priority because these metadata changes are
useful whichever experimental arm is selected. Retrospectively hashing today's
checkout loses on truth: it cannot attest the build already executed. A broad
provider abstraction is unnecessary for this narrow closure and would change more
experimental conditions at once.

## Implementation and validation

The runner now preserves the requested alias in `model` and records per-seat
`reported_models` grouped by `system_init`, `assistant`, and `result_model_usage`.
Absent observations produce `null`. The terminal `modelUsage` object is retained
as `model_usage`, including `thinkingTokens` or `canonicalModel` when the CLI
supplies them; no alias or inferred reasoning count replaces an absent field.
Model observations survive usage-free assistant events and a deadline kill.

`build` now captures harness HEAD, runner SHA-256, selected hub HEAD, entry hash,
and dist-tree hash before children start. A non-dist entry explicitly has
entry-only scope; arm A's hub fields are null. Build-hashing errors produce the
existing infrastructure-error artifact. These are launch snapshots; changes
after launch, external dependencies, the CLI executable, and provider internals
are outside their attestation scope.

`scripts/bench-rq1.test.ts`, already registered in `scripts/offline-runner.mjs`,
uses executable stubs and temporary Git repositories. Before implementation the
first run had 4 intended failures among 14 tests. Adding timeout and hash-failure
coverage produced 6 intended failures among 15 tests. The first implementation
passed all 15. A further assertion for raw per-model usage failed before that
field was added. No paid model experiment or empirical accuracy claim is made
by this repair.
