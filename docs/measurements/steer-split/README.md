# Chair and owner steer purposes

The frozen 30-event sample has 4 REFRAME, 16 UNBLOCK, 6 BOTH, and 4 OTHER labels
by codex-recruit-1. Thus 10/30 involve reframing and 22/30 involve unblocking,
with 6 overlapping. These are author annotations, not an established population rate.

The verifier independently labelled the first ten without opening the author's
labels. Exact agreement was **6/10 (60%)** before adjudication. Its counts were
0 REFRAME, 7 UNBLOCK, 1 BOTH, and 2 OTHER; the author's matching ten were
1 REFRAME, 6 UNBLOCK, 2 BOTH, and 1 OTHER. No original labels were changed.
The disagreement table is in `corpus.json`. The central scope ambiguity is whether
revising a runner diagnosis counts as reframing the room's research question.
On the shared ten, the author found reframing in **3/10** (1 REFRAME + 2 BOTH),
versus the blind auditor's **1/10** (1 BOTH). Both found unblocking in 8/10.

The text rules agree with the author on only **16/30 (53.3%)** categories. They
cannot establish a semantic split over the corpus. No checkpoint, classifier in
the hub, or training recommendation is justified by these data.

## Reproduce

From this worktree (all commands read the main checkout's logs without writing there):

```sh
node --import tsx scripts/steer-split-regression.ts
node --import tsx scripts/steer-split.ts \
  '/Users/benji/Desktop/Personal and learning/agent-chatroom-mcp/data' \
  --json --sample 30 \
  --labels docs/measurements/steer-split/author-labels.json \
  --audit docs/measurements/steer-split/audit-labels.json
```

`corpus.json` is this command's retained output. Each input has its absolute path,
SHA256 and event count. Eligibility is reconciled against `steerCount` for every
log: human/chair chats plus their inbox notes/rewrites, excluding `.ack`, worker
chat, board notices, and `steer_injected` delivery copies. The CLI also accepts
individual log paths and deduplicates repeated physical paths.

At capture there were **1,364 steer events in 340 logs**, with 150 logs containing
steers: 395 human chats, 617 chair chats, 280 inbox notes and 72 corrections.
Text-cue categories, explicitly proxies: 19 reframe, 938 unblock, 100 both,
307 other, 0 uncertain. This is an unfiltered historical corpus including child,
probe and development rooms, not just concluded MAIN rooms.

`sample30.json` retains the original annotation packet. Order is ascending
SHA256(room + ':' + (message seq or parsed-event index) + ':' + original text).
The source text is not truncated; context is the last three chat messages within
the preceding 40 events, each capped at 1,600 characters. One historical API
token in sample 20 is redacted. IDs hash the original content; retained annotation
packets are sanitized. The committed author file has SHA256
`ba1fc6e8110a04932bca3243f93125ec3580a71a45d717418dde195852026897`,
sealed on the room board before the audit request.

## Limits and source roles

The unit is a **logged destination event**, not a unique human intervention.
The same simulator instruction appears in sample 2 (rebuild) and sample 11
(tune). Broadcast instructions and corrections can be counted repeatedly.
The sample contains 9 events from family swarm-210319-js47, 7 from
swarm-003938-i47r and 4 from swarm-185245-5cu7: 20/30 from three trading runs.
Across all events the four largest families contribute 670/1,364 (49.1%).
This is an event-weighted sample, not a room-weighted estimate; no binomial CI
pretending those deliveries are independent is reported.

The remaining ten events are not all non-trading: tennis, esports/crypto and
weather trading account for four of them. A post-hoc classification of the full
primary room topics, retained as `strata.json`, gives trading **24/30** (4 REFRAME,
13 UNBLOCK, 6 BOTH, 1 OTHER) and non-trading **6/30** (0 REFRAME, 3 UNBLOCK,
0 BOTH, 3 OTHER). Thus non-trading reframe-involved is **0/6**, a small descriptive
stratum of UI/hub/research-tooling work, not a general estimate of research-room
steering. Neither rater independently audited this stratum definition.

By logged source role, the hand-labelled sample is:

| Source | n | Reframe | Unblock | Both | Other |
| --- | ---: | ---: | ---: | ---: | ---: |
| Human chat | 6 | 0 | 2 | 0 | 4 |
| Chair chat | 13 | 1 | 10 | 2 | 0 |
| Inbox note/correction | 11 | 3 | 4 | 4 | 0 |

Notes can relay owner instructions; their author role is not their ultimate
source. Human chat also includes thanks and acknowledgments under the inherited
detector. Names are recognized across all supplied logs as in `steer-count`:
historical `chair-claude` and `maintainer` names appear with different roles in
different rooms. Board decisions outside inbox keys, tool-side steering not
logged as chat, and unjoined humans can be missed. No causal benefit, answer
quality, timing of intervention effectiveness, or training target is measured.

`this-room.json` is a separate, growing-log snapshot of this RSI room, captured
around 19:56 UTC on 29 Oct 2026: 2,670 parsed events, 8 chair chats, zero human
chats. Its text cues are 6 unblock and 2 other. No manual annotation or population
comparison is claimed for this incomplete sample. Its input hash is retained.

## Board and research provenance

Room: `swarm-193427-ztnx-room`. The rubric was written before labels as
`decision/steer-split-rubric` at 19:48 UTC; the author-label hash was posted at
19:50 UTC. `audit/steer-split-blind10` records the verifier's original reasons;
`evidence/steer-split-agreement` reports the raw disagreements.

Five strong examples selected by the author from the frozen 30 are verbatim on
`result/steer-split-top5/1` through `/5`, with room, original ID and source event:

1. Sample 14, swarm-130459-mrw4-crypto: websocket delay is in the recorder.
2. Sample 26, swarm-210319-js47-engine: replay selects the worst fill class.
3. Sample 2, swarm-185245-5cu7-rebuild: calibrate a fill simulator first.
4. Sample 17, swarm-130459-mrw4-esports: conflicting gross/net chart evidence.
5. Sample 16, swarm-210319-js47-beat: accounting changes are not a new edge;
   investigate the observed queue behavior instead.

This ranks examples within the annotation sample, not every steer in history.
Only sample 2 of these five is in the blind audit, where both raters call it BOTH.

Read [DeepRewind section 3](https://arxiv.org/html/2609.36344v1) and its
[monitor implementation](https://github.com/AmirAbaskohi/DeepRewind/blob/8e5b509af0abe35e2c33243f6a584197fc8f8ab8/src/open_deep_research/world_model_monitor.py).
The distinction between evidence invalidating a commitment and repairing a plan
informs the rubric. No code or runtime graph controller is imported (MIT licence
read at the pinned commit). Board sources: `sources/arxiv-2609-36344` and
`sources/gh-deeprewind-monitor`.

## Validation scope

The fixture regression failed with a missing module before implementation and
passes with seven eligible events afterward. `npm run build`,
`npx tsc -p tsconfig.scripts.json`, and the smoke check on port 7889 pass
(`SMOKE OK`). This adds a retrospective CLI; hub behavior is unchanged.

The regression is registered in the offline suite. `review-suites.ts` selects
seven reached suites including those depending on the offline registry. Four
pass; three fail under the seat sandbox at process-table inspection:
`baseline-freeze-guard-regression.ts`, `seat-prompt-argv.test.ts`, and
`pool-suite-view.test.ts`. Each reproduces the same failing cases at the unchanged
base 3c32722c in a temporary archive; its build passes. Tests were not changed to
hide these failures. The board's `friction/steer-split-validation-sandbox` records
commands and retained outputs. This does not constitute a green full-suite claim.
