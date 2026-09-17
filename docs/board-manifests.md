# Board discovery delivery

`wait_for_messages` sends `board_keys` and `board_reset: true` on first delivery,
rejoin/reclaim, and subscription changes. Later deliveries contain only
`board_delta: { keys, tombstones }`, or no board fields when nothing changed.
Each participant has an independent ephemeral cursor; chat reads and `board_get`
do not move it. The cursor is updated synchronously after a long poll wakes.
Concurrent waits serialize at response assembly, **not** at network receipt: a
lost response requires rejoin/reclaim to get a full discovery snapshot.
Restart/replay resets receipts and reconstructs versions from persisted board events.

`follow` is an array of key prefixes. Omitted keeps the current subscription;
`[""]` follows everything and `[]` requests only mandatory coordination keys.
Changing either direction resets the snapshot, so clients should replace their
local key set on `board_reset`, then apply later deltas. This is discovery
filtering, not authorization: explicit `board_get` remains unrestricted.
Verification, claims, required pending inbox notes, and holds are never hidden
by subscriptions.

## Archive lifecycle

`board_set` accepts `ttl_seconds` or `expires_at` for `handoff/` and `inbox/`
(the latter is reserved, so create inbox notes through `post_to_room`, which
accepts the same options). Values are mutually exclusive. TTL must be finite
and positive; absolute timestamps must be parseable. Past timestamps archive
immediately. The expiry timestamp is stored durably with the entry.

Expiry removes entries from discovery, not storage. Explicit `board_get(key)`
returns the retained text with `expired: true` and a tombstone notice. A pending
required inbox note remains discoverable and proposal-blocking until its current
text is acknowledged, even if its sender exits or its deadline passes. Expiring
an acknowledgement does not erase its content-hash coverage. Replacing a note
with different text invalidates that coverage as before.

## Measurement scope

`/rooms/:room/stats` exposes `board_manifests` after the first observed wait:
`version`, `waits`, `bytes`, `full`, `delta`, `empty` (plus a flattened
`board_bytes_total`/`board_bytes_mean` view via `boardManifestTelemetry`). Each
sample is persisted as a `board_manifest` event and replayed. `bytes` counts
UTF-8 bytes of the standalone manifest envelope exactly as JSON.stringify writes
it: a reset/full envelope, a delta envelope, or `{}` (2 bytes) when nothing
changed. This is **not** total MCP/HTTP/socket framing and is not an
acknowledgement of successful network delivery. Historic rooms without samples
report `null`.
Historical logs without successful wait receipts cannot establish aggregate
historic wait traffic; replay schedules must be labelled counterfactual.
