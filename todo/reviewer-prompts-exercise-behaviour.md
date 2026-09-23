---
status: open
added: 2026-09-23
from: docs/reuse-survey-2026-09-23.md (Reviewer and verifier prompts); the peer-review audit in the paper
---
# Reviewers exercise the change, not rerun the author's tests

The review audit found most review acts rerun the author's command, and no reviewer ran agents on
a changed hub build. Port two rules from the OpenHands qa-changes plugin (MIT) into
prompts/loop.md and prompts/recruit.md: "do not re-run the suite; exercise the changed behaviour
like a user", and its "Unable to Verify" section. Add an optional `kind` field
(existing_tests | own_check | exercised) to the verify head, matching the classes in
scripts/paper-verify-practice.ts.

Prompts alone left 48% of heads as reruns, so pair this with verify-gate-fail-to-pass.
Update both SKILL.md copies in the same commit.
