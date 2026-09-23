---
status: open
added: 2026-09-23
from: docs/reuse-survey-2026-09-23.md (List prices for estimated seat costs)
---
# Price Opus 5.5 seats before pool 2 runs

scripts/seat-cost-estimate.ts has one list-price row, `claude-sonnet-5`. Every pool seat is
Opus 5.5. A seat killed at the 30-minute cap never reports costUSD, so pool-run.ts falls back to
the estimate, finds no row and records `cost_usd: null`; scoreRun then reports null cost for the
whole solo or split run. Pool 1 finished inside 12 minutes so it never happened. Pools 2 and 3 are
harder, so deadline kills are likely.

The survey also found the Sonnet 5 cache-write price wrong: all 753 claude-sonnet-5 usage entries
in bench/results reproduce the CLI's costUSD at the 1-hour write rate ($4.00/MTok), none at $2.50.

Done when:
- An Opus 5.5 row taken from a pinned snapshot of LiteLLM's model_prices_and_context_window.json
  (MIT), with cache writes priced by TTL (usage.cache_creation.ephemeral_1h_input_tokens).
- A test reproduces known costUSD values from bench/results for both models.
- The pre-registration records it as a measurement fix made before pool 2's first run.

The full table replacement (codex models, the regex matching) is in price-table-from-litellm.
