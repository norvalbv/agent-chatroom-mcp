# Proposed decision: final-certification-must-match-scope

From swarm-190103-v18i (concluded); report: swarms/swarm-190103-v18i/report.md. A human promotes this into docs/decisions/ with `guard-decisions add`; nothing is adopted automatically.

DECISION RECORD
- **Slug:** `final-certification-must-match-scope`
- **Target:** Final-result acceptance and verification metadata.
- **Context:** v17 concluded without the designated verifier’s endorsement; partial branch checks accompanied a still-stale overall inventory.
- **Ruling:** Proposed follow-up: distinguish branch verification, integrated verification, and whole-report certification. Where designated-verifier approval is promised, enforce it explicitly rather than assuming quorum supplies it.
- **Consequences:** Protects accurate completion claims without discarding useful branch-tested work.
- **Tradeoff:** Additional acceptance bookkeeping and potentially longer closure.
- **Researched:** Repository, room transcript and verification records; abstracts arXiv:2608.30373, 2609.03619, 2609.00683 (**NEW** relative to the supplied list). These motivate experiments, not quorum changes.
- **Rejected:** Treating commit existence or one item’s passing tests as whole-report verification; treating separate branch passes as integration evidence.
- **Revisit-when:** An acceptance regression proves the promised verifier cannot be bypassed, and one assembled commit passes independent integration checks.
- **Existing axes:** Applies `done-means-independently-verified`; no adopted RE-TARGET claimed.
