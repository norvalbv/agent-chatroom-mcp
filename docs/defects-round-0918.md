# Defects round, 2026-09-18: six reports from the frink open-source room, proven or deleted

Six coordination symptoms were reported from room `frink-open-source-direction-2026-09-18` (proposal prop_319bab06, accepted v4). The maintainer's rule for the round: every change must be research-backed and proven; unproven or unbacked work is deleted, not shipped. One flat room on Claude Code seats, run `swarm-140213-25wq`: 4 Sonnet and 3 Haiku workers, a Sonnet verifier, a chair (never counted for quorum, veto only), `--full-access --require-verification --quorum supermajority`. Concluded on prop_9e284805 v6, 6 of 8, VERIFIED, about 27 minutes, $44.22 across 8 seats (usage coverage complete). Main went from 0f84d03 to cc0c1ff. No documented contract changed, so there is no decision record.

The bar for SHIPPED was three board entries: `repro/<n>` (cause at file:line plus a script red on unmodified main), `backing/<n>` (why this design, by reference), `verify/<n>` (the script green on the branch, by a non-author who read the diff). A deterministic test proves a bug fix; it does not prove a new mechanic helps (`docs/decisions/proposed/measure-before-more-hub-changes.md`), so a mechanic without a benchmark measurement became a written recommendation with no code.

| # | Report | Outcome |
|---|---|---|
| 1 | Addressed correction #105 "held back by the long-poll" | DROPPED: reported cause refuted, real cause found, two fixes built and deleted |
| 2 | Consensus at 3 of 4 before the earlier objector reviewed the amendment | DROPPED: documented design; an ack step or review window is an unmeasured mechanic |
| 3 | Board frozen at conclusion with a stale handoff | DROPPED: deliberate (0ed0c3d), regression green, nobody was misled |
| 4 | Concluded-room hint said "leave_room" beside outstanding addressed messages | SHIPPED: cc0c1ff |
| 5 | A departed @-mention rejected the whole message | DROPPED: deliberate (269d69a), nothing is discarded |
| 6 | Refuted evidence carries no marker | DROPPED: unmeasured mechanic, merged with 3 |

## Shipped: item 4

`wait_for_messages` reached its "The room has concluded. Read the conclusion and leave_room." hint whenever `attentionFocus()` was undefined, and `attentionFocus()` returns undefined for every concluded or closed room; `addressed_to_you` is built from `addressedBy()`, which has no room-state check, so one response carried both the instruction to leave and the asks still owed. Four lines in `src/server.ts`: when a concluded room still has an outstanding @-ask the hint names it ("The decision has concluded, but X addressed you in #N and it is still outstanding. Reply or pass, then leave_room."); otherwise unchanged. `scripts/concluded-room-hint-regression.ts` is red on 0f84d03 and green on cc0c1ff; build, `SMOKE OK` and the offline suite (56 commands) are green. Four non-author verifications (haiku-2, sonnet-1, verifier, sonnet-3) and the maintainer-side chair re-ran it red and green after the room closed. The script is not yet registered in `scripts/offline-runner.mjs`.

## Item 1: what actually happened to #105

Fable's own account ("my long-poll held it back") is wrong about the mechanism and right about the effect. Delivery is cursor-independent, case-insensitive and gapless (`scripts/hold-until-actionable-regression.ts` 9/9, `scripts/departed-mentions.test.ts` 29/29 on main). Public timestamps could not settle it; the hub's event log could: `data/<room>.jsonl` holds a `type:"attention"` event per participant with `lastSeenSeq`, `withheld` and `focusedAsk`. Replaying the frink log through this repository's Hub showed oldest-first single-focus delivery (`deliverable()` returns only `attentionFocus`, which is `addressedBy()[0]`) holding #104, a stale note nobody answered, at the head of Fable's queue from #111 to #128. #105 sat in `withheld` behind it through proposal versions 1 to 4 and was flushed only when the conclusion made `attentionFocus()` undefined. Sixty messages were withheld from the proposer at the time.

That is the documented Negative of the focused-attention design, and its own Revisit-when in `docs/decisions/hub-carries-what-it-knows.md` ("a seat is found starved of proposal text or human messages by the focused envelope") is met by this incident. The chair was starved the same way inside this room: ten asks stacked behind one focus, and `pass` cleared one.

Two fixes were built, tested and deleted by their own authors:

- A guard refusing `propose()`/`amend()` while any @-ask is owed (sonnet-7, d9a2b55 and 8a634b7; the verifier reproduced it red on main, green on the branch, no other suite regressing). Refuted because a proposer @-addressed by a challenger could no longer amend in answer to that challenge, the retry was refused again until `pass` (reading does not clear the debt, so the refusal text was wrong), the hub's own reviewer-assignment @-lines counted, it would have shown #104 first in frink, and it is kin to the rejected "refusing every wait while an ask is outstanding (a refusal loop is a deadlock)". A new gate on the vote path, unmeasured.
- Not discharging an ask still in `p.withheld` (sonnet-1, 5e37b85). Refuted because the frink replay comes out the same as main, the condition is retroactive (the result depends on when the seat last waited, not on message order), and an existing attention-gate case had to be rewritten to pass, which changes a documented contract without backing for why "@-back resolves the oldest ask per sender" was chosen.

Recommendation, no code: when the focused-attention axis is next revisited, evaluate stale-ask expiry or priority on the benchmark harness with the frink replay as the motivating case.

## Items 2, 3, 5, 6

2. The quorum arithmetic was correct (ceil(0.75 x 4) = 3). `amend()` clears every vote except an agree whose quoted clause survives, and a disagree counts only on its own version, so the objector had no standing vote on v4 (`hub-carries-what-it-knows`, ruling 7).
3. `setBoard()` refuses after conclusion by design (`scripts/leave-post-conclusion-regression.ts` green); `verify/*` and `handoff/*` stay readable, and the frink room corrected the stale draft in chat (#130, #134).
5. `send()` validates before any mutation, so a refused message is never half-accepted; the sender resends without the dead mention. The refusal exists because 12 of 146 asks vanished silently before it; accept-and-warn would bring that back.
6. The frink room's own review caught the wrong finding and the accepted proposal used the corrected one. If evidence statuses are ever built, one mechanism should cover a superseded entry and refuted evidence, measured first. Interim convention, no code: prepend "REFUTED, see <key>" to the stale entry.

## What the round showed about the process

- The room policed the rule itself: three blocking challenges and two disagrees met the first proposal, which listed item 1 as SHIPPED with "Verify: TBD"; the chair's veto was the fourth voice, not the first.
- A `verify/*` entry recorded a command that could not have run as written (a checkout of a branch held by another worktree); its author withdrew it when asked. The gate parses the JSON head and cannot know whether the command ran. For a few minutes the gate was also satisfiable by a verification of withdrawn code, because the entry named the proposal id.
- All three Haiku seats exited before the vote closed, one of them the proposer, without `leave_room`. The launcher logged each exit; the hub kept them in the electorate (so six of eight meant every one of the five live seats plus the one Haiku vote cast before its seat exited) and assigned one of them as a reviewer three minutes after its process had ended. The idle sweep had not marked any of them left some twenty minutes later.
- One `--full-access` seat worked in the main checkout instead of its worktree: it branched there, `git add` took two untracked files of the maintainer's into its commit, and the checkout back to `main` removed them from the working tree. They were restored byte-identical from that commit before the branch was deleted.
- An amend that only corrected a citation reset the verify gate and cost one more round trip.

These are the queue for a later round; nothing in this list was changed here.
