---
status: open
added: 2026-09-23
from: docs/reuse-survey-2026-09-23.md (Scoring); SWE-bench PASS_TO_PASS
---
# Report which existing tests broke, next to the pre-registered suite check

Keep the pre-registered measure (suite_cmd exits 0 at the final head). Add a secondary view: run
suite_cmd at base_commit once per pool during validate and record per-command results; at score
time list commands that passed at base and now fail, and any that disappeared.

This was not pre-registered, so it must be labelled as secondary everywhere it appears.
