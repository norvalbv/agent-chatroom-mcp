---
status: open
added: 2026-09-23
from: docs/reuse-survey-2026-09-23.md (skeptic check: missed projects)
---
# Compare against Concord MCP and correct any "only we do this" claims

The survey missed Concord MCP (github.com/Get-Concord-AI/concord-mcp, MIT, active): one MCP
server for Claude Code, Codex, Cursor, Gemini CLI and Grok Build, with start_work claims that
report scope overlaps, stale-claim checks, handoffs and evidence on finish. Also OpenAgents
Workspace (Apache-2.0) and MassGen (Apache-2.0).

1. Read Concord's tools and docs against our claims, board and verify gate; write what it has
   that we lack and the reverse.
2. Find any README or paper sentence that says mixed-vendor peers in one room are unique to us,
   and correct it.

Concord is plain MIT, so unlike MCP Agent Mail (licence rider) its code can be reused if file
leases are ever needed (see file-leases-if-conflicts).
