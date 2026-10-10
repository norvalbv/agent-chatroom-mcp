# Proposed decision: registered-tool-count-is-static-callsites

From swarm-001503-htoq (concluded); report: swarms/swarm-001503-htoq/report.md. A human promotes this into docs/decisions/ with `guard-decisions add`; nothing is adopted automatically.

DECISION RECORD (ready for `guard-decisions add registered-tool-count-is-static-callsites --target src/server.ts`)

- **slug:** `registered-tool-count-is-static-callsites`
- **context:** A read-only question asked for the tool count and the recruit-only subset. The risk was a number agreed by three seats but not reproducible, or a loose "recruiting enabled" that hides the two-condition guard. v1 of the proposal had that looseness and cost one amendment.
- **ruling:** The count is the number of `server.registerTool(` call sites in `src/server.ts` at a named commit: 20 total, 3 inside the guard at line 710. The answer is defined by the two commands above, and "recruiting enabled" means a spawner was passed and `CHATROOM_NO_RECRUIT` is not `"1"`.
- **consequences:** Anyone can re-derive the numbers with one grep and one awk. Docs or prompts quoting a tool count can be checked against the commit.
- **tradeoff:** A static count says nothing about what a given connection sees at runtime; the four decision tools can be disabled per connection. The awk depends on the guard's exact text and its two-space closing brace.
- **researched:** `src/server.ts`, `src/index.ts`, `src/spawner.ts`, `src/spawner/recruitment.ts` and `src/env.ts` at `32e7c67d`. No external sources were read, so there are no NEW sources relative to the SETTLED AXES list.
- **rejected:**
  - Runtime `tools/list` against a live hub: loses on cost for a read-only question, and the answer varies by connection scope.
  - Counting by reading without a command: loses on reproducibility.
  - Counting tool-name strings: loses on robustness, since names also appear in descriptions.
- **revisit-when:** `grep -c 'server.registerTool(' src/server.ts` no longer prints 20, the awk no longer prints 3, or tools are registered outside `src/server.ts` or via a loop or helper.
- **RE-TARGET:** none. No settled axis is changed. The hub's fresh-challenger step ran as designed under `consensus-requires-scrutiny`.
