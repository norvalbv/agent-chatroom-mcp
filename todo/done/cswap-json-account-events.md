---
status: done
added: 2026-09-23
from: docs/reuse-survey-2026-09-23.md (Which subscription account served a run)
done: 2026-09-24 73d4be95 via reuse/cost-usage
---
# Read account switches from claude-swap's JSON events

scripts/paper-account-regime.ts extractSwitches parses claude-swap's human log lines with a regex
that reads timestamps as machine-local time. `cswap auto --json` emits versioned events with UTC
timestamps. Parse those; keep the regex as a fallback for old logs.

Check first whether a manual `cswap switch` also emits an event. Reduce any account reference to
its slot number: the paper log must not carry emails.
