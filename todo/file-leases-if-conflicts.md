---
status: idea
added: 2026-09-23
from: docs/reuse-survey-2026-09-23.md (File-level leases and a commit guard)
after: pool-2-game
---
# File-level leases, only if room runs lose items to merge conflicts

claim/* is area-level. Pool 1 gives no case for file leases: the only items lost to conflicts were
in split (no hub); room3 and room15 landed 20/20. Revisit if pool 2 or 3 room runs record merge
conflicts in final.json.

If needed: optional paths on claims with a TTL and a commit guard, written from Concord MCP (MIT)
or from MCP Agent Mail's docs (its licence rider rules out copying its code). A hard commit
refusal needs the same leave-and-release path claims have, or a quiet claimant deadlocks a room.
