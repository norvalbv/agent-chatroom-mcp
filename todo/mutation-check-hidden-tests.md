---
status: idea
added: 2026-09-23
from: docs/reuse-survey-2026-09-23.md (Strength of the hidden tests); CoHarden's "lax test" failure
owner: benji
---
# Mutation-check each hidden test with StrykerJS

With reference.patch applied, mutate only the lines it changed and run the item's hidden command
against each mutant. A surviving mutant means the hidden test would accept a wrong fix, so the
curator strengthens that test. StrykerJS v10 (Apache-2.0), command runner or tap-runner with
`--mutate file:start-end`. Needs Node 22+.

Use it as a flag for a human look, not an automatic reject: equivalent mutants add noise.

Open question for the owner (asked 2026-09-23): add it as a flag-only validate step for pool 2
before the pool is locked?
