---
status: open
added: 2026-09-24
from: reuse/cost-usage review (non-blocking findings)
---
# Cost usage: follow-ups from review

- Stale docstrings in scripts/seat-cost-estimate.ts: estimateSeatCost still says `observed` is
  every assistant event's usage, and the header says usage comes only from assistant events.
- No pool-run-level test shows a killed claude-opus-5-5 seat now gets a number (pool-run.test.ts
  still accepts cost_usd null for the killed fake seat).
- A request in flight at the kill with no assistant event yet has its message_start usage (input,
  cache reads and writes, already billed) unpriced, so a killed seat's estimate is somewhat low.
- priceEntryFor returns null for 'claude-opus-5-5[1m]', dated codex ids (gpt-6-sol-2026-09-22) and
  the 'opus' alias. Safe (unknown, not 0), but callers that pass those names get no estimate.
- claude-swap dedup: a manual and an auto switch with the same from/to within 2 minutes collapse
  into one. Unlikely; untested.
