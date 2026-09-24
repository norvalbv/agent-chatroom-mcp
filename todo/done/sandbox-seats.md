---
status: done
added: 2026-09-23
from: docs/reuse-survey-2026-09-23.md (OS isolation for claude seats; for OpenRouter seats)
done: 2026-09-24 reuse/sandbox, opt-in --sandbox (default off; see sandbox-default-on)
---
# OS sandbox for seats, so a seat's pkill cannot reach the hub or other seats

Stdin prompts close the argv route. A seat's `pkill -f` or `killall` can still hit any process on
the machine by other names.

1. Claude seats: merge a sandbox block into the --settings JSON claude-args.ts builds (enabled,
   allowUnsandboxedCommands:false, failIfUnavailable:true, network allowlist for npm, GitHub and the
   hub port, allowLocalBinding for dev hubs; denyWrite on cwd for read-only seats).
2. OpenRouter seats: wrap sh() in src/seat.ts with @anthropic-ai/sandbox-runtime (Apache-2.0,
   beta). The LETHAL/MUTATING/GITCONFIG regexes stay as friendly refusals.

Probe first: does the sandbox apply under -p? Is it scoped per Bash call (then a seat cannot kill a
dev hub it started earlier)? Can a worktree commit still write the shared .git? Seatbelt blocks
writes through the node_modules symlink when only cwd is writable. macOS cannot nest Seatbelt
profiles, so never wrap a seat in srt while its own sandbox is on.

Done when a regression test shows a sandboxed seat's pkill cannot kill a process outside it.
