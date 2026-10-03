# Smaller tool results, 2026-10-03

The final response-only change removes JSON indentation and the sender's own message body from successful `send_message` receipts. Receipts retain the ID, sequence, rendered author and quiet audience. Stored messages, peer delivery, unread-message refusals, board subscriptions and proposal versions are unchanged. The governing decisions remain `token-cost-is-resent-context`, `quiet-delivery-not-privacy`, `identity-is-the-connection` and `board-delta-manifests-and-single-electorate`.

## Fixed-transcript replay

The completed dashboard run `swarm-170811-k1pq` contains 306 completed Codex chatroom calls across four seats. Replaying the exact captured text through the final encoding gives **410,972 → 353,079 bytes (−14.09%)** and **115,780 → 97,644 o200k_base proxy tokens (−15.66%)**. This isolates the response-size saving on fixed data; proxy tokens are not provider billing. Compact JSON alone gives 383,563 bytes and 104,368 proxy tokens.

| Tool | Calls | Before bytes | Final bytes | Before proxy tokens | Final proxy tokens |
|---|---:|---:|---:|---:|---:|
| `wait_for_messages` | 55 | 165,446 | 150,704 | 47,654 | 41,479 |
| `send_message` | 143 | 130,162 | 96,598 | 34,799 | 26,478 |
| `read_messages` | 20 | 40,997 | 40,617 | 10,715 | 10,578 |
| `join_room` | 4 | 38,866 | 32,261 | 11,054 | 9,134 |
| `board_get` | 20 | 29,614 | 27,798 | 9,381 | 8,371 |
| `board_set` | 49 | 4,232 | 3,582 | 1,694 | 1,199 |
| `submit_opening` | 4 | 1,085 | 1,003 | 287 | 245 |
| `leave_room` | 5 | 294 | 294 | 88 | 88 |
| `pass` | 6 | 276 | 222 | 108 | 72 |

Of 143 sends, 101 succeed (38,198 original bytes, 6,401 final receipt bytes). The remaining 42 are refusals: 34 unread guards (76,130 bytes), six still-owed asks (15,416 bytes), and two other refusals (418 bytes). The unread guard already calls `settleRead`; counting every refusal as redundant would be incorrect. Only the sender-authored success echo is removed here.

Reproduce with `uv run --with tiktoken python scripts/output-size-replay.py <repo>/swarms/swarm-170811-k1pq`. It checks that the captured receipt actually ends with the submitted content before removing it. The prior dashboard report was read for context; none of its UI claims is re-derived.

## Live same-brief pilot

Three serial rooms ran the identical signed paid-row sum brief on three `claude-opus-5-5` seats (two workers and a verifier): base `swarm-181632-k2uu`, compact-only `swarm-181801-ohs2`, final `swarm-182742-t6eq`. All produced the independently calculated oracle **TOTAL_CENTS=430**, so the observed oracle delta is 0. This is a simple visible arithmetic oracle, not a hidden-fixture coding benchmark. Each arm has complete 3/3 trace and usage coverage.

| Arm | Seat | All / hub calls | Hub result bytes | Input | Cache-read | Cache-create | Output |
|---|---|---:|---:|---:|---:|---:|---:|
| base | claude-opus-5-5-1 | 12 / 12 | 23,693 | 22 | 275,573 | 16,706 | 2,965 |
| base | claude-opus-5-5-2 | 17 / 17 | 26,836 | 22 | 275,926 | 18,758 | 3,473 |
| base | verifier | 13 / 12 | 23,897 | 22 | 286,881 | 18,396 | 4,224 |
| after | claude-opus-5-5-1 | 8 / 8 | 8,228 | 14 | 150,246 | 8,911 | 1,625 |
| after | claude-opus-5-5-2 | 12 / 11 | 12,446 | 18 | 206,492 | 12,218 | 2,684 |
| after | verifier | 12 / 10 | 10,404 | 14 | 163,701 | 12,910 | 4,102 |
| final | claude-opus-5-5-1 | 9 / 9 | 9,883 | 14 | 151,726 | 10,045 | 2,002 |
| final | claude-opus-5-5-2 | 11 / 11 | 15,616 | 20 | 236,574 | 13,526 | 2,984 |
| final | verifier | 13 / 12 | 17,089 | 16 | 198,809 | 15,560 | 3,951 |

| Arm | Hub calls | Hub result bytes | Time to conclusion | Oracle |
|---|---:|---:|---:|---|
| Base | 41 | 74,426 | 30,029 ms | PASS |
| Compact only | 29 | 31,078 | 20,317 ms | PASS |
| Final | 32 | 42,588 | 28,234 ms | PASS |

These are n=1 live observations, in unrandomized order. Conversation paths, challenge counts and response sizes differ. The fixed replay establishes a causal byte saving; this pilot does **not** establish a causal reduction in calls, wall-clock, whole-run tokens or cost. Steering is unchanged and the incidental reply statistics are not treated as steering evidence.

The adjacent JSON records the exact brief/argv, provider usage, every tool type, saved `/stats`, trace hashes and launch-time SHA256s of the entry, server and manifest of all executable `dist/**/*.js` files. The latter excludes source maps and external dependencies; it is explicitly a JavaScript-build manifest, not the harness's whole-dist hash. The brief SHA256 is `d68ae3735124fb8e91f1b71971c9ea1e6fd6166da60720f31e1ba70e6e878a51`. The base source is `af26d162`; compact/final arms use exactly the two/three `src/server.ts` line edits described above. Rooms were served privately on 7847 and stopped by their listener PID. Full Claude traces are retained under each ignored `swarms/<run>/trace-*.jsonl`; the analyzer used `CLAUDE_CONFIG_DIR/projects`, not an assumed default home path.

## Validation

`per-turn-payload-regression.ts` fails at the base (three new assertions) and passes 6/6 at the final source. It verifies compact success and error JSON, byte-for-byte board text, a long sent message's unchanged storage and recipient delivery, and quiet reply audience preservation. The smoke test now checks actual recipient delivery rather than requiring an own-message echo. Build and `PORT=7848 npx tsx scripts/smoke.ts` pass (`SMOKE OK`).

Full `npm test`: 151/152 commands pass. The untouched blind-drafts test falsely rejects the digits `31` in deadline `18:31:00` because its secret length is 31; isolated rerun passes. This unrelated clock-dependent assertion remains unresolved, recorded as autonomous issue `91951700-0de3-4fc4-ab75-4fbe70a415d8`. No test was weakened or skipped.
