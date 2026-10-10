# Proposed decision: human-questions-inbox-settled-by-reply-to

From swarm-170811-k1pq (concluded); report: swarms/swarm-170811-k1pq/report.md. A human promotes this into docs/decisions/ with `guard-decisions add`; nothing is adopted automatically.

DECISION RECORD**
- **slug:** human-questions-inbox-settled-by-reply-to
- **context:** Benji ran 8 agents that each had open questions for him. Finding them meant reading 200+ messages. The hub only tracked the reverse direction (`unanswered_human` covers a human's message waiting on agents), so asks addressed to the human were invisible. That cost his time and left agents blocked.
- **ruling:** `GET /questions` lists, across rooms, every agent chat message that either @-names a human or replies to a human with a "?". A human here means a joined human, the chair, `CHATROOM_HUMAN_NAMES`, human/owner, or the dashboard's name. Only a later human message whose `reply_to` points at that message settles it. Viewing doesn't, and neither does a later `@asker` message. The dashboard inbox replies with `reply_to`. Signal-only folding reads that same pending list, so it can't hide an open question. Dashboard features live in `src/ui/<area>.ts` modules with one-line hooks in `src/ui.ts`.
- **consequences:** Every question for Benji is found, answered in a thread, and counted the same way in the inbox, the room badges, the tab title and the catch-up digest. Builders could merge without conflicts because they no longer edit the same large file.
- **tradeoff:** An answer typed in the main chat box without `reply_to` leaves the question pending until it is dismissed, and dismissing only hides it in that browser. A question phrased without an @-mention isn't detected.
- **researched:** all NEW relative to the settled axes:
  - Axess Lab, "Glassmorphism meets accessibility" (read): https://axesslab.com/?p=5111
  - edana.ch on Liquid Glass (search snippet only): https://edana.ch/en/2026/03/27/what-to-make-of-apples-liquid-glass-ui-revolution-or-underestimated-product-misstep/
  - umich dissertation on interruption notifications (snippet only; page returned 403): https://deepblue.lib.umich.edu/handle/2027.42/177897
  - arXiv:2606.03103 DeskCraft (abstract)
  - arXiv:2604.20779 SWE-chat (abstract)
  - arXiv:2603.26233 Ask or Assume? (snippet only)
- **rejected:**
  - Settling a question when the human `@`-names the asker: loses on precision, because one message would clear every earlier ask from that agent.
  - Settling a question when the human views it: loses on correctness, because opening a room is not answering.
  - A mandatory `ask_human` tool as the only signal: loses on recall, since DeskCraft reports agents rarely use an ask channel. It is deferred as idea/inbox-followups.
  - Base64 photo upload: loses on payload size against a raw-body upload.
  - Blur behind message text: loses on WCAG AA contrast.
- **revisit-when:** an `ask_human` or explicit-question tool ships; or a measured share of real asks to Benji arrive without an @-mention and are missed by `GET /questions`; or Dismiss needs to sync across devices.
- No RE-TARGET of any settled axis.
