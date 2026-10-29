# swarm-193427-ztnx (RSI-7): wide before deep, and the merge check before main

Merged on 2026-10-29, about 21:10 UTC, by the chair, on the owner's instruction: "yes commit and merge the telemetry tools. Push to main."

- `integration/swarm-193427-ztnx-verifier` at e1a22881, from main 3c32722c: 17 authored commits and 5 verifier merges, 23 files, scripts and measurement artifacts only. No hub source changed.
- Merged onto main 3c32722c as 01c61f17 (`--no-ff`). The merged tree is identical to e1a22881.
- Hub 7717 was not restarted and `dist/` in the main checkout was not rebuilt: the new scripts run through `npx tsx` and need neither. The room ran on a private hub, :7760, built from 3c32722c in room-rsi-7/hub-build, stopped by PID after the launcher exited.

## The room

Flat, 6 seats at xhigh: verifier claude-opus-5-5, workers 2x claude-opus-5-5 and 3x gpt-6.1-sol (codex), one gpt-6.1-sol recruit for steer-split. Launched 19:34 UTC with a 6-hour ceiling; concluded 20:40 UTC on proposal v7, all voted, verifier agreed. Seat targets came from seven `## item:` sections in the resources file. Cost: $47.99 on the three Claude seats (3 of 6 seats reported USD; codex seats report tokens only) plus about $9.4 of probe arms.

The brief asked whether rooms look wide before they go deep, where the concluded framing comes from, and whether a mid-room checkpoint or a trained pruner is justified. A door with thresholds was registered at 19:39:25Z, before the first number at 19:43:48Z, and applied as written.

## Findings (every number recounted by the verifier from the scripts at e1a22881)

- Opening spread, pair level: of 18 random within-room worker opening pairs, 2 compete, 4 are complementary, 11 the same, 1 unknown; 3 blind raters from 2 providers, Fleiss κ 0.80. Room level is unmeasurable at the registered bar: the audit agreed 6/10 because the rubric does not separate sub-questions from main framings. Embeddings over 220 rooms: one framing in 150; same-provider pairs sit +0.106 cosine closer; every script miss against hand labels was false width.
- Width over time (one labeller, n=20): held width ≥2 at the reveal 1/20; ever ≥2 2/20; collapse before the first checkable evidence 0/20. Embedding clustering scores the same as a constant one-framing labeller, so there is no embedding width monitor.
- Winner provenance (n=20): the concluded framing was present at the reveal in 19/20, mixed 1, wholly mid-room 0; blind audit 14/15. "Present at reveal" is not seat invention: the conclusion sits nearer the brief than the nearest opening in 13/20, and seat-origin is unknown. Of 138 candidate revisions, a 15-revision read found 3 work-status, 11 elaboration, 1 sub-question correction; a causal pivot rate is unmeasured (no delivery receipts in the logs).
- Alternatives pair (n=3/arm, tasks/stamp-interpreter, 3 Opus seats): A 3/3, B 3/3, delta 0 at a task ceiling (18/18 openings already held the passing answer; a bad-token control fails). B produced 27 alternatives, all disposed, 26 of them self-refuted misreadings; B cost +38.6%, wall +18.4%. The opening-alternatives record's revisit-when is met and inconclusive; the next pair should screen bench-printf-format and register only if a 3-seat room fails 1-2 of 3.
- Door: D1 1/20 against ≥10/20, audit 60% against ≥80%, D2 0/20, D3 0/20. CLOSED by rule, worded "unmeasurable at the registered bar", not "rooms start narrow". No checkpoint, pruner, allocator or training built.
- Steer split: 1,364 steer events in 150 of 340 logs (395 human, 617 chair, 280 inbox notes, 72 corrections). Sample of 30: reframe-involved 10/30; blind audit 6/10; non-trading stratum 0/6. Not reliable as a population rate.
- Fine-tuning: nothing to train on. Zero branch decisions tied to outcomes exist; the 27 alternative tuples are process records.
- The room as its own sample: 18/18 idea entries carried a disposition; 9 of 18 seeded idea keys were content-free because `slugOf` in src/hub/openings/ideas.ts takes "p=0.30 ..." as the slug.

## Checks on the merged tree

- Verifier's gates at e1a22881 (evidence/integration-ledger): `npm run build` exit 0, `tsc -p tsconfig.scripts.json` exit 0, SMOKE OK on 7897, full suite "[offline] OK (361 commands)", `scripts/deploy-check.ts` on a copy of hub 7717's data: DEPLOY CHECK OK, 340 logs on 3 boots, 0 files changed. The combined four-regression check is red at 3c32722c and green at e1a22881.
- The chair's own checks in a detached worktree at 01c61f17: build exit 0, scripts tsc exit 0, SMOKE OK on 7733, and the four new regressions green: opening-spread, framing-width, winner-provenance, steer-split.
- Hooks: guard-dup opted out (no index) on every gated commit; the verifier's clean merges ran no hook because the repo has no pre-merge-commit hook.
- Merged content read first-hand by the chair before the push: docs/measurements/steer-split/sample30.json holds 30 steer records with the message text and context copied from room logs under the gitignored data/ (about 25k characters, trading-room operations chatter), and corpus.json names those logs by absolute path under the owner's home directory. A pattern scan of docs/measurements and labels for API keys, bearer tokens, private keys, wallet addresses and e-mail addresses found none; the README says one token in sample 20 was redacted and IDs hash the original content.

## What the scripts give you now

Each runs over any room log with `--json`: `scripts/opening-spread.ts` (needs the Ollama embedder at CHATROOM_EMBED_URL), `scripts/framing-width.ts`, `scripts/winner-provenance.ts`, `scripts/steer-split.ts`. They are not yet wired into run-metrics, runs-table or report.md, and they add no hub telemetry events.

## Decision record

The launcher filed 7 Targets to docs/decisions/proposed/ (untracked, for the owner to promote with `guard-decisions add`): rooms-open-on-one-framing, no-collapse-before-evidence, winner-present-at-reveal, alternatives-pair-at-ceiling, checkpoint-door-closed, steer-split-unreliable, no-training-without-supervision.

## Hub friction filed by the room (board friction/*)

- Codex seats: the managed sandbox denies kill, ps and nice across exec calls, and refuses non-chatroom MCP tools (arXiv, autonomous_bugs) under approval policy never; a broad `npm test` inside it fails sandbox-specific tests.
- `request_agent(area=)` still writes the claim with the recruiter as owner (RSI-5's friction/recruit-area-claim-owner, unfixed).
- Seeded idea keys from alternatives that start with a probability become idea/p-30.
- A vote's unverified_commits treats any 7-40 character hex token as a commit (a sha256 prefix and a dist hash were listed).
- An attack edited to "VERDICT: answered" can be re-queued against a different clause.
- A new scripts/*-regression.ts is not run by `npm test` until listed in scripts/offline-runner.mjs.
- After the run, three test hubds started by the recruit from its worktree outlived the launcher's sweep (stopped by hand).

## Remains

A room-level framing rubric with examples and a held-out re-audit; an independent temporal audit of the width labels; an independent audit of the 15-revision pivot sample and reconstruction of seat targets to measure seat-origin; a sharper steer rubric; the next alternatives pair on a discriminating task at n≥5 per arm; wiring the four scripts into report.md; any checkpoint or trained allocator only through a fresh registered door.
