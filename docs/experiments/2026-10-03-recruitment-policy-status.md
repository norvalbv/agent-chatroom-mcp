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
keeps repeated status reads compact. The full suite exposed two VM fixture loaders that did not yet load the new
pure helper. Commit `4e4f2387` adds that real dependency without changing OS mocks
or spawn assertions; an independent reviewer reproduced fail-before/pass-after
for both suites. The subsequent full-suite run hit the separately reproduced
`pool-run.test.ts` timestamp collision; merged-tree validation must include its
reviewed fixture correction before landing.

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

## Live results

Three clean pairs ran sequentially on private ports 38730 and 38731. Every room
used three Claude Opus 5.5 seats, including its verifier. All eighteen initial
provider requests have explicit zero cache reads with their initial context
present in the traces; all reported subsequent cache reads and writes were also
zero. The prompt, oracle, pins and cap were identical across arms. The served
entry and complete `dist/` hashes, room names, trace hashes, first-request usage,
per-tool counts and full provider usage are committed in
`docs/measurements/recruit-policy-{base2,base3,base4,head1,head2,head3}.json`.

| Pair / arm | Model turns | All tools / hub tools | Cost USD | USD / model turn | Conclusion seconds | Strict oracle | Facts |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1 / base | 59 | 71 / 44 | 8.074795 | 0.136861 | 78.429 | fail | correct |
| 1 / head | 32 | 44 / 42 | 3.319626 | 0.103738 | 39.282 | pass | correct |
| 2 / base | 64 | 78 / 48 | 9.435470 | 0.147429 | 81.354 | pass | correct |
| 2 / head | 33 | 43 / 42 | 3.353686 | 0.101627 | 59.170 | pass | correct |
| 3 / base | 53 | 60 / 39 | 7.254356 | 0.136875 | 110.921 | fail | correct |
| 3 / head | 34 | 45 / 43 | 3.577708 | 0.105227 | 43.343 | fail | correct |

Both arms made the correct staffing decision in every room, and neither arm
attempted recruitment. The strict frozen oracle passes one baseline and two
candidate runs. Its three failures are formatting failures: a correct JSON
object followed by explanatory prose instead of a wholly JSON board value. The
separate facts column is a **post-hoc diagnostic**, parsing the initial JSON
object; it does not replace or loosen the frozen oracle. These formatting
differences do not establish improved recruitment judgment.

The supported effect is lower information-gathering effort on this brief. Mean
room cost fell from $8.254874 to $3.417007; mean model turns from 58.667 to 33;
mean tool calls from 69.667 to 44; and mean conclusion time from 90.235 to 47.265
seconds. Cost per model turn, computed as total dollars divided by total turns
within each arm, was $0.140708 versus $0.103546. Each candidate arm cost less than
its paired baseline. Baseline seats inspected the HTTP policy, process environment
and local source; candidate seats used `room_status`, sometimes checking the
environment too. Non-hub tool calls totaled 78 versus 5, while hub calls were
131 versus 127. Model turns and costs cover the complete seat sessions, including
closing output; conclusion time measures room creation to its recorded decision.

This is a small, synthetic staffing-decision trial, with all prompt caching
disabled throughout. It does not estimate costs under normal warm caches, show
that a needed specialist gets useful work done, or establish more spontaneous
recruitment. Agents shared the host and could inspect local configuration; the
baseline successfully used that fallback. There is no evidence here that the
baseline lacked the judgment needed to make the correct choice.

The earlier pilot `swarm-205502-srzq-room` is excluded and retained separately as
`docs/measurements/recruit-policy-base1.json`. Its runner exposed the candidate
checkout through `BENCH_SOURCE`, and a baseline seat read that source. The clean
runner removes the variable from child environments and uses a fresh, neutrally
named workspace for every arm. No clean baseline tool input referenced the
candidate checkout path. The pilot's cost and outcome are excluded from all
comparisons above.

## Reproduction

`scripts/recruitment-policy-bench.mjs` is the runner used for the clean arms; it
starts the selected build's hub, runs the committed brief with the fixed pins,
records build hashes and usage, invokes the frozen oracle, and stops only its
own launcher and hub PIDs. For example, after building each checkout:

```sh
BENCH_SOURCE="$PWD" node scripts/recruitment-policy-bench.mjs /path/to/base base2 38730 31daae67
BENCH_SOURCE="$PWD" node scripts/recruitment-policy-bench.mjs "$PWD" head1 38731 fa01036f
```

Audit each recorded run directory with `scripts/swarm-tool-usage.py --run-dir
<run> --discover-claude --expected-seats 3 --require-cold-start`. The experiment
used the analyzer at `70c08f97`; raw provider transcripts remain local, identified
by SHA-256 in the committed measurements. Total model turns sum its per-seat
`request_cache.provider_requests`; tool totals sum its per-seat call counts.

## Refused requests must not announce a recruit

During the separate liveness trial, `opus-2` observed a refused away-seat
replacement still posting that the policy-pinned recruit had launched (room
message #479). `Spawner.request` emitted that notice before replacement
registration could reject the request. The correction moves it after the entire
request succeeds and describes the resolved request as **accepted**, which also
avoids claiming a process launched in dry-run mode. Replacements already reject
multi-count requests before registration; no new gate was added.

The focused replacement suite fails two of five cases before this correction
(at `bd80c437`) and passes all five after it: refusal leaves both the recruit
records and announcements empty; an accepted pinned request emits one accurate
notice. The existing recruitment-status suite, build and script typecheck also
pass. This is a deterministic correction to a live-observed false statement; no
additional autonomous-behavior or cost improvement is claimed. The six policy
trials above made zero requests and do not exercise this follow-up.
