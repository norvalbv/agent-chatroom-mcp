# Proposed decision: steer-addressed-asks-mid-turn

From swarm-181144-uxtr (concluded); report: swarms/swarm-181144-uxtr/report.md. A human promotes this into docs/decisions/ with `guard-decisions add`; nothing is adopted automatically.

DECISION RECORD**

- **slug:** steer-addressed-asks-mid-turn
- **context:** A seat tagged while busy didn't see the mention until its next wait or read, a 30–111 s delay per mention. Hub results were also padded: compact JSON, sender echoes, unchanged waits repeated in full, and room_status at about 25 KB per call. Sends were refused for hub notices alone (13 of 140 arrived-while-composing refusals across 4 runs).
- **ruling:**
  - The hub serves pending addressed asks as a peek on `/heartbeat`; the consumer acks after injecting, and later waits show a one-line stub. Any other hub tool result carries pending asks as a fallback.
  - Claude seats inject through PreToolUse/PostToolUse hook additionalContext. Codex seats run on app-server turn/steer and ack only after the steer is accepted. OpenRouter seats inject between steps.
  - Compact JSON, no echo of the sender's own text, compact unchanged waits, a trimmed room_status (`full_topic=true` returns the rest), and hub notices no longer refuse a send.
- **consequences:** Mention-to-reply medians fell: Claude about 51 → 7 s, OpenRouter 30.3 → 6.8 s, Codex 52.4 → 8.8 s, combined 15.9 → 4.0/5.9 s. The task check passed in both arms of each combined comparison. Hub bytes fell 13–37% live and 14.1%/6.9%/38.4% on replays.
- **tradeoff:**
  - Answering mid-job adds turns for the busy worker. Room cost rose 29.7–35.7% and completion time rose 57.5% in single-run comparisons (cache-confounded).
  - Codex seats now depend on the app-server runner; its effect on output format is unresolved.
  - room_status trims the topic, so seats need `full_topic=true` to recover it.
- **researched:**
  - Read by team members as reported in the room; I checked only that the paper's citations resolve (33/33).
  - NEW: arXiv:2601.22037, arXiv:2609.17985 (abstracts), arXiv:2407.02043, arXiv:2609.32961, arXiv:2608.16370, LLMLingua-2 (arXiv:2403.12968, abstract and intro).
  - NEW web: https://openrouter.ai/blog/tutorials/tool-calling/, https://ai-sdk.dev/docs/agents/loop-control, https://learn.chatgpt.com/docs/app-server, Anthropic's tool-design article.
  - Already settled: none re-read.
- **rejected:**
  - Relaxing the stale-send gate for all refusals: 41 of 51 refused senders changed what they said after reading, so most refusals earn their cost.
  - Holding launched seats' waits past 55 s: it contradicts the stated tool contract.
  - Truncating steered asks at 600 chars: a seat could act on a partial ask.
  - A hub reminder to form breakout rooms: the owner ruled that seats must split on their own.
  - A per-call hook tax as the cost cause: per-turn transcripts show no repeated cache rebuild.
- **revisit-when:**
  - A matched multi-run benchmark (n≥3 per arm, both arms starting from a cold cache) shows room cost or completion time still up more than 10% with steering on.
  - Or a Codex strict-format check fails on a brief that doesn't contradict its own checker.
  - Or a measured run shows message-empty wait wakes above 10% of hub calls with no action owed.
- **RE-TARGET:** none. This is consistent with hub-carries-what-it-knows: "hub notices are news, not debt" is now enforced at the send gate.
