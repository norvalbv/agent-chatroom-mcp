# Reveal-pair screen, 2026-10-29

Protocol: decision/reveal-rivals-protocol v4, registered before S1. The rival flag was off in all three rooms.

Each room ran tasks/bench-printf-format with 3 claude-opus-5-5 seats at effort xhigh (verifier included) and `--timeout 15`. The runtime was the frozen checkout at e03bf696 (dist sha256 014a198d…), with no embedder. Each room was scored by the unmodified scripts/bench-oracle.ts scoreTask.

| slot | room | outcome | wall | cost | failing cases |
|---|---|---|---|---|---|
| S1 | swarm-224118-cv8z-room | pass | 274 s | $3.45 | 0 |
| S2 | swarm-224615-4sls-room | pass | 302 s | $3.61 | 0 |
| S3 | swarm-225139-bn7x-room | pass | 446 s | $4.77 | 0 |

**Screen: 3/3 primary passes, Wilson 95% 0.44–1.00.** All three rooms concluded 3/3 with launcher exit 0 and no infra reasons, and the frozen hashes are identical across them.

The screen is at ceiling, so the pair was not registered and no arm ran. The rival lever's effect on answer quality is UNMEASURED.

Oracle controls run before S1:
- fixtures/correct: task_pass.
- Stub: task_fail.
- bad-control-format.ts: task_fail on case-458, and also on 327, 360, 454 and 497.

## Why it is at ceiling (hand reading)

The public README states case 458's rule itself, at line 36: X is the decimal exponent "after rounding". In every room at least one sealed opening restates it ("g picks style from the post-rounding exponent"): 2 of 3 seats in S1, 1 in S2 and 2 in S3. Every room also seeded a C printf or Python `%` differential, and the seats ran it.

## Word-rule flags

`names_case458_error` is true in 3/3 rooms, but the flag is **unreliable**. Its `/exponent/` term matches "toExponential", and every hit is a toFixed/toExponential tie-rounding seed. Read by hand, no seeded idea/* text names the case-458 error.

`names_catching_check` is a genuine match in 3/3 rooms. No outcome depends on either flag. To see each hit, run `python3 -I docs/measurements/reveal-pair/word-rule-check.py <room.jsonl>`.

Each `<slot>/` holds the runner's summary.json and manifest.json. The room logs and workspaces stayed in the frozen checkout and are not committed.
