# Pre-registration: anchoring and allocation (2026-09-23)

Written and committed before either test launched. Motivation: a comparison with OpenAI's Navier–Stokes run (groups given different problem variants, researchers consolidating and re-seeding between groups) against rooms swarm-083203-kooz and swarm-092653-202z, where 14 of 15 blind openings gave one diagnosis. Two candidate causes are tested separately. Both tests are pilots (one room per arm); they can show a large difference, not a small one.

All seats: `claude-opus-5-5`, launched by `dist/swarm.js` at main 1b43ed8 (hub build 858dbfa running on :7717), recruit policy pinned to claude / claude-opus-5-5 for the duration.

## Test 1: anchoring (openings only)

**Question.** Do same-model seats open alike because they all read the same carried-forward context (settled decision axes, the PRIOR RUNS list, the operator's auto-memory)?

**Arms.** Same brief (`docs/experiments/2026-09-23/brief-openings-0923.txt`, room B's research brief plus "this run collects opening answers only"), `--flat --agents 9` (8 workers + verifier), run one after the other on the same hub.
- **Carry:** as launched today.
- **No-carry:** `--no-carry` (no settled axes, no PRIOR RUNS, seat auto-memory off).

**Primary measure.** Number of distinct ideas among each arm's 8 worker openings. All 16 openings are pooled, stripped of names, shuffled, and clustered by three independent blind judges (Claude Opus 5.5, told nothing about arms); the arm's count is the median over judges of the number of clusters its openings fall in.

**Secondary.** Share of openings that cite a prior run, report, the paper or a settled decision as their source.

**Prediction.** No-carry has more distinct ideas than carry. A difference of 2 or more clusters (median) counts as support; 0–1 as no support.

## Test 2: allocation

**Question.** Does handing each seat a distinct target (outside allocation) beat seats choosing from a shared pool themselves?

**Arms.** Same 10-item pool (`docs/experiments/2026-09-23/pool-0923.txt`, distinct items from kooz's friction notes, none built on main), `--flat --agents 4 --full-access --require-verification --no-carry --timeout 45`, run at the same time in separate rooms.
- **Self-organised** (`docs/experiments/2026-09-23/brief-alloc-self-0923.txt`): "Organise yourselves: claim items on the board before you start."
- **Assigned** (`docs/experiments/2026-09-23/brief-alloc-assigned-0923.txt`): workers 1, 2 and 3 get items 4, 5 and 6, drawn with `random.Random(20260923).sample(range(1, 11), 3)` before launch; after landing it, a seat may claim any unassigned item.

**Primary measure.** Items landed: a commit on a worker branch that fixes the item, with a regression test, and a verify/* entry by a seat other than its builder.

**Secondary.** Collisions (items that two or more workers built or began building, from claims, commits and transcripts); distinct items worked; minutes to each worker's first commit; total cost; chat messages per landed item.

**Prediction.** Assigned has zero collisions and lands at least as many items as self-organised; self-organised has at least one collision.

## Analysis

Counts are reported per arm with the raw evidence (room logs, board, branches, seat transcripts). Items landed are checked by me running each regression test on its branch, not by the room's verify entries alone. No significance test at one room per arm. Deviations from this plan will be listed with the results.
