---
status: open
added: 2026-09-24
from: offline suite run for 2c779460 (1 of 148 commands failed; passed 3 of 3 alone)
---
# pool-run.test.ts "each run gets its own repository" is flaky

The assertion that run 1's seat commit is absent from run 2's repository failed once under load
and passed 3 of 3 alone. Likely cause: the fake seat's solution commit is deterministic (same
content, and the isolated base commit uses fixed author and committer dates), so two runs whose
fake commits land in the same second produce the same hash, and the object "exists" in both.

Fix: make the fake seat's commit differ per run (for example the run name in its message), then
keep the assertion. Done when the test passes 20 of 20 back to back.
