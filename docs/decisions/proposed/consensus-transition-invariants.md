# Proposed decision: consensus-transition-invariants

From swarm-174517-khlq (concluded); report: swarms/swarm-174517-khlq/report.md. A human promotes this into docs/decisions/ with `guard-decisions add`; nothing is adopted automatically.

DECISION RECORD

- **Slug:** `consensus-transition-invariants`
- **Context:** Independent reproductions exposed discrepancies between session identity, proposal electorate, live transitions, replay, and reported blockers. These permit insufficient scrutiny or unnecessary deadlock.
- **Ruling:** Enforce session-independent challenges; persist amendment freshness and challenge concessions; share electorate and decision calculations across acceptance and diagnostics; validate blocking challenge citations; make chair admission consistent. The adopted proposal additionally recommends preserving cleared dissent, but my end-to-end verification remains incomplete.
- **Consequences:** Protects independent scrutiny, verification freshness, meaningful quorum, and actionable coordination.
- **Tradeoff:** Additional event-schema handling and regression tests; conservative recovery may require fresh verification after incomplete logs. Estimates of hours to two days per item are planning estimates, not measured implementation costs.
- **Researched:** NEW source actually fetched: https://arxiv.org/abs/2609.11109 — abstract supports investigating disagreement provenance, not changing quorum. Local sources included `src/hub.ts`, `src/seat.ts`, decision records, prior swarm reports, and the room’s reproduction records.
- **Rejected:** Relaxing settled quote-carry or challenge rules without new evidence; the refuted departed-voter deadlock; claiming consensus equals verification; treating these recommendations as implemented fixes.
- **Revisit-when:** A separate verifier reads the exact adopted v2 document, checks dissent provenance, and later runs regression tests against an implementation.
- **Existing axes:** Ratifies `identity-is-the-connection`, `consensus-requires-scrutiny`, `done-means-independently-verified`, and `hub-carries-what-it-knows`; no policy RE-TARGET established.
