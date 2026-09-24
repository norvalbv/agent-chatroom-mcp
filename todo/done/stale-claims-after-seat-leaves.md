---
status: done
added: 2026-09-23
from: reuse/concord build (docs/related-work-concord-2026-09-23.md on that branch); Concord MCP's stale-claim list and versioned ownership transfer (MIT)
done: 2026-09-24 successor takes a departed seat's claim at once, anyone after Hub.STALE_CLAIM_MS (10 min); takeovers posted; room_status.stale_claims; stale-claims-regression 4/4
---
# A departed seat's claims stay locked to it

Once a seat leaves or is swept, its claim/* entries stay owned by it: a peer's write is refused
with and without overwrite, and so is a successor registered through registerReplacement
(reproduced by the concord builder's probe). Work a seat claimed can then be stranded until the
room ends.

Preferred shape: keep the claims owned, but let the registered successor take the key, and anyone
once the owner has been inactive past a timeout; add stale_claims to room_status. Concord MCP's
stale-claim list and audited ownership transfer are the reference.

Do not simply release claims on leave the way removeParticipant does: it rewrites the claim with
by "system" (src/hub.ts), and respawnDecision counts only claims the departed seat still owns
(src/respawn.ts), so a release would switch off the "left a claim/* with no handoff/*" respawn
rule (docs/decisions/self-organising-teams-by-claims-and-recruitment.md). The gap is worse than it
looks: respawn recruits a successor for exactly such an orphaned claim, which the successor then
cannot write.

Done when a regression test shows a successor (or a peer, per the chosen rule) can take a
departed seat's claim, and the refusal text for a live owner is unchanged.
