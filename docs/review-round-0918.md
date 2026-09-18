# Review round, 2026-09-18: how seats review each other, and lean Claude seats

The maintainer's concern: outside the swarm the pipeline is prompt, prior-art agent, plan, build, devkit review; inside it seats assign each other work and commit, and nobody reviews. Three rooms on Claude Code seats (Sonnet), all VERIFIED; main went from 3977211 to a54794e. Records: Targets on `done-means-independently-verified` and `token-cost-is-resent-context`.

| Room | Seats | Task | Outcome |
|---|---|---|---|
| swarm-100622-6jdx | 10, read-only | How should seats review each other's work | prop_62e25898 v4, 8/10 supermajority |
| swarm-102347-phin | 6, write | Build ranks 1 to 3 | 6d84298, 6/6 |
| swarm-102357-g062 | 5, write | Launch Claude seats lean | e097d30, 5/5 |

## What the research room found

`verifiedBy()` checked who wrote a verify entry and never what it said: 3 of 37 entries in one run called themselves PARTIAL, BLOCKED or NOT GREEN and passed the gate. Volunteered review concentrated 5 of 8 verify entries on one seat. Commit 15d3717 froze new quality baselines in the same commit as the growth they excuse. The morning's design-level defects were caught only by a seat reading the diff while the regression suite was green; 0 of 3 real defects were devkit-shaped and 0 of 58 verify entries mention a size or fan-out finding, so devkit and peer review catch near-disjoint failures and neither replaces the other. devkit's deterministic bundle costs about 2.4 seconds and no tokens per commit; its real cost is the author's retry turns, and its duplication check did not run on any of 12 observed commits.

## Built

1. A verify entry counts only with a JSON first line `{proposal, command, cwd, exit_code, output_tail, commit?}`, exit code 0 and the exact proposal id; refusals state the head to write; the dashboard shows the parsed verdict.
2. The hub assigns a reviewer when a claim is taken (least-recently-verifying active non-owner, never the same session), tells both, prefers that reviewer's entry, falls back when they leave; shown in the People tab.
3. A commit touching `.devkit/baselines/**` or `.devkit/config.json` needs a `verify/baseline-*` entry by another seat naming the staged tree; hub unreachable fails closed; the maintainer's override is `CHATROOM_BASELINE_FREEZE_OVERRIDE`, which seats cannot inherit.

Review inside the build room found two bugs by diff-read with tests green: the reviewer notice was a system line a held wait never woke for, and a claimant's second identity could be assigned as their own reviewer, deadlocking the claim.

Not built: rank 4 (diff-read required on shared paths such as `src/hub.ts`), rank 5 (devkit's size, fan-out and duplication bundle once on the integration branch instead of per commit). Dropped: a prior-art step, for lack of a source or a measurement; devkit's `priorArtGate` exists if evidence appears.

## Lean Claude seats

Every `claude -p` seat is built by `src/claude-args.ts`: `--tools` restricted to the role's built-ins, `--disable-slash-commands`, `--setting-sources project`, `--exclude-dynamic-system-prompt-sections`, `--output-format json` always (recruits now report usage). `--claude-full` / `CHATROOM_CLAUDE_FULL=1` opts out. `--bare` is excluded: it never reads the subscription login. First-turn context on Haiku probes fell from 27.2K to 20.7K (about 24%, one probe per combination, 2 to 3K noise). The maintainer ran one real lean seat through `claudeArgs()` against the live hub; it called a chatroom tool and answered correctly.

## Cost of the day, worker seats, from session transcripts

| Room | Seats | Turns | Tokens processed | Per turn | API-price cost (all seats) |
|---|---|---|---|---|---|
| Token research (morning) | 10 | 805 | 115.6M | 144K | n/a |
| Telemetry | 2 | 237 | 38.2M | 161K | n/a |
| Quorum and leave | 3 | 517 | 103.1M | 199K | n/a |
| Token build | 7 | 1,324 | 272.8M | 206K | n/a |
| Review research (held waits) | 9 | 451 | 53.6M | 119K | 22.34 USD |
| Review build | 5 | 960 | 233.3M | 243K | 70.97 USD |
| Lean seat build | 4 | 385 | 64.7M | 168K | 21.99 USD |

About 880M tokens, 98 to 99% of it cache reads. Held waits halved a research room. Build rooms did not get cheaper: a long Claude session's context only grows, and there is no handoff or compaction for Claude seats. None of these rooms ran with the lean launch; the next one is the first.

## Open

Votes carried across amendments: an agree survives every amendment that leaves its quoted clause intact, so swarm-102347-phin stood at v7 with two agrees cast at v1 until the maintainer asked for a re-vote, and concluded with two of six still stale. Proposal: carried agrees stop counting toward the threshold, a cheap re-confirm for small amendments, a settle window for rapid amenders. Ranks 4 and 5. Context growth in Claude build seats. Quiet messages still unused.
