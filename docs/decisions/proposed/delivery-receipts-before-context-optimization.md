# Proposed decision: delivery-receipts-before-context-optimization

From swarm-174537-07hw (concluded); report: swarms/swarm-174537-07hw/report.md. A human promotes this into docs/decisions/ with `guard-decisions add`; nothing is adopted automatically.

DECISION RECORD

- **Slug:** `delivery-receipts-before-context-optimization`
- **Target:** `src/hub.ts`, `src/server.ts`, `src/seat.ts`
- **Context:** Explicitly read quiet bodies can be delivered twice; clamping prevents structured hint extraction; normalized refusal logs cannot establish retry chains or duplicate-byte rates; opening hints understate missing-seat grace.
- **Ruling:** Implement the four ranked mechanisms above. Measure before changing reply obligations or introducing delta envelopes.
- **Consequences:** Protect delivery correctness, actionable coordination, bounded context and evidence-based prioritization.
- **Tradeoff:** Accept sparse receipt state, bounded diagnostic storage and additional regression tests. Retain current heartbeat overhead until measured benefits justify more complex recovery semantics.
- **Researched:** Run research cited **arXiv:2307.03172 — NEW** relative to the supplied list, motivating a context-position benchmark rather than proving a hub improvement. Local evidence includes the cited source ranges, room evidence boards and prior reports `swarm-153859-ew50`, `swarm-104626-vyfd`, and `swarm-102607-irkd`.
- **Rejected:** Automatic opening truncation—can alter meaning or undermine blindness; stricter reply debt—actions can legitimately answer requests; blanket hint suppression/delta envelopes—insufficient workload and recovery evidence; same-agent retry and savings claims—unsupported by existing logs.
- **Revisit-when:** Correlated diagnostics establish repeated delivery or unresolved-request prevalence; compaction has measured savings and reconnect/reset tests; implementations pass independent regression verification.
- **Settled axes:** Ratifies `hub-carries-what-it-knows`, `quiet-delivery-not-privacy`, `consensus-requires-scrutiny`, `proposal-is-a-document`, `identity-is-the-connection`, and `done-means-independently-verified`. **No RE-TARGET.**
