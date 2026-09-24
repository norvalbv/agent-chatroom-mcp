---
status: done
added: 2026-09-23
from: docs/reuse-survey-2026-09-23.md (List prices for estimated seat costs)
after: opus-price-row-before-pool-2
done: 2026-09-24 4eedb336 via reuse/cost-usage (codex per-request pricing left in seat-launch-follow-ups)
---
# Replace the hand-kept price table with a pinned LiteLLM snapshot

Vendor a pinned snapshot of LiteLLM's model_prices_and_context_window.json (MIT) and delete
CLAUDE_LIST_PRICE_PER_MTOK and the regex matching in priceEntryFor. Keep estimateSeatCost's
per-message-id dedup and its rule that unknown cost is null, never 0.

Needed for codex seats too: Codex reports no USD, and gpt-6-sol and gpt-6-astra have a
>272K-input price tier.

Watch out for: provider-prefixed keys (us./eu./global. variants carry a premium), and
genai-prices counting cache tokens inside input_tokens while Anthropic does not.

Done when every model the launchers can seat has a row, and tests reproduce known costUSD values.
