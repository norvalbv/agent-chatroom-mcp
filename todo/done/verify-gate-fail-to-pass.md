---
status: done
added: 2026-09-23
from: docs/reuse-survey-2026-09-23.md (Verify gate); SWE-bench FAIL_TO_PASS / PASS_TO_PASS (Jimenez et al. 2023)
done: 2026-09-24 1ebc3423 via reuse/review-quality; decision record awaits promotion (deploy-merged-reuse-fixes)
---
# Verify gate stage 1: a check must fail before the change and pass after

Keep the gate (non-author, exact proposal id, newer than the text, assigned reviewer, executable
challenges). Stage 1 adds SWE-bench's fail-to-pass shape to the verify head: the reviewer records
the check failing at the parent commit and passing at the proposal's commit. Rewrite
VERIFY_HEAD_EXAMPLE and verifyHeadRefusal; update scripts/verify-verdict-regression.ts and the
reviewer-assignment regression.

Stage 1 is still self-reported: it makes a false head costlier, it cannot prove one. Refactors
(no behaviour change) need an exemption, which becomes the new loophole. Stage 2 (the hub or a
trusted runner executes the check) is a separate decision.
