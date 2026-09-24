# Proposed decision: flat-seats-capped-per-model

From swarm-092653-202z (concluded); report: swarms/swarm-092653-202z/report.md. A human promotes this into docs/decisions/ with `guard-decisions add`; nothing is adopted automatically.

DECISION RECORD** (`guard-decisions add flat-seats-capped-per-model --target ...`, plus RE-TARGET consensus-requires-scrutiny)

- **slug:** flat-seats-capped-per-model, filed with **RE-TARGET consensus-requires-scrutiny** and **RE-TARGET token-cost-is-resent-context**.
- **context:**
  - The previous 15-seat room (kooz) concluded at 3 of 4 votes after 11 seats had left, so the quorum decided nothing; about 34% of its wall time went to 12 amends.
  - Waking resident seats on chatter addressed to others cost 15% of its 215M input tokens. Cost per seat-minute was flat across 20 runs, so cost is linear in seats.
  - Duplicate work: two identical 157-line salvages 32 s apart in kooz, and in this room three copies of one challenge cut within 10 minutes.
  - Every lean seat also loaded your auto-memory: 12,886 first-turn tokens with it versus 7,378 without.
- **ruling:**
  - `--flat` refuses more than 4 workers per provider and model unless `--max-same-seats N` is passed; fleet opts in with max(1, AGENTS-1).
  - Under auto, `challengeRequired` is false when `require_verification` is on; an explicit true and any filed challenge still block.
  - Lean seats get `autoMemoryEnabled:false`.
  - `attempts.ts` gives a hub-free path: N attempts in history-free exports, and a hidden check picks the winner.
  - Answered asks stop being re-delivered (8865439, ce5a66a).
- **consequences:** fewer resident same-model seats, so less repeated context and less duplicate work. First attempts are no longer anchored on memory from earlier rooms. The challenge ritual goes where a verify entry already exists, and hub-assigned reviewers remain; they caught both real defects in this room.
- **tradeoff:**
  - Your 15-seat single-model launches exit 2 until you pass `--max-same-seats`.
  - A verified room's only mandatory scrutiny is a verify entry that is mostly a stamp.
  - With memory off, seats no longer write lessons that carry across runs.
  - The cap of 4 is not measured.
  - A passing @-mention now settles all of that person's earlier asks.
- **researched:** no NEW literature was read this run. Sources were our own data:
  - `swarms/*/result.json` (kooz 083203, hdju 232020, 56 rooms for opening redundancy, 36 rooms for the verify audit)
  - `scripts/oracle-at-k.py` output
  - the kooz seat session logs
  - the board entries: evidence/kooz-token-attribution, kooz-wake-cost, seat-count, seat-redundancy, kooz-15seat-anatomy, verify-gate-audit, kooz-per-seat-landing
- **rejected:**
  - Making `commit` required in verify entries: it loses because the hub can't resolve commits from other projects.
  - Reverting the leaky 6d92de3: the fix 58de722 superseded it, with less churn.
  - Merging per-seat lenses (ae7ecae): unmeasured, and a lens does not remove the shared-brief anchor.
  - Cutting blind openings: fixed notices are only about 15% of the transcript, so openings are not the lever.
- **revisit-when:**
  - A live bench on a machine-checked task shows a capped room is no better than a 15-seat room, or `attempts.ts` is no better than one agent (arm A), on the same brief.
  - Or a verified room with no challenge concludes on a claim a later check refutes.
