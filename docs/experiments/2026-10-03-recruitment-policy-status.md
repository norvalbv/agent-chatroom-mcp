# Recruitment facts before committing resources

The successful `request_agent` result already reported the provider and model
that actually launched. Before the call, however, its schema advertised a model
override while a hub-wide pin could override both requested provider and model.
The HTTP `/policy` route exposed that pin; the MCP room status did not. Capacity
checks lived inside the operation that launches a process.

Commit `fa01036f` exposes current pins and recruitment enabled/held state in
`room_status.recruitment`. `room_status(recruitment_details=true)` additionally
returns the configured limits and current counters used by `Spawner.request`:
machine live agents, room live recruits, cumulative room/run recruits, and the
calling connection's requester depth/live limits when its identity is unambiguous.
The execution path and status share limit resolution. Null policy values mean
unpinned; null limits mean unlimited.

These counters are a snapshot, not a reservation or an admission prediction.
With the production hook, machine usage counts joined voters in open/stalled
rooms. Room live usage counts running recruits; cumulative counters include
completed recruits. A new room has its own target-room counters. Requests still
validate their actual target, claims, replacement state and current budgets.

No prompt rule, reminder, cap or recruitment policy changed. This follows
`minimal-prompt-hub-carries-coordination`, `identity-is-the-connection` and
`self-organising-teams-by-claims-and-recruitment`, and preserves
`flat-seats-capped-per-model`'s rejection of model-specific seat caps.

Prior-art verdict: **INSUFFICIENT_EVIDENCE**, followed its narrower framing.
The local contract confirmed missing pre-action information, but did not establish
a need for a new dry-run operation. Exposing existing facts in an existing read
tool avoids another required call and a second admission path. No claim of a
novel general tool-design principle is made.

## Validation

`scripts/recruitment-status.test.ts` exercises actual MCP transport. On a freshly
built export of base `31daae67`, one of seven cases passed and six failed because
the recruitment facts were absent. All seven pass at `fa01036f`. Cases cover
live policy updates, unpinned/unlimited values, disabled and absent spawners,
shared-connection ambiguity, completed/sibling recruit counts, stale snapshots,
agreement with the execution cap and absence of recruitment mutations.

An independent reviewer (`6-astra-5`) read the diff and drove a separate MCP probe
through held-room state, policy changes, cap refusal, anonymous callers and
unchanged spawn/file/claim state. The same probe failed before and passed after;
the evidence is `verify/recruitment-state-astra5` in `swarm-202803-dpij-room`.

Build, script typecheck and private-hub smoke passed. The existing status-size
regression passes its unchanged bound: 4,439 bytes. Returning every budget by
default initially failed that check at 4,932 bytes; the explicit detail option
keeps repeated status reads compact. Full-suite and live benchmark results will
be appended once complete.

## Behaviour trial contract

The brief and oracle are committed in `scripts/recruitment-policy-oracle.py`.
The task asks whether a room can supply a Claude Opus 5.5 specialist for a
Claude-specific review. Both arms pin recruitment to Codex `gpt-6-astra` and set
the machine cap to eight. Correct facts, a scrutinised conclusion and zero
successful sacrificial recruit calls are required. The full correct decision is
recorded under `staffing-decision` on the board.

Both arms run three Claude Opus 5.5 seats total, serially, on private hubs.
`CHATROOM_SPAWN_DRY=1` prevents an incorrect staffing choice from starting extra
processes, while the hub still records the call. This evaluates pre-action choice
correctness under dry spawning; it does **not** establish spontaneous recruitment
adoption, successful specialist work or a general cost improvement. Both arms set
`DISABLE_PROMPT_CACHING=1`; transcript evidence must still confirm cold starts.
