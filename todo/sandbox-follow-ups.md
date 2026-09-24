---
status: open
added: 2026-09-24
from: reuse/sandbox review (non-blocking findings)
---
# Sandbox: follow-ups from review

- The gated live test is flaky: Claude Code's safety classifier interrupted the seat's `kill <pid>`
  call on one run (3 of 4 commands ran).
- Claude seats can write more than the README lists: ~/.claude/debug (read-only seat),
  ~/.npm/_logs and /tmp/claude (write seat). Name these sandbox defaults as the OpenRouter text does.
- The done-when containment test skips silently inside any sandbox and the offline runner prints
  OK without counting skips, so npm test from a sandboxed session never runs it. Count skips, or
  fail when the containment test skips outside CI.
- An srt seat with a long TMPDIR crashes at startup with a raw EADDRINUSE on its mux socket; make it
  say it is a sandbox failure, like the other refusals.
- A read-only claude seat in a linked worktree ran git update-ref on the shared .git (confounded:
  the fixture was under /tmp/claude-<uid>); recheck outside it.
