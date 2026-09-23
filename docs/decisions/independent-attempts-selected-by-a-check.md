---
slug: independent-attempts-selected-by-a-check
created: 2026-09-23
---

# independent-attempts-selected-by-a-check

## Target · 2026-09-23 — With a discriminating check, run N isolated attempts and let the check pick; with none, run one agent

**Context:** Stored arm-K attempts from Study 1 (bench/results/rq1-arm-k, 40 groups per task) scored against the hidden oracle, as unbiased pass@k (swarm-232020-hdju evidence/oracle-at-k, scripts/oracle-at-k.py): on printf a single attempt passes 0.311 (oracle@1 12.4/40, no better than one agent's 14/40, so the whole gain is selection), agreement selection over k=7 gives 7/40, and a check choosing among 3 attempts would pass about 26.5/40 (37.0 at 7). Against that, one agent scored 14/40 and a 3-seat room 6/40. On the interpreter tasks, @3 ≈ the room (38.3 vs 40/40). Discussion and agreement both converge on the modal answer, and only a check separates a correct minority (settle-disputes-by-spec-not-count). The swarm-232020-hdju build (0079450) showed the check to the attempts. Its verifier objected that an attempt could then iterate against the judge or edit it, and the room stalled unmerged.
**Ruling:** src/attempts.ts is a hub-free path: `npx tsx src/attempts.ts "<task>" --check "<cmd>" --protect <paths> [--n 3]`. Each attempt runs in its own git worktree with a lean claude seat. The check command is never in the attempt prompt. --protect paths are removed from each attempt's tree before it starts and restored from base before the check runs. Anything an attempt wrote there is discarded and reported as `tampered`, and the restore is committed so merging the winner cannot bring in test edits. The winner is the lowest-index attempt whose check passed. When none passed it reports null and never guesses. Default n=3, because K's full k cost more than the room.
**Consequences:**
- Positive: The one team shape the data supports can be run without a room, a hub or chat, at about 3 × $0.06-0.10 per run.
- Negative: 26.5/40 is an oracle ceiling computed from stored attempts with the benchmark's HIDDEN test. It is not a live run of attempts.ts. It holds only when the user supplies a check as discriminating as that test (paper results.tex:43). Without such a check the path does nothing better than one agent, and it does not replace rooms for research or review.
**Vision-fit:** n/a — internal tooling
**Researched:** No new literature. Own data: swarm-232020-hdju evidence/oracle-at-k and verify-notes/evidence-recompute; paper Study 1 arms A/C/K.
**Rejected:** (a) showing the check to attempts, as in 0079450. That lets an attempt fit the judge. (b) selection by agreement (arm K) or by a room vote (arm C), which measured 7/40 and 6/40 on printf.
**Revisit-when:** a live run of attempts.ts on the machine-oracle tasks (measure-task-success-on-a-machine-oracle) against arm A lands outside the stored-attempt pass@3 estimate by more than its sampling band
**Scope:** src/attempts.ts,scripts/attempts.test.ts,scripts/oracle-at-k.py,scripts/offline-runner.mjs
**Source:** manual
**Evidence-change:** Live plumbing smoke (swarm-092653-202z evidence/attempts-hidden-check-smoke): haiku, n=2, $0.036, a toy add.js task with --protect tests/. Both attempts passed, the attempt tree never contained tests/, and the check text was not in the prompt. This shows the plumbing works, not an accuracy gain.
