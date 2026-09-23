# Reuse survey: what open source already does (2026-09-23)

Question from the owner: are we reinventing the wheel, and what could be taken from existing open-source projects instead?

Method: workflow `reuse-survey`, 8 Opus 5.5 agents, about 44 minutes. Six researchers each surveyed one component (coordination, eval harness, task curation, verification, cost telemetry, isolation) against live GitHub, package registries and docs; a synthesiser wrote a per-component plan against this repo; a skeptic re-checked every claim the plan rests on with the gh API, clones, docs and local probes. The full structured result is in [reuse-survey-2026-09-23.json](reuse-survey-2026-09-23.json). Open follow-ups are tracked in [todo/](../todo/).

## Acted on the same day

- Per-run repositories for pool runs (`isolatedRepo` in scripts/pool-format.ts). Built from a `git archive` export, not a clone with refs dropped: the skeptic showed a cloned repo still resolves the other run's commits after its refs are deleted.
- Curation gate reruns every hidden test 3 times at base and 3 times with the reference fix and rejects flaky items; `--suite` runs the existing suite with the reference fix applied.
- Claude seats take their prompt on stdin (scripts/seat-prompt-argv.test.ts). Codex and OpenRouter seats still take it in argv; see todo/.

## Verdict

Short answer: yes for the plumbing, no for what the repo is actually about. The code that open source replaces well is small: a 2-row price table, a few shell-guard regexes, a log-parsing regex, some per-vendor launch flags, and checks we have not written yet (flaky reruns, a suite check at curation, mutation testing, a fails-at-base rule). Nearly all of the code is the decision layer, and nobody surveyed has built it: src/hub.ts alone is about 3,400 of src/'s 8,400 lines. The projects that would replace large parts of the system each fail on something concrete. Harbor would switch harness in the middle of a pre-registered study. MCP Agent Mail carries a licence rider. Gas Town and Microsoft Agent Framework have an orchestrator or coordinator decide who acts and no decision layer.

What only we have:
1. The decision protocol. Proposals are documents amended in place. A challenge must quote the text it disputes, and an amend that removes the quoted span answers it. An agree vote must quote a clause the hub finds verbatim in the current text. Openings and drafts are sealed and revealed together. A stale-send guard makes a seat read what arrived while it was writing. Being @-addressed creates a reply debt that blocks your other reads until you answer. There is one electorate snapshot, with a supermajority option and a chair veto, and the hub enforces that each human message is answered once. The hub assigns a reviewer when a claim is created. A proposal passes only with a machine-parsed verify head that names that proposal, is newer than its current text, and comes from a different connection. A challenge that carries a command is answered only by a re-run with exit 0, or by a ruling. A baseline refreeze needs a second seat's verify entry.
2. Mixed-vendor seats as peers in one room. OpenRouter API models are full MCP participants with local tools, next to claude -p and codex exec seats.
3. A seat lifecycle that knows about the room. A seat's budget matches the launcher's timeout, it heartbeats, it hands off its claims, a replacement is registered with the hub, and the hub stamps each seat's worktree on its claims. Sandbox tools only know how to kill a process.
4. The pool study's design. Items come from a repo's unbuilt backlog, so neither the fix nor the test exists anywhere in git history or on the web. That is why nothing can be mined for them, and why seats can keep WebSearch without the leakage risk that makes SWE-bench Pro V2 cut the network. On top of that: four setups on one hash-locked pool; 20 items scored at one integrated head, with a deterministic keep-earlier merge fallback; per-seat cost with killed-seat estimates and the subscription account log; a transcript audit that voids a run; and pre-registration.
5. Run-level usage rolled up across providers with explicit coverage (unknown is never $0), research joins such as budget matching across setups and accounts per regime, and seats handing off proactively on cumulative prompt tokens during a run.

What is not ours and should be taken rather than rebuilt: model prices, OS sandboxing (Claude Code's sandbox settings, sandbox-runtime, codex -s), fail-to-pass and pass-to-pass semantics, flaky reruns, mutation testing, stream usage via --include-partial-messages, and claude-swap's JSON events.

**Skeptic correction to point 2:** mixed-vendor CLI agents as peers on one MCP server is not ours alone. Concord MCP (MIT) serves Claude Code, Codex, Cursor, Gemini CLI and Grok Build from one server, and OpenAgents Workspace (Apache-2.0) does similar; see the corrections below. What stays ours is the decision layer on top.

## Plan per component

| Component | Recommendation | From |
|---|---|---|
| Coordination core and dashboard: rooms, proposals, challenges, votes, board, claims, human overseer (src/hub.ts, src/server.ts, src/ui.ts) | KEEP-OURS | MCP Agent Mail (Python original and Rust rewrite), Agent Room, ChatRoomMCP (WarrenSchultz) |
| File-level leases and a commit guard (claim/* is area-level today) | WATCH | MCP Agent Mail (design only: file-glob leases with a TTL and a pre-commit guard) |
| Pushing messages into a running turn instead of seats parking in wait_for_messages | WATCH | hcom; Claude Code cross-session inbox socket (crossSessionInbound); Codex app-server turn/steer; ChatRoomMCP hook injection |
| Seat launch for claude and OpenRouter seats (src/claude-args.ts, swarm.ts runClaude/runOpenRouter, spawner.ts) | KEEP-OURS | Agent Client Protocol with the claude-agent-acp and codex-acp adapters; Rivet sandbox-agent |
| Codex seats: prompt, usage and sandbox (swarm.ts runCodex and the codex branch in spawner.ts) | ADOPT | OpenAI Codex CLI's own `codex exec` features (stdin prompt, --json, -s), Apache-2.0; app-server later |
| Orchestrator shape: planner, sub-rooms, leads room, verifier, --flat, --apply, respawn (src/swarm.ts, src/respawn.ts) | KEEP-OURS | Gas Town, Microsoft Agent Framework, Every Code, ccswarm, Beads, AG2, CAMEL, CrewAI, LangGraph, AgentScope, MetaGPT, ChatDev, Ruflo |
| Isolation between pool runs (scripts/pool-run.ts, worktreeAt in scripts/pool-format.ts) | EXTRACT | Harbor and SWE-bench Pro V2 (a fresh environment per trial; the diff is captured and regraded on a clean checkout) |
| Adopting a harness wholesale: containers, job runner, trajectories | WATCH | Harbor (with SWE-bench Pro V2's locked agents and patch-replay regrader), CooperBench, Inspect AI with inspect_swe |
| Scoring: the existing-suite check (suite step in scoreRun, scripts/pool-score.ts) | EXTRACT | SWE-bench harness (FAIL_TO_PASS / PASS_TO_PASS semantics) |
| Curation gate (validatePool in scripts/pool-format.ts) | EXTRACT | SWE-bench-Live (repeated validation runs, suite check at validation, llm_filter criteria); Harbor's `harbor check` default-rubric.toml |
| Strength of the hidden tests: a mutation check on the lines reference.patch changes | ADOPT | StrykerJS v10 (Apache-2.0): command runner or tap-runner, with --mutate file:start-end line ranges |
| Task generation: where pool items come from | KEEP-OURS | SWE-smith, FeatureBench, R2E-Gym, SWE-rebench V2, SWE-Factory, DeepSWE |
| Verify gate (parseVerifyHead and verifiedBy in src/hub.ts, reviewer assignment) | EXTRACT | SWE-bench FAIL_TO_PASS semantics (fails at base, passes with the change); Groundhog and TestForge as small references |
| Reviewer and verifier prompts (prompts/loop.md, prompts/recruit.md) | EXTRACT | OpenHands extensions: qa-changes plugin (MIT) |
| Coverage and mutation evidence inside the verify gate | WATCH | diff-cover, StrykerJS, fast-check |
| List prices for estimated seat costs (scripts/seat-cost-estimate.ts) | EXTRACT | LiteLLM model_prices_and_context_window.json, vendored as a pinned snapshot (MIT); @pydantic/genai-prices as the TypeScript-library alternative |
| Output tokens of a seat killed mid-run (partial_usage in bench-build-runtime.ts and bench-rq1.ts) | ADOPT | Claude Code --include-partial-messages (Anthropic's cost-tracking docs) |
| Which subscription account served a run (extractSwitches in scripts/paper-account-regime.ts) | ADOPT | claude-swap `cswap auto --json` events (MIT; already the switcher we use) |
| Per-seat and per-room usage attribution (scripts/claude-room-usage.py, the time-join in paper-account-regime.ts) | WATCH | Claude Code's built-in OpenTelemetry export (claude_code.api_request events, OTEL_RESOURCE_ATTRIBUTES, user.account_uuid); ccusage |
| OS isolation for claude seats (the --settings JSON built in src/claude-args.ts) | ADOPT | Claude Code's built-in sandbox (sandbox.* settings; the engine underneath is sandbox-runtime, Apache-2.0) |
| OS isolation for OpenRouter seats (run_command in src/seat.ts) | ADOPT | @anthropic-ai/sandbox-runtime (srt), Apache-2.0 |
| Process containment and the stray sweep (pidsUnder/stopStrays in pool-run.ts, kill paths in swarm.ts) | KEEP-OURS | apple/container, microsandbox, smolvm, Docker Sandboxes, SandVault, nsjail/bubblewrap |
| One worktree per seat (workerCwd in swarm.ts, worktreeFor in spawner.ts) | KEEP-OURS | Claude Code --worktree, Codex --worktree, container-use, yoloAI |
| Outward interface: letting other orchestrators call a swarm | WATCH | A2A (Agent2Agent) protocol |

### Coordination core and dashboard: rooms, proposals, challenges, votes, board, claims, human overseer (src/hub.ts, src/server.ts, src/ui.ts): KEEP-OURS

**From:** MCP Agent Mail (Python original and Rust rewrite), Agent Room, ChatRoomMCP (WarrenSchultz)

**Changes:** Nothing. None of these has proposals, quote-checked challenges or votes, an electorate, a verify gate or human-answer enforcement. Agent Room and ChatRoomMCP do less than our join_room, send_message and wait_for_messages. Use Agent Mail only as a design reference.

**Deletes:** Nothing.

**Effort:** None.

**Risk:** Agent Mail's licence is 'MIT with OpenAI/Anthropic Rider', not plain MIT, and the rider must travel with any derivative work. Do not copy or vendor its code into this repo. Have the rider read before even running it next to Claude Code or Codex seats.

### File-level leases and a commit guard (claim/* is area-level today): WATCH

**From:** MCP Agent Mail (design only: file-glob leases with a TTL and a pre-commit guard)

**Changes:** Nothing unless a pool 2 or 3 room run records merge conflicts in final.json. Pool 1 gives no case for it: the only items lost to conflicts (the same 5 items on src/hub.ts in both repeats) were in Split, which has no hub, and Room3 and Room15 both landed 20/20. If it is needed: add an optional paths:[globs] field to the claim/* JSON, have noticeClaimOverlap flag overlapping globs, and add a pre-commit check modelled on scripts/guard-baseline-freeze.mjs that refuses commits to paths another live seat has claimed.

**Deletes:** Nothing.

**Effort:** 2-3 days, written from Agent Mail's docs, not its code.

**Risk:** The licence rider, if anyone copies code instead of working from the docs. A hard commit refusal can also deadlock a room when a claimant goes quiet, so it needs the same leave and release path that claims already have.

### Pushing messages into a running turn instead of seats parking in wait_for_messages: WATCH

**From:** hcom; Claude Code cross-session inbox socket (crossSessionInbound); Codex app-server turn/steer; ChatRoomMCP hook injection

**Changes:** Nothing now. Delivery state lives in the hub: lastSeenSeq, settleRead, withheld human messages, focusedAsk and reply debt (src/hub.ts roughly lines 990-1290). Content pushed around the hub would bypass the stale-send guard, the reply-debt gate and humans-answered-once. It is also not the cost saving the survey suggests. token-cost-is-resent-context puts cost at resident seats × wakes × about 130k context, and a push to an idle session starts a turn that resends the same context a held wait does when it returns. If it is ever tried, push only a doorbell ('call wait_for_messages') and measure wakes and input tokens against held waits on the same brief.

**Deletes:** Nothing.

**Effort:** About a 1-day spike for a Claude-only doorbell. Only worth doing once there is a measured reason.

**Risk:** hcom installs hooks under ~, which fights --setting-sources project, and becomes a second message store. The Claude socket is Claude-only, queues at most 50 messages, and holds messages for approval unless crossSessionInbound is set. Codex steer is experimental.

### Seat launch for claude and OpenRouter seats (src/claude-args.ts, swarm.ts runClaude/runOpenRouter, spawner.ts): KEEP-OURS

**From:** Agent Client Protocol with the claude-agent-acp and codex-acp adapters; Rivet sandbox-agent

**Changes:** Keep ours. claude-args.ts is 53 lines and carries the measured lean flags (--tools, --disable-slash-commands, --setting-sources project, autoMemoryEnabled:false). An ACP adapter may not pass those through, HTTP MCP is optional per ACP agent while our hub is HTTP-only, and it adds a process per seat. Needed either way, and ours to fix: OpenRouter seats still get the brief in argv (swarm.ts runOpenRouter passes '-p', text; spawner.ts around L314). That is the same pkill -f hazard ffe5a7c fixed for claude seats, so src/openrouter.ts should read its prompt from stdin. Revisit ACP when a fourth CLI vendor such as Gemini CLI or OpenCode is wanted.

**Deletes:** Nothing.

**Effort:** Hours for the OpenRouter stdin fix, plus a case in scripts/seat-prompt-argv.test.ts.

**Risk:** None in keeping ours. Adopting ACP later would risk losing the lean-flag saving (about 24% of the first turn, measured).

### Codex seats: prompt, usage and sandbox (swarm.ts runCodex and the codex branch in spawner.ts): ADOPT

**From:** OpenAI Codex CLI's own `codex exec` features (stdin prompt, --json, -s), Apache-2.0; app-server later

**Changes:** Use what `codex exec` already has; all three are in the local codex-cli 0.155 --help. (1) Send the prompt on stdin instead of as a positional argument, which closes the argv and pkill gap for codex seats. (2) Pass --json and write turn.completed usage to <name>.usage.json. runCodex already reads that file but nothing writes it, so every codex seat's usage is null and runs with codex seats report coverage 'partial'. (3) Pass -s read-only to read-only seats. ~/.codex/config.toml sets sandbox_mode=danger-full-access and approval_policy=never, and neither launcher passes -s, so codex seats run unsandboxed today. Leave write seats as they are, or wrap them in srt: workspace-write keeps the worktree's gitdir read-only, so those seats could not commit. Watch app-server's item events and turn/steer as the later heartbeat and steering path. Nothing in this repo uses the removed `codex mcp-server`.

**Deletes:** args.push(text) in runCodex, args.push(prompt) in spawner.ts, and the permanently 'partial' usage coverage on codex runs.

**Effort:** About half a day with tests: an argv test and a recorded --json fixture.

**Risk:** Unverified whether turn.completed usage is per turn or cumulative. Codex reports no USD, so it needs the price table, and gpt-6-sol and gpt-6-astra have a >272K-input tier. The -o final-text file must keep working alongside --json.

### Orchestrator shape: planner, sub-rooms, leads room, verifier, --flat, --apply, respawn (src/swarm.ts, src/respawn.ts): KEEP-OURS

**From:** Gas Town, Microsoft Agent Framework, Every Code, ccswarm, Beads, AG2, CAMEL, CrewAI, LangGraph, AgentScope, MetaGPT, ChatDev, Ruflo

**Changes:** Nothing. In Gas Town and Microsoft Agent Framework a coordinator or orchestrator decides who acts. Every Code and ccswarm fan work out and merge it with no peer discussion. The frameworks run in-process API agents and cannot seat claude -p or codex exec processes. Beads would move claims outside the hub, where the electorate, reviewer assignment and the leave-with-claim refusal cannot see them. Keep Gas Town's Refinery (a batched, bisecting merge queue) as the reference if --apply ever has to land several verified branches at once.

**Deletes:** Nothing.

**Effort:** None.

**Risk:** None in keeping ours. Adopting any of these means weeks of work, often a language change, and losing the decision layer.

### Isolation between pool runs (scripts/pool-run.ts, worktreeAt in scripts/pool-format.ts): EXTRACT

**From:** Harbor and SWE-bench Pro V2 (a fresh environment per trial; the diff is captured and regraded on a clean checkout)

**Changes:** Take the idea, not the stack. Today every seat worktree and every room works in a worktree of the pool's one real repo, and nothing deletes run branches: this repo now holds 34 pool/* and pool-final/* branches, dry runs included. I checked pool 1's repeat-2 transcripts. A room3-rep2 seat ran `git branch -a` and got pool/hub/room3-rep1/integration back. Two room15-rep2 seats got `git worktree list` output naming room15-rep1's worktree and branch. I found no checkout or diff of a repeat-1 branch, so this is exposure, not proven use, but auditRun only searches for the hidden root and hidden test file names, so it could not flag it. Change: pool-run creates a per-run repository that holds only base_commit's history (clone and drop every other ref, or git init plus a fetch of the base commit). Seats and the room's --cwd work inside it, and run.json.repo points at it so finalize and score read branches there. node_modules still links from the pool repo. Add needles to auditRun for pool/, pool-final/ and other runs' swarm ids, and flag git log --all, git branch -a and git worktree list calls. Record the pool 1 repeat-2 exposure as a deviation.

**Deletes:** worktreeAt(pool.repo, ...) as the seats' checkout on the run path, and the pool/* branches that pile up in the real repo.

**Effort:** Half a day to a day, with a pool-e2e.test.ts case asserting that a second run cannot see the first run's refs.

**Risk:** Fetching a commit by SHA from a local repo may need protocol v2 or uploadpack.allowReachableSHA1InWant, so test which applies. swarm.ts puts room worktrees under <cwd>/.swarm-worktrees, which works inside a clone, but pool-run's session-to-seat matching by cwd must follow the new paths. The pre-registration says 'fresh git worktrees of the pool's repo at base_commit'. A per-run clone keeps the intent, so record it before pool 2 runs.

### Adopting a harness wholesale: containers, job runner, trajectories: WATCH

**From:** Harbor (with SWE-bench Pro V2's locked agents and patch-replay regrader), CooperBench, Inspect AI with inspect_swe

**Changes:** Not during this study. Pool 1 ran on this harness, and pools 2 and 3 are pre-registered with the same setups and measures, so switching harness between pools would change the environment mid-study. After pools 2 and 3: consider an exporter from pool.json to Harbor tasks plus one custom agent for the split and room arms, and register a room as a CooperBench external agent to get a published solo-vs-coop baseline. Skip inspect_swe for now: it routes Claude Code through Inspect's own provider, so seats bill the API, not the subscription, which breaks our cost basis.

**Deletes:** If adopted later: most of pool-run.ts's process control and stopStrays, and the scoring half of pool-score.ts.

**Effort:** 2-4 days for Harbor: Docker is installed here, but it needs a Dockerfile per repo, an OAuth token inside each container, and 15 seats in one container or as sidecars. 1-2 days for a CooperBench adapter.

**Risk:** Doing it mid-study breaks comparisons across pools. 15 seats in one container need resource tuning and still hit subscription rate limits. Harbor has no transcript audit. CooperBench is built around pairs of features and messaging over Redis.

### Scoring: the existing-suite check (suite step in scoreRun, scripts/pool-score.ts): EXTRACT

**From:** SWE-bench harness (FAIL_TO_PASS / PASS_TO_PASS semantics)

**Changes:** Keep the pre-registered measure (suite_cmd exits 0 at the final head) and report a PASS_TO_PASS view next to it. Run suite_cmd at base_commit once per pool, during validate, and record per-command results. At score time, report which commands passed at base but now fail, and which have disappeared. The hub pool needs no parser, because scripts/offline-runner.mjs prints '[offline] FAILED <name>' for each failing command; vitest repos can use --reporter=json. This shows whether pool 1's suite failures were red at base or introduced by the setup: Split rep2's four failed commands, and the blind-drafts regression Room3 rep2 shipped.

**Deletes:** Nothing.

**Effort:** About a day, including pool-score.test.ts cases.

**Risk:** This is a secondary measure added after pool 1, so it must be labelled as not pre-registered. Command names must stay stable between base and head.

### Curation gate (validatePool in scripts/pool-format.ts): EXTRACT

**From:** SWE-bench-Live (repeated validation runs, suite check at validation, llm_filter criteria); Harbor's `harbor check` default-rubric.toml

**Changes:** Do this before pools 2 and 3 are curated; only pools/hub exists so far. (a) Run the hidden command 3 times at base and 3 times with the reference fix, and reject any item whose result changes (flaky). (b) Run suite_cmd with reference.patch applied, and reject items whose reference fix breaks the existing suite. (c) Copy Harbor's rubric criteria into the curator prompt, or into one LLM pass per item: does the brief describe everything the test checks, does the test check everything the brief asks, and how hard is it to cheat. (d) Check that the item fails at base for the right reason: keep the base run's output and reject a failure that is only a missing-module import error.

**Deletes:** Nothing.

**Effort:** A few hours of TypeScript for (a), (b) and (d). A few hours plus one model call per item for (c).

**Risk:** Tripling the runs slows validation on slow suites. The LLM check can wrongly reject items, so treat it as a flag for a human look, not a veto. The amendment already fixes the item criteria; these are stricter gates, and should be recorded before curation, not presented as changes to the measures.

### Strength of the hidden tests: a mutation check on the lines reference.patch changes: ADOPT

**From:** StrykerJS v10 (Apache-2.0): command runner or tap-runner, with --mutate file:start-end line ranges

**Changes:** An optional validate step. With reference.patch applied, mutate only the lines it changed and run the item's hidden command against each mutant. A mutant that survives means the hidden test would accept a wrong fix, so the curator strengthens the test. This targets the 'lax test' failure CoHarden reports for tests written together with their own fix, which is how our curator writes items. StrykerJS has no --since option, so a roughly 40-line helper turns patch hunks into --mutate ranges.

**Deletes:** Nothing.

**Effort:** About a day.

**Risk:** The command runner reruns the whole hidden command for every mutant, which is slow for slow items. Equivalent mutants add noise. Needs Node 22 or later. Use it to flag items, not to reject them automatically.

### Task generation: where pool items come from: KEEP-OURS

**From:** SWE-smith, FeatureBench, R2E-Gym, SWE-rebench V2, SWE-Factory, DeepSWE

**Changes:** Nothing. These tools mine merged PRs or commits, plant bugs against tests the builders can already see, or mask existing features. In our setup, an item mined from the repo's own history leaks its answer through git log in the seat's worktree. Planted single-site bugs are also the easy item shape that pool 1 already maxed out on. DeepSWE's item schema matches ours, but it ships no authoring tool.

**Deletes:** Nothing.

**Effort:** None.

**Risk:** None in keeping ours. For reference, SWE-Factory is AGPL or commercial, and FeatureBench and R2E-Gym are Python-only.

### Verify gate (parseVerifyHead and verifiedBy in src/hub.ts, reviewer assignment): EXTRACT

**From:** SWE-bench FAIL_TO_PASS semantics (fails at base, passes with the change); Groundhog and TestForge as small references

**Changes:** Keep the gate itself: the verify entry must come from someone other than the author, name the exact proposal, be newer than its current text, and come from the assigned reviewer while that reviewer is present; executable challenges also stay. No surveyed project enforces acceptance this way. Extract the fail-before/pass-after rule in two stages. Stage 1, with the hub running only git: add base_exit_code (must be non-zero) and make commit required in VerifyHead. The hub checks that the commit resolves in the room's repo and descends from the room's recorded codeState. Re-running the author's unchanged tests will usually pass at base too, so that kind of head cannot honestly claim base_exit_code != 0. Allow an explicit exemption kind for refactors, which have no failing-before state. Stage 2: the hub, or a trusted runner, re-executes the command at base and at the commit in throwaway worktrees. That is exactly the condition the 2026-09-23 owner decision on consensus-requires-scrutiny names for revisiting the mandatory challenge ('checks the author cannot satisfy with their own evidence'), so it needs its own decision record and a sandbox first. Per done-means-independently-verified, the prompts, tool descriptions, refusal text, smoke and replay scripts change in the same commit, and both SKILL.md copies change with them.

**Deletes:** Nothing is removed. VERIFY_HEAD_EXAMPLE and verifyHeadRefusal are rewritten.

**Effort:** Stage 1: 1-2 days, including updates to scripts/verify-verdict-regression.ts and scripts/reviewer-assignment-regression.ts. Stage 2: 2-3 days, plus a decision record and a sandbox.

**Risk:** Stage 1 is still self-reported: it makes a false head more costly to write but cannot prove one is true. Refactor exemptions become the new loophole. Stage 2 runs commands that seats supplied, from the hub process, so it must not ship unsandboxed.

### Reviewer and verifier prompts (prompts/loop.md, prompts/recruit.md): EXTRACT

**From:** OpenHands extensions: qa-changes plugin (MIT)

**Changes:** Port its rule 'do not re-run the suite; exercise the changed behaviour like a user' and its 'Unable to Verify' section into our verifier and reviewer prompts. Add an optional kind field (existing_tests | own_check | exercised) to the verify head, matching the classes scripts/paper-verify-practice.ts already counts: 126 of 260 heads re-ran the author's existing tests. Do not copy the Claude Code code-review plugin's prompt text; its licence is proprietary.

**Deletes:** Nothing.

**Effort:** Hours, plus the prompt regression checks and both SKILL.md copies.

**Risk:** This is prompt-only guidance, and a self-declared kind can be gamed. The census shows prompts alone still left 48% of heads as re-runs, so pair this with Stage 1 of the verify gate; it is not a fix on its own.

### Coverage and mutation evidence inside the verify gate: WATCH

**From:** diff-cover, StrykerJS, fast-check

**Changes:** Nothing until the hub or a trusted runner executes checks (Stage 2 of the verify gate). A coverage or mutation number that the seat reports about itself gives the hub nothing it can check. Reviewers can use fast-check today as their own check, with the seed in output_tail so a challenger can replay the same counterexample.

**Deletes:** Nothing.

**Effort:** 1-2 days for each tool once Stage 2 exists.

**Risk:** Most of our regression scripts just exit 0 or 1 and do not print TAP, so Stryker's command runner would rerun whole scripts for every mutant; npm test runs 49 commands, far too slow without limiting the mutated lines. Measuring coverage of TypeScript loaded through tsx, including child hub processes, needs NODE_V8_COVERAGE, and source-map support is unverified.

### List prices for estimated seat costs (scripts/seat-cost-estimate.ts): EXTRACT

**From:** LiteLLM model_prices_and_context_window.json, vendored as a pinned snapshot (MIT); @pydantic/genai-prices as the TypeScript-library alternative

**Changes:** Replace the hand-kept two-row table with rows from a pinned snapshot, and price cache writes by their TTL (usage.cache_creation.ephemeral_1h_input_tokens at the 1-hour rate). This fixes two defects I confirmed. (1) Sonnet 5 cache writes are priced at $2.50/MTok, but all 753 claude-sonnet-5 model_usage entries in bench/results reproduce the CLI's costUSD exactly at $4.00, and none do at $2.50. (2) The table has no claude-opus-5-5 row, and every pool seat is Opus 5.5. A seat killed at the deadline therefore gets cost_usd null (pool-run.ts:185, 'no list-price row'), and scoreRun then reports cost null for the whole solo or split run. Pool 1 finished within 12 minutes, so no seat was killed. The harder items in pools 2 and 3 make deadline kills likely.

**Deletes:** CLAUDE_LIST_PRICE_PER_MTOK and the regex matching in priceEntryFor. Keep estimateSeatCost's per-message-id deduplication and its rule that unknown cost is null, never 0.

**Effort:** Hours, including tests that reproduce known CLI costUSD values from bench/results.

**Risk:** Model keys vary by provider prefix, and the us./eu./global. variants carry a premium. genai-prices counts cache tokens inside input_tokens while Anthropic does not, so passing our usage straight through would misprice. I did not confirm that genai-prices has an Opus 5.5 row; the survey saw one in LiteLLM's JSON. Pin the snapshot so the paper's figures stay reproducible.

### Output tokens of a seat killed mid-run (partial_usage in bench-build-runtime.ts and bench-rq1.ts): ADOPT

**From:** Claude Code --include-partial-messages (Anthropic's cost-tracking docs)

**Changes:** Add --include-partial-messages when claude-args.ts builds a stream-json seat. Take each message's output count from its last message_delta usage instead of summing output_tokens from assistant events, which the docs call a placeholder. First run a probe: kill one short seat mid-run and compare the two counts.

**Deletes:** The code in both stream loops that sums output_tokens from assistant events.

**Effort:** Hours, plus a test fixture.

**Risk:** transcript.jsonl gets much larger for every seat. Subagent usage is still missing. The placeholder claim rests on the docs plus one killed seat that recorded 16 output tokens across 4 messages.

### Which subscription account served a run (extractSwitches in scripts/paper-account-regime.ts): ADOPT

**From:** claude-swap `cswap auto --json` events (MIT; already the switcher we use)

**Changes:** Parse claude-swap's JSON switch events, which carry a schema version and a UTC timestamp (present in the local clone's autoswitch.py), instead of the regex over human log lines that reads timestamps as machine-local time. Keep the regex for existing logs.

**Deletes:** The regex becomes a fallback for old logs only.

**Effort:** Hours.

**Risk:** Unverified whether a manual `cswap switch` also emits an event. The account reference probably includes the email, so reduce it to slot numbers as the sanitised paper log requires. The macOS Keychain cache means a running process picks up a switch late, so any time-based join stays approximate.

### Per-seat and per-room usage attribution (scripts/claude-room-usage.py, the time-join in paper-account-regime.ts): WATCH

**From:** Claude Code's built-in OpenTelemetry export (claude_code.api_request events, OTEL_RESOURCE_ATTRIBUTES, user.account_uuid); ccusage

**Changes:** After a probe: set OTEL_RESOURCE_ATTRIBUTES=seat.name=...,room=...,run.id=... in seatChildEnv, and add a POST /v1/logs route on the hub that sums api_request cost per seat into the existing usage sidecar. That would replace the transcript regex in claude-room-usage.py and record the serving account on every request instead of inferring it from switch times. Skip ccusage: it only knows sessions, not seats or rooms.

**Deletes:** Later: scripts/claude-room-usage.py and the accountAt time-join.

**Effort:** 1-2 days.

**Risk:** Log events are batched every 5 seconds, so a killed seat can lose its last batch. Unverified: whether Claude Code flushes on SIGTERM, and whether user.account_uuid changes when claude-swap switches accounts under a running process. Never use the console exporter: it writes to the stdout we parse.

### OS isolation for claude seats (the --settings JSON built in src/claude-args.ts): ADOPT

**From:** Claude Code's built-in sandbox (sandbox.* settings; the engine underneath is sandbox-runtime, Apache-2.0)

**Changes:** After a probe, merge a sandbox block into the --settings JSON that claude-args.ts already builds: enabled:true, allowUnsandboxedCommands:false, failIfUnavailable:true, a network allowlist for npm, GitHub and the hub port, and allowLocalBinding for dev hubs. Under the sandbox, signals only reach processes in the same sandbox, so a seat's pkill or killall could not reach the hub, the launcher or other seats. That is a second guard against the room15-rep2 kill, one that does not rely on prompts staying out of argv. For read-only seats, add denyWrite on the cwd; today read-only is enforced only by the prompt, because READ_TOOLS includes Bash.

**Deletes:** Nothing.

**Effort:** Half a day to a day, including a regression test in the style of seat-prompt-argv.test.ts: a sandboxed seat running pkill against a sibling process must get EPERM.

**Risk:** Probe these first. Does the sandbox apply under -p? Is 'same sandbox' scoped per Bash call? If so, a seat could not later kill a dev hub it started in an earlier call, which devHubRule tells seats to do. Can commits from a worktree still write the shared .git while .git/config stays protected? The sandbox covers Bash only, not Edit, Write or MCP tools, and gh and docker need excludedCommands.

### OS isolation for OpenRouter seats (run_command in src/seat.ts): ADOPT

**From:** @anthropic-ai/sandbox-runtime (srt), Apache-2.0

**Changes:** Wrap sh() in seat.ts with SandboxManager.wrapWithSandbox, using a per-seat config: writes allowed to the worktree for --write seats, and nowhere for read-only seats. The LETHAL, MUTATING and GITCONFIG regexes stay, as friendly refusal messages over a real OS boundary rather than being the boundary themselves.

**Deletes:** Nothing is removed; the regexes become advisory.

**Effort:** About a day, plus a regression test.

**Risk:** It is a beta research preview, so its config format may change. macOS cannot nest Seatbelt profiles, so do not also wrap a whole claude or codex seat in srt while that seat's own sandbox is on. The hub port must be allowlisted explicitly. It does not contain setsid'd background jobs, so the stray sweep is still needed.

### Process containment and the stray sweep (pidsUnder/stopStrays in pool-run.ts, kill paths in swarm.ts): KEEP-OURS

**From:** apple/container, microsandbox, smolvm, Docker Sandboxes, SandVault, nsjail/bubblewrap

**Changes:** Keep the lsof-cwd sweep. macOS has no PID namespaces or cgroups. The VM options run a Linux guest, which breaks the node_modules symlink, Claude's Keychain OAuth and reaching the hub on loopback, and a 15-seat room would mean 15 VMs. One change of our own: reuse pool-run's stopStrays in plain swarm.ts's timeout and SIGTERM paths. Those only c.kill() direct children today, so a dev hub a seat detached can outlive a `node dist/swarm.js` run.

**Deletes:** Nothing.

**Effort:** Hours for the swarm.ts sweep.

**Risk:** The sweep matches processes by cwd, so a process that changes directory escapes it. That is already accepted today.

### One worktree per seat (workerCwd in swarm.ts, worktreeFor in spawner.ts): KEEP-OURS

**From:** Claude Code --worktree, Codex --worktree, container-use, yoloAI

**Changes:** Nothing. Ours is the only approach that covers claude, codex and OpenRouter seats together. It names branches swarm/<run>/<seat>, which pool-run and --apply rely on, and gives the hub each seat's worktree to stamp on its claim/* entries. Claude's --worktree branches from the remote default branch rather than HEAD, leaves -p worktrees locked, and its docs do not say its main-checkout write blocks apply to worktrees we create ourselves.

**Deletes:** Nothing.

**Effort:** None.

**Risk:** None.

### Outward interface: letting other orchestrators call a swarm: WATCH

**From:** A2A (Agent2Agent) protocol

**Changes:** Nothing unless someone using Microsoft Agent Framework, CrewAI or ADK needs to hand a question to a room. Then write a small A2A server wrapper around swarm.ts using the JS SDK.

**Deletes:** Nothing.

**Effort:** 2-3 days if needed.

**Risk:** Neither Claude Code nor Codex speaks A2A natively, so A2A cannot connect our seats to each other.

## Skeptic check

The plan mostly holds up. Every recommended project exists, and every one the plan tells us to adopt or extract from was pushed or released in Aug–Sep 2026. The stated licences are correct, and the core capability claims check out against source code or docs. I checked with the gh API, clones of the repos, docs pages, the local codex 0.155.0-alpha.16.3 and claude 2.1.281 help, and small sandbox-exec and git probes run in the scratchpad.

Things that are wrong or overstated:
1. Harbor does have a transcript audit: `harbor analyze` runs an LLM rubric over agent trajectories that checks for reward hacking.
2. The two ACP objections are weak. Both official adapters advertise HTTP MCP, and claude-agent-acp passes settingSources, allowedTools and extraArgs through.
3. Codex turn/steer is not marked experimental in the protocol. Only the `codex app-server` subcommand is labelled experimental.
4. "Mixed-vendor CLI peers in one room" is not ours alone. Concord MCP (MIT) and OpenAgents Workspace (Apache-2.0) both do it, and Concord also offers file claims with overlap detection without Agent Mail's licence rider.
5. First step: the "clone and drop every other ref" option still leaks earlier runs. A local clone copies every object, and after deleting the refs another run's commit still resolves. Use `git init` plus a fetch of base_commit by SHA, or `git clone --no-local --single-branch`. The fetch-by-SHA worry is settled: it works with protocol v2 (git 2.50.1 here) and fails with v0.

Probes I could answer:
- The sandbox's "same sandbox" is per invocation. Seats cannot signal the hub, the launcher or each other, but a seat also cannot kill a dev hub it started in an earlier Bash call.
- Writes through the node_modules symlink are denied under a cwd-only sandbox.
- Codex `turn.completed` usage is the thread's running total, not per turn.
- A manual `cswap switch` emits no JSON event.
- genai-prices 0.1.8 on npm does have an Opus 5.5 row.
- Under Claude Code's sandbox, worktree commits can still write the shared .git, while .git/config and hooks stay write-protected (per the docs).

The local defects the plan names are all reproduced:
- 34 pool branches.
- The price table has no opus-5-5 row.
- 753 of 753 Sonnet 5 entries match the CLI's cost at a $4.00 cache-write rate, and none at $2.50.
- Codex and OpenRouter seats get the prompt in argv.
- READ_TOOLS includes Bash.

### Corrections

- **holds**: MCP Agent Mail (Python + Rust) is 'MIT with OpenAI/Anthropic Rider'; the rider must travel with derivatives and 'use' includes running it in pipelines  
  The LICENSE fetched via the gh API opens 'MIT License (with OpenAI/Anthropic Rider)'. 'Use' is defined to include 'executing ... evaluation harness, or pipeline', and any distribution 'must include this rider provision unmodified'. The Rust repo has the same header. Both repos are active (pushed 2026-09-22 and 2026-09-23). The Rust README confirms file-glob leases with a TTL, a pre-commit guard, the overseer web UI, and support for Claude Code, Codex, Gemini and Copilot.
- **wrong**: Mixed-vendor CLI agents as peers in one room are 'genuinely ours' / only three projects put Claude Code, Codex and others on one shared MCP coordination server  
  Concord MCP (Get-Concord-AI/concord-mcp, MIT, v0.10.5 released 2026-09-23, 323 stars) is one MCP server for Claude Code, Codex, Cursor, Gemini CLI and Grok Build. OpenAgents Workspace (openagents-org/openagents, Apache-2.0, 4.1k stars, launcher-v1.0.8 on 2026-09-21) connects Claude Code, Codex CLI, Gemini CLI, OpenCode, Copilot CLI and others to shared threads and files, with MCP and A2A support. Neither has proposals, votes or a verify gate. What stays distinctive is the decision protocol and OpenRouter API models taking part as full MCP seats.
- **overstated**: File-level leases: MCP Agent Mail is the reference, usable as design only because of the rider  
  Concord MCP is plain MIT. Its start_work tool 'claims ... and reports scope overlaps before editing', inspect_work flags stale claims, transfer_work does handoffs, and finish_work records evidence. It is a rider-free code reference. I did not see Agent Mail's glob TTL or pre-commit guard in its README.
- **holds**: hcom: MIT, hooks + SQLite, mid-turn injection, 30s edit-collision notice, hooks installed under ~  
  The README says 'Messages arrive mid-turn (injected between tool calls) or wake idle agents', 'two agents edit the same file within 30 seconds', and 'Hooks go into config dirs under ~/ (or HCOM_DIR)'. The gh API shows MIT, v0.7.25 (2026-08-09), pushed 2026-09-13.
- **holds**: Claude Code cross-session inbox: -p sessions bind a socket, queue cap 50, messages held for approval unless crossSessionInbound is set  
  The cross-session-messaging docs say 'Claude Code binds an inbox socket for a claude -p session like an interactive one'. Bare mode binds none. The docs give 'queues at most 50 accepted messages'. A session that bypasses permissions holds inbound messages by default, and 'To let a -p worker take messages unattended, start it with crossSessionInbound set to accept in its --settings'. An idle receiver starts a new turn, which supports the plan's cost argument.
- **overstated**: ACP: an adapter may not pass the lean flags through, and HTTP MCP is optional while our hub is HTTP-only  
  The spec does make HTTP optional (session-setup.mdx: stdio MUST, HTTP optional). But claude-agent-acp (src/acp-agent.ts:2349) and codex-acp (src/CodexAcpServer.ts:400) both advertise mcpCapabilities http:true. claude-agent-acp also accepts _meta.claudeCode.options, including settingSources, allowedTools, disallowedTools and extraArgs (acp-agent.ts:1221-1254). Keeping our own launcher is still defensible (one fewer process, a proven measured setup), but these two reasons do not hold. codex-acp's licence is Apache-2.0 © JetBrains, which GitHub reports as NOASSERTION. The zed-industries/codex-acp repo is archived, as stated.
- **holds**: codex exec supports stdin prompt, --json and -s in local 0.155; codex mcp-server removed; nothing in the repo uses it  
  The local `codex exec --help` (0.155.0-alpha.16.3) says the prompt 'If not provided as an argument (or if `-` is used), instructions are read from stdin'. It also lists --json, -s read-only|workspace-write|danger-full-access, -o and --worktree. `codex mcp-server` is not a subcommand: the top-level help lists none. A grep of src and scripts for codex mcp-server finds nothing.
- **holds**: Unverified whether codex turn.completed usage is per turn or cumulative  
  Now resolved: it is cumulative. codex-rs/exec/src/event_processor_with_jsonl_output.rs usage_from_last_total() fills turn.completed.usage from ThreadTokenUsage.total, the thread's running total, not .last. Take the last event rather than summing. Per-request prompt size, which the >272K pricing tier depends on, is not exposed. The event includes cache_write_input_tokens and has no USD field.
- **holds**: Codex seats run unsandboxed (~/.codex/config.toml danger-full-access + approval never; no -s passed); workspace-write keeps the worktree gitdir read-only so write seats could not commit  
  ~/.codex/config.toml lines 5 and 7 set approval_policy="never" and sandbox_mode="danger-full-access". Neither src/swarm.ts runCodex nor src/spawner.ts:319 passes -s. In codex-rs/protocol/src/permissions.rs:2232-2251, default_read_only_subpaths_for_writable_root resolves the worktree's .git pointer file and marks that gitdir read-only.
- **overstated**: Codex app-server turn/steer is experimental  
  In codex-rs/app-server-protocol/src/protocol/common.rs:1044, TurnSteer => "turn/steer" carries no #[experimental] attribute, unlike turn/settings/update just above it. What is labelled '[experimental]' in the local 0.155 help is the `codex app-server` subcommand as a whole.
- **holds**: Claude Code sandbox settings: enabled, allowUnsandboxedCommands:false, failIfUnavailable, network allowlist, allowLocalBinding, denyWrite; covers Bash only; gh and docker need excludedCommands  
  The settings reference lists sandbox.enabled, failIfUnavailable, allowUnsandboxedCommands, excludedCommands, network.allowedDomains, network.allowLocalBinding and filesystem.denyWrite. The sandboxing docs say it 'applies only to Bash, PowerShell, and Monitor commands' and that Read, Edit and Write go through permissions instead. Go CLIs such as gh fail TLS, and 'docker is incompatible'. The docs also settle one of the plan's probes: in a linked worktree 'the sandbox also allows writes to the main repository's shared .git directory so commands such as git commit can update refs ... Writes to hooks/ and config ... remain denied'.
- **holds**: Under the sandbox, signals only reach processes in the same sandbox, so a seat cannot pkill the hub, launcher or siblings (probe: is 'same sandbox' per Bash call?)  
  The rule is `(allow signal (target same-sandbox))` in sandbox-runtime (src/sandbox/macos-sandbox-utils.ts:978-979), Codex (seatbelt_base_policy.sbpl:13) and Safehouse. Claude Code's docs do not state it. I ran sandbox-exec probes on this Mac. Signalling an unsandboxed process gives EPERM. A second sandbox-exec with the identical profile also gets EPERM against the first. A nohup'd child from one invocation cannot be signalled by the next invocation. So the sandbox is per invocation: the cross-seat guard works, but a seat cannot kill a dev hub it backgrounded in an earlier Bash call, which breaks devHubRule. The same applies to srt-wrapped sh() calls for OpenRouter seats. Wrapping the whole seat process in srt avoids it. Separately, the Agent SDK exposes a `sandbox` option, so non-interactive use is supported. `--settings` still applies under `--setting-sources project`.
- **overstated**: sandbox-runtime (srt): Apache-2.0, beta research preview, SandboxManager.wrapWithSandbox, does not support per-exec allowWrite overrides  
  Licence, 'Beta Research Preview', wrapWithSandbox and network.allowLocalBinding are all confirmed in the README (v0.0.77, 2026-09-18). The repo has moved to anthropics/sandbox-runtime. The 'per-exec filesystem.allowWrite overrides are not supported' line appears only under the Windows 'Known limitations', not for macOS.
- **holds**: --include-partial-messages exists and per-step output_tokens on stream-json assistant events is a placeholder  
  The local `claude --help` (2.1.281) lists --include-partial-messages ('only works with --print and --output-format=stream-json'). The cost-tracking docs say 'the message's output_tokens is only the count the API had reported at message_start', and that after a crash 'neither ... output tokens or USD cost' can be recovered from assistant messages. They also note a subscription gets a 1-hour TTL on your own turns but drops to 5 minutes on usage credits, so pricing by TTL field is the right fix.
- **holds**: Claude Code OTel: claude_code.api_request carries cost_usd and tokens; user.account_uuid is on every event; OTEL_RESOURCE_ATTRIBUTES; 5 s batching; flush on SIGTERM unverified  
  monitoring-usage.md:742-760 lists cost_usd, cost_usd_micros, input/output/cache tokens, request_id and query_source. Standard attributes include user.account_uuid (default on). Custom resource attributes are 'included in all metrics and events'. OTEL_LOGS_EXPORT_INTERVAL defaults to 5000. http/json is supported and telemetry works in -p. Flush on shutdown is not documented, so it remains unverified.
- **overstated**: LiteLLM JSON has a claude-opus-5-5 row and Sonnet 5 1-hour cache writes at $4; MIT; us./eu./global. variants carry a premium  
  The downloaded JSON has 4,215 keys. claude-opus-5-5 is input 4e-6, output 2e-5, cache write 5e-6, 1h 8e-6, read 2e-7. claude-sonnet-5 has cache_creation 2.5e-6 and above_1hr 4e-6. gpt-6-sol has the >272K tier at 2x input and 1.5x output. The licence is MIT outside enterprise/. On the premium: us. and eu.anthropic.claude-opus-5-5 are 1.1x, but global.anthropic.claude-opus-5-5 matches the base price.
- **holds**: Not confirmed whether genai-prices has an Opus 5.5 row; it counts cache tokens inside input_tokens  
  Now resolved: npm @pydantic/genai-prices 0.1.8 dist/index.js contains claude-opus-5-5 (4 / 0.20 / 5 / 1h 8 / 20) and claude-sonnet-5 with cache_write_1h_mtok 4. The Anthropic extractor (prices/providers/anthropic.yml) maps cache_creation and cache_read into input_tokens. The legacy prices/data.json in the repo is stale: it lacks Opus 5.5 and shows a cancelled 2026-09-01 Sonnet 5 price rise. The live updater reads new_data/v2/data.json, so pin the npm bundle and do not vendor the legacy file.
- **holds**: Local price-table defects: no claude-opus-5-5 row while every pool seat is Opus 5.5; Sonnet 5 cache writes priced at $2.50 while all 753 bench entries match $4.00  
  scripts/seat-cost-estimate.ts:16-17 has only sonnet-5 (cache_write 2.5) and haiku-4-5. scripts/pool-run.ts:27 sets MODEL='claude-opus-5-5', and line 185 returns cost_usd null with 'no list-price row'. I re-ran the check over bench/results: 753 claude-sonnet-5 modelUsage entries, 753 match at $4.00 and 0 at $2.50.
- **holds**: claude-swap `cswap auto --json` events carry schema version and UTC ts; unverified whether manual `cswap switch` emits one; account ref probably includes email  
  In the local clone at commit 2213700 (2026-08-26), src/claude_swap/autoswitch.py:259,293,295 builds events with schemaVersion and a UTC ts. to_ref includes 'email' (line 385). All _emit calls are in autoswitch.py, and --json exists only on `cswap auto` (cli.py:565-609). That settles it: a manual `cswap switch` emits no event.
- **holds**: StrykerJS v10: Apache-2.0, command/tap runner, --mutate file:start-end ranges, no --since option, Node 22+  
  The v10.0.0 release (2026-08-14) notes say 'drop support for Node.js 20, require Node.js 22'. `npm view @stryker-mutator/tap-runner` gives engines node >=22.0.0. docs/configuration.md documents `src/app.js:1-11` mutation ranges and that the command runner 'just runs all tests for all mutants'. Local node is v22.20.0. One correction to the survey: issue #2843 is closed as completed (2022-12-11, superseded by incremental mode), not open. There is still no --since flag.
- **wrong**: Harbor has no transcript audit  
  harbor/src/harbor/cli/main.py:164 registers `harbor analyze` ('Analyze trial trajectories'). Its default rubric in src/harbor/analyze/prompts/analyze-rubric.toml includes reward_hacking: 'Read the agent's trajectory ... modifications to test files ... accessing or copying from the solution/ directory'. Everything else claimed about Harbor holds: `harbor check` uses cli/quality_checker/default-rubric.toml (behavior_in_task_description, behavior_in_tests, anti_cheating_measures ...), the claude_code agent supports CLAUDE_CODE_OAUTH_TOKEN and parses total_cost_usd with a litellm fallback, and a separate-verifier mode exists. Harbor also ships an ACP agent (agents/installed/acp.py) and apple_container and podman environments.
- **holds**: SWE-bench Pro V2 locked protocol: offline agent phase, PatchReplayAgent regrade on a pristine image, locked Claude Code and Codex agents  
  v2/README.md lists `[agent] network_mode = "no-network"`, `--allow-agent-host api.anthropic.com`, locked_claude_code:LockedClaudeCode, locked_codex:LockedCodex, and patch_replay:PatchReplayAgent. It needs Modal >=1.5.1 for the per-phase network policy. Released 2026-09-22 (v2.0.0), MIT.
- **holds**: SWE-bench-Live runs validation 3 times to drop flaky items and has an llm_filter  
  Development.md:210 says 'test is run 3 times automatically in validation.py to filter flaky (unstable) instances'. curation/run.sh:23 runs `python -m llm_filter.verify`. MIT, pushed 2026-09-10.
- **holds**: inspect_swe routes Claude Code through Inspect's provider, so seats bill the API rather than the subscription  
  inspect_swe/src/inspect_swe/_claude_code/env.py:97 sets ANTHROPIC_BASE_URL to http://localhost:{bridge_port}, the in-sandbox model bridge.
- **holds**: CooperBench: external agents can be registered; claude_code adapter; pairs of features; Redis messaging; MIT  
  registry.py:93 reads COOPERBENCH_EXTERNAL_AGENTS, and claude_code/adapter.py:171 uses CLAUDE_CODE_OAUTH_TOKEN. The README covers the solo, coop and team settings and needs Redis for coop. MIT is declared only in pyproject.toml; there is no LICENSE file.
- **holds**: OpenHands qa-changes plugin (MIT): 'do not re-run the suite; exercise like a user', 'Unable to Verify' section  
  plugins/qa-changes/README.md:3 says 'It does not re-run the test suite (that's CI's job)'. Line 124 has '### Unable to Verify', and the verdicts are PASS / PASS WITH ISSUES / FAIL / PARTIAL. The repo is MIT and released v0.24.0 on 2026-09-23. The Claude Code code-review plugin is proprietary: claude-code LICENSE.md says 'All rights reserved'.
- **wrong**: First step: give each run its own repo by cloning and dropping every other ref, or git init plus a fetch of base_commit; fetch-by-SHA may need protocol v2 or allowReachableSHA1InWant  
  I probed this in the scratchpad with git 2.50.1. After a plain local `git clone`, deleting all remote refs and running `reflog expire`, the other run's commit still resolves: `git cat-file -t` returns 'commit', and it appears in --batch-all-objects. A local clone hardlinks the whole object store, so a seat could find the objects with fsck or cat-file. `git init` plus fetching the SHA, or `git clone --no-local --single-branch`, did not carry the object. A non-tip SHA fetch works with the default protocol v2 and fails under v0 ('Server does not allow request for unadvertised object'). Use init+fetch and drop the clone option.
- **holds**: Repo has 34 pool/* and pool-final/* branches; runCodex reads a usage.json nothing writes; codex and OpenRouter prompts go in argv; READ_TOOLS includes Bash; swarm.ts only c.kill()s direct children  
  `git branch --list 'pool/*' 'pool-final/*'` counts 34. In src/swarm.ts, line 186 is args.push(text) (codex), line 174 passes '-p', text (OpenRouter), and line 187 reads a sidecar that only runClaude writes (line 151). src/spawner.ts:314 and 321 put the prompt in argv. READ_TOOLS at swarm.ts:91 and spawner.ts:117 includes Bash. swarm.ts:492 and 496 call c.kill() per child.
- **holds**: Claude --worktree branches from the default branch, leaves -p worktrees locked, and the docs do not say the isolation checks apply to worktrees we create  
  worktrees.md:118 says 'branch from your repository's default branch unless worktree.baseRef is set to "head"'. Line 60 says of -p runs that Claude Code 'leaves the lock it took on each one'. Lines 84-95 say enforcement applies 'whether you started the session with --worktree, Claude entered a worktree with EnterWorktree, or you resumed'.
- **holds**: Microsoft Agent Framework has a Claude package but no Codex package; Gas Town's Refinery is a Bors-style bisecting merge queue  
  python/packages lists claude, github_copilot and gemini, and no codex. The Gas Town README says the Refinery 'batches merge requests, runs verification gates, and merges to main using a Bors-style bisecting queue'. Gas Town is MIT, pushed 2026-09-18, last release v1.2.1 (2026-06-06).
- **overstated**: Survey licence and activity details for non-recommended projects (AgentCoder MIT; Qodo Cover archived; Superpowers star count implausible; Vibe Kanban last release 2026-09-19)  
  AgentCoder has no LICENSE file and GitHub reports none, so it is not MIT. qodo-cover is not archived on GitHub; its README says it is no longer maintained. obra/superpowers really does show 290,612 stars in the API. Vibe Kanban's latest release is v0.1.44 (2026-04-24); 2026-09-19 is its last push. None of these affect the plan.

### Missed by the survey

- Concord MCP (github.com/Get-Concord-AI/concord-mcp; MIT; v0.10.5 released 2026-09-23; 323 stars). One MCP server for Claude Code, Codex, Cursor, Gemini CLI and Grok Build. It has task/scope claims with overlap detection before edits, stale-claim flags, handoffs, and evidence recorded on finish. Its adapters steer a busy turn or start an idle turn. It is the rider-free MIT reference for both the file-lease and the push-delivery components.
- OpenAgents Workspace (github.com/openagents-org/openagents; Apache-2.0; launcher-v1.0.8 on 2026-09-21; 4.1k stars). Self-hostable shared threads, @mentions and shared files for Claude Code, Codex CLI, Gemini CLI, OpenCode, Copilot CLI, Cursor and more, with MCP and A2A support. It is the closest mixed-vendor 'room' product. It has no proposals, votes or verify gate, so it matters for related work and weakens the uniqueness claim.
- MassGen (github.com/massgen/MassGen; Apache-2.0; v0.1.97 on 2026-06-12; 1.1k stars; no push since June). Agents see and critique each other's answers, vote, and detect convergence, with a Claude Code backend. It is the nearest open-source analogue to the votes and consensus layer; it runs through an orchestrator rather than an MCP room. Cite it as related work.
- Harbor features the survey missed: `harbor analyze` (an LLM reward-hacking rubric over trajectories, a candidate check next to auditRun), a built-in ACP agent (agents/installed/acp.py), and apple_container and podman environments.
- cco (github.com/nikvdp/cco; MIT; pushed 2026-09-12; 424 stars). A sandbox-exec wrapper for Claude Code and Codex on macOS that keeps Keychain access; an alternative to Agent Safehouse for whole-seat wrapping.
- Risk the plan did not list: Seatbelt blocks writes through the node_modules symlink when only the cwd is writable. I probed it with sandbox-exec: a write in the worktree succeeds, a write via the node_modules symlink is denied. Sandboxed claude, srt/OpenRouter and codex workspace-write seats will fail on tools that write caches into the shared node_modules (.vite, .cache), unless those paths get allowWrite or the caches are redirected.
- Risk the plan did not list: per-invocation sandbox scope also hits the srt plan for OpenRouter seats. Each sh()/run_command wrapped separately is its own sandbox, so a seat cannot later kill a dev hub it started. Wrapping the whole seat process, or having the launcher own dev-hub teardown, avoids this.
- Smaller items: council-hub (iksnerd/council-hub, MIT, 3 stars, MCP shared rooms with transcripts); SWE-PolyBench (amazon-science, MIT, multi-language including TypeScript) as a source of external TS tasks; Inspect Scout (in the survey but not in the plan) as an alternative transcript scanner for the leakage audit.

## Projects surveyed

### coordination

The short answer is yes, a lot of this exists, but mostly for the plumbing, not for the part that makes this repo different.

**What already runs mixed-vendor CLI agents over MCP.** Only three things I found actually put Claude Code, Codex and others on one shared MCP coordination server:
- MCP Agent Mail, the Python original and the Rust rewrite. This is the serious one.
- Agent Room, which is tiny: just join, send and listen.
- Beads' beads-mcp, which is a task tracker rather than chat.

**Mixed-vendor, but not over MCP:**
- hcom works through hooks and SQLite, with mid-turn delivery.
- Gas Town uses tmux, hooks, Beads and a Mayor coordinator.
- Every Code is a Codex fork that fans out to the claude and gemini CLIs.
- ccswarm drives the Claude and Codex CLIs through a fixed pipeline.
- ACP is a protocol, with Claude and Codex adapters and native support in Gemini, OpenCode, Goose and Copilot.

**Frameworks:** Microsoft Agent Framework is the only big one that seats Claude Code's engine (ClaudeAgent) and Copilot in one GroupChat. Even there, the orchestrator picks who speaks, and I found no Codex package. AG2, CAMEL, MetaGPT, ChatDev, CrewAI, LangGraph, the OpenAI Agents SDK and AgentScope all run in-process API agents, so they cannot seat our CLI agents.

**Licence warning.** MCP Agent Mail, the best match, carries an OpenAI/Anthropic rider. It forbids any use by or for those companies and requires derivative works to carry the rider. Do not vendor its code into this MIT repo.

**What is ours alone.** Nothing I found implements the decision layer:
- Proposals are documents that get amended in place.
- A challenge must quote a matching span of 12+ characters, and an amend that removes the cited span answers it.
- An agree vote must quote a verbatim clause, and the hub checks it is there.
- Blind openings are revealed all at once.
- The stale-send guard makes you read what arrived while you were writing.
- There is one electorate snapshot, with supermajority and a chair veto.
- Being @-addressed creates a reply debt that blocks your other reads until you answer.
- The hub assigns a reviewer when a claim is created.
- The verify gate needs a structured JSON head (exit_code 0), written by someone other than the proposal's author, before a proposal can pass.

Also ours alone:
- OpenRouter seats that make any API model a full MCP participant with local tools.
- The planner → sub-rooms → leads room → verifier hierarchy with a hub-spawned consolidator.
- Decision records written to docs/decisions/proposed.
- The oracle benchmark harness.

The nearest attempts are all weaker:
- ccswarm's Sangha quorum marks objection resolution and evidence-bound acceptance as not shipped.
- Deliberation, PAL and Every Code have one orchestrator poll the other models; agents never talk to each other as peers.
- Claude agent teams' TaskCompleted hooks are Claude-only and interactive-only.

**Worth extracting as ideas, not code:**
1. Pushing messages to seats mid-turn instead of the wait_for_messages long-poll. For Claude seats, use Claude Code's per-session inbox socket (crossSessionInbound=accept). For Codex seats, use Codex app-server's turn/steer, or hcom's hooks. This goes straight at the cost of re-sent context.
2. File-glob leases with a TTL and a pre-commit guard, as in MCP Agent Mail. They are finer-grained than our area-level claim/* keys.
3. ACP as one driver for every CLI seat instead of building `claude -p` and `codex exec` arguments per vendor. It would also give Codex seats a real heartbeat. Note that `codex mcp-server` has been removed, so Codex can no longer be called as an MCP tool.
4. Gas Town's Refinery (a bisecting merge queue) for the --apply path.

| Project | Fit | Licence | Activity |
|---|---|---|---|
| [MCP Agent Mail (Python original + Rust rewrite mcp_agent_mail_rust)](https://github.com/Dicklesworthstone/mcp_agent_mail_rust) | strong | 'MIT License (with OpenAI/Anthropic Rider)', which is not OSI-standard. It grants no rights to OpenAI, Anthropic or anyone acting for them. Derivative works must carry the rider unchanged. 'Use' is defined to include putting the code into an evaluation harness or automated pipeline. | Python: 2.2k stars, v0.3.2 (2026-04-16), last push 2026-09-22. Rust: 171 stars, v0.3.36 (2026-09-16), last push 2026-09-23. The Rust README says the Python version had git-lock and SQLite-pool failures under load. |
| [hcom](https://github.com/aannoo/hcom) | partial | MIT | 515 stars. v0.7.25 (2026-08-09), last push 2026-09-13. |
| [Claude Code agent teams + cross-session messaging (built-in)](https://code.claude.com/docs/en/agent-teams) | partial | Not open source: proprietary, per the anthropics/claude-code LICENSE.md ('Use is subject to Anthropic's Commercial Terms'). | Shipping in current Claude Code (docs reference v2.1.257+). The repo was pushed 2026-09-23. |
| [Beads (bd) + beads-mcp](https://github.com/gastownhall/beads) | partial | MIT | 27.4k stars. v1.3.0 (2026-09-15), v1.3.1-rc.1 (2026-09-21), last push 2026-09-23. |
| [Gas Town (gt)](https://github.com/gastownhall/gastown) | partial | MIT | 18.2k stars. v1.2.1 (2026-06-06), last push 2026-09-18. |
| [Agent Client Protocol (ACP) + claude-agent-acp / codex-acp adapters](https://github.com/agentclientprotocol/agent-client-protocol) | partial | Apache-2.0 (the protocol, claude-agent-acp and codex-acp. codex-acp's licence file is Apache 2.0 with a JetBrains copyright). | Protocol: 4.3k stars, v1.9.1 (2026-09-18). claude-agent-acp: 2.6k stars, released 2026-09-23. codex-acp: 402 stars, released 2026-09-23 (zed-industries/codex-acp is archived). |
| [Codex app-server (in openai/codex)](https://github.com/openai/codex) | partial | Apache-2.0 | 126k stars, pushed 2026-09-23. |
| [Microsoft Agent Framework (successor to AutoGen)](https://github.com/microsoft/agent-framework) | partial | MIT | 13.8k stars. python-1.19.0 (2026-09-18), dotnet-1.22.0 (2026-09-18). ClaudeAgent announced 2026-01-30. |
| [Every Code (just-every/code)](https://github.com/just-every/code) | partial | Apache-2.0 | 4k stars. v0.6.191 (2026-09-16). |
| [ccswarm](https://github.com/nwiizo/ccswarm) | weak | MIT | 152 stars. v0.10.1 (2026-09-09), pushed 2026-09-14. |
| [Deliberation (antonbabenko)](https://github.com/antonbabenko/deliberation) | partial | MIT | 161 stars. v3.16.1 (2026-09-20). |
| [PAL MCP Server (formerly Zen MCP)](https://github.com/BeehiveInnovations/pal-mcp-server) | weak | Apache-2.0 (the GitHub API shows NOASSERTION, but the file is Apache 2.0) | 11.8k stars. Last release v9.8.2 (2025-12-15) and no push since then, so inactive in 2026. |
| [Agent Room](https://github.com/agent-room-alkl/agent-room) | weak | MIT | 67 stars. Pushed 2026-09-21. No releases. |
| [ChatRoomMCP (WarrenSchultz)](https://github.com/WarrenSchultz/chatroom-mcp) | weak | Apache-2.0 | 0 stars. Pushed 2026-08-14. |
| [A2A (Agent2Agent) protocol](https://github.com/a2aproject/A2A) | weak | Apache-2.0 | 25.9k stars. v1.0.1 (2026-05-28), pushed 2026-09-22. |
| [AG2 (community fork of AutoGen) group chat](https://github.com/ag2ai/ag2) | weak | Apache-2.0 | 5k stars. v1.0.6 (2026-09-21). |
| [CAMEL Workforce](https://github.com/camel-ai/camel) | weak | Apache-2.0 | 17.8k stars. v0.2.91a7 (2026-09-03). |
| [MetaGPT](https://github.com/FoundationAgents/MetaGPT) | weak | MIT | 70.6k stars. Last release v0.8.2 (2025-03-09), last push 2026-01-21, so effectively dormant. |
| [ChatDev 2.0 (DevAll)](https://github.com/OpenBMB/ChatDev) | weak | Apache-2.0 | 34.4k stars. v2.2.0 (2026-03-23), last push 2026-07-24. |
| [CrewAI](https://github.com/crewAIInc/crewAI) | weak | MIT | 59k stars. 1.15.22 (2026-09-16). |
| [LangGraph multi-agent (langgraph-swarm; langgraph-supervisor archived)](https://github.com/langchain-ai/langgraph-swarm-py) | weak | MIT | langgraph 42k stars (pushed 2026-09-23). langgraph-swarm-py 1.6k stars (pushed 2026-09-20). |
| [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) | weak | MIT | 29.7k stars. v0.22.3 (2026-09-17). |
| [AgentScope (MsgHub)](https://github.com/agentscope-ai/agentscope) | weak | Apache-2.0 | 32.2k stars. v2.0.8 (2026-09-08). |
| [Claude Squad](https://github.com/smtg-ai/claude-squad) | weak | AGPL-3.0 | 8.5k stars. v1.0.20 (2026-08-20). |
| [OpenAI Symphony](https://github.com/openai/symphony) | weak | Apache-2.0 | 27.4k stars. v0.0.3 (2026-09-15). |
| [Ruflo (formerly claude-flow)](https://github.com/ruvnet/ruflo) | weak | MIT | 73k stars. v3.44.0 (2026-09-23). |
| [Agent-MCP (rinadelph)](https://github.com/rinadelph/Agent-MCP) | weak (unverified) | AGPL-3.0 | 1.3k stars. Last release v4.20.1 (2025-09-02), last push 2026-03-28. |
| [Vibe Kanban / coder AgentAPI (both ending)](https://github.com/BloopAI/vibe-kanban) | weak | Apache-2.0 (vibe-kanban). MIT (agentapi). | Vibe Kanban last release 2026-09-19 but sunsetting. agentapi archived. |

### eval-harness

Yes, much of it has been built already. Harbor (Apache-2.0, very active) does the plumbing: isolated environments, the deadline, tests hidden until the agent phase ends, per-trial rewards, trajectories, job orchestration, and Claude Code with subscription auth and cost parsing. SWE-bench Pro V2 adds a ready-made locked protocol on top of Harbor: offline agent phase, then capture the diff and regrade it on a pristine image. SWE-bench adds FAIL_TO_PASS and PASS_TO_PASS grading. CooperBench already does solo vs coop vs team with claude_code and codex, merge-then-test, and external agent registration.

Nothing I found runs our setups out of the box, though:
(1) Four arms on one hash-locked pool: solo, a seeded fixed split, and flat rooms of 3 and 15 seats with a verifier, coordinating through an MCP chat hub. CooperBench is closest but is built around 2-feature pairs and Redis shell messaging. Harbor needs a custom agent or sidecars for more than one agent.
(2) Scoring 20 items at one integrated head, with a deterministic fallback: use the declared integration branch, otherwise merge the branches in a fixed order, keep the earlier side on a conflict, and record the conflict. Others score one patch per task, or pairwise merges.
(3) Cost per seat that estimates deadline-killed seats from partial stream-json usage and records the subscription account-switch log.
(4) A transcript leakage audit that voids a run. Others prevent leakage through isolation (no network, separate verifier) rather than auditing for it. Inspect Scout could do our kind of scan.
(5) Pre-registration with a sha256-locked pool manifest.

Reading pool-run.ts and pool-score.ts turned up three gaps where the open-source harnesses do better. I have not run anything to confirm them.
(a) Seat worktrees are created from the shared repo. Runs create pool/<pool>/<run>/* and pool-final/* branches there, and I found no code that deletes them. So a later run's seats could see earlier runs' solutions with git branch -a or git log --all, and the audit only searches for the hidden root and the hidden test file names. A fresh container per trial removes this.
(b) The existing-suite check is `npm test` exit code == 0. PASS_TO_PASS would catch deleted or skipped tests and ignore failures already present at base.
(c) Seats have WebSearch and WebFetch. SWE-bench Pro V2 cuts the network in the agent phase and allows only the model API host.

Realistic path: move pool tasks to the Harbor format, write one custom Harbor agent for split and room arms, and borrow SWE-bench Pro V2's locked Claude Code agent and patch-replay regrader. Keep our merge policy, per-seat cost and account logging, and the audit as thin layers on top.

| Project | Fit | Licence | Activity |
|---|---|---|---|
| [Harbor (harbor-framework/harbor), the Terminal-Bench 2.0 harness](https://github.com/harbor-framework/harbor) | strong | Apache-2.0 | v0.23.0 released 2026-09-12. Last push 2026-09-23. About 5.5k stars. |
| [CooperBench](https://github.com/cooperbench/CooperBench) | partial | MIT (declared in pyproject.toml; GitHub's API detects no LICENSE file) | v0.0.29 (GitHub release and PyPI) on 2026-08-15. Last push 2026-09-15. 25 stars. |
| [SWE-bench Pro V2 locked protocol (scaleapi/SWE-bench_Pro-os)](https://github.com/scaleapi/SWE-bench_Pro-os) | partial | MIT | V2 announced 2026-09-22. Last push 2026-09-22. 530 stars. |
| [SWE-bench harness (swebench)](https://github.com/SWE-bench/SWE-bench) | partial | MIT | swebench 5.0.2 on PyPI (2026-08-18). Last push 2026-09-18. About 5.9k stars. |
| [Inspect AI + inspect_swe (+ inspect_evals, Inspect Scout)](https://github.com/meridianlabs-ai/inspect_swe) | partial | MIT (all four) | inspect-ai 0.3.268 (2026-09-22), 2.85k stars. inspect-swe 0.2.71 (2026-09-17), 32 stars. inspect-evals 0.21.0 (2026-09-17). inspect_scout last push 2026-09-23, 72 stars. |
| [SWE-bench-Live + RepoLaunch](https://github.com/microsoft/RepoLaunch) | partial | MIT (both) | RepoLaunch: last push 2026-09-22, 146 stars. SWE-bench-Live: v1.0 released 2026-03-08, last push 2026-09-10, 243 stars; MultiLang update 2026-08-21. |
| [SWE-smith](https://github.com/SWE-bench/SWE-smith) | weak (unverified) | MIT | Last push 2026-09-21. 784 stars. |
| [Multi-SWE-bench](https://github.com/multi-swe-bench/multi-swe-bench) | weak | Apache-2.0 | Last push 2025-12-18, with nothing in 2026. 362 stars. |
| [OpenHands benchmarks](https://github.com/OpenHands/benchmarks) | weak | MIT | No releases. Last push 2026-09-04. 125 stars. |
| [METR Vivaria + METR Task Standard](https://github.com/METR/vivaria) | weak | MIT | Vivaria last push 2026-05-18, 142 stars; its README says it is 'ramping down new feature development' and recommends Inspect for new projects. Task Standard last push 2025-02-03. |
| [Claim Plane](https://github.com/SkeinRank/claim-plane) | weak | Apache-2.0 | Last push 2026-09-17. 4 stars. |
| [MSEval / LegoGent](https://github.com/robinren03/MSEval) | weak | None declared, so the code cannot be reused. | Last push 2026-07-31. 1 star. |

### task-curation

Short answer to "are we reinventing the wheel": for the mechanics, partly. For the core idea, no.

Where it is a reinvention: red at base, green with the reference is the standard fail-to-pass gate that every SWE-* pipeline uses. Our exit-code grading is the same choice SWE-Factory made. Harbor already defines a hidden tests/ + solution/ format with oracle and nop agents. The item shape (original task, hidden behavioural verifier, held-out reference, graded from the builder's diff in a clean checkout) is what DeepSWE does.

What no project I found covers:
1. Tasks drawn from a repo's backlog of work not yet built. Every open-source generator I found mines merged PRs or commits (SWE-bench-Live, SWE-rebench V2, SWE-Factory, SWE-Next, Multi-SWE-bench, R2E-Gym), plants synthetic bugs against existing visible tests (SWE-smith), or masks existing features (FeatureBench). Because our fix and test are written fresh, they exist nowhere in git history or on GitHub. That matters for our setup: builders work in worktrees of the real repo, so any task mined from our own history would leak its answer through `git log`. DeepSWE has the same original-task shape, but its tasks were written by people and I found no released authoring tool.
2. Pools designed for multi-agent throughput: 20 independent items per repo, a hash-locked manifest, a seeded three-way split, and a leakage audit that voids a run. None of the tools think about pools, splits, rooms or whether items conflict with each other.
3. Running directly on arbitrary TS/Node repos (custom tsx/offline-runner, node --test, vitest) with no Docker, no GitHub mirror and no per-repo log parser. SWE-smith, SWE-bench-Live/RepoLaunch, SWE-Factory and Multi-SWE-bench all need Docker, and most need GitHub.

What we lack and could take cheaply:
(a) Rerun red and green about 3 times to reject flaky items (SWE-bench-Live); scripts/pool-format.ts validatePool runs each once.
(b) Run the existing suite with the reference applied at curation time, a PASS_TO_PASS check. Today suite_cmd only runs at score time; in pool 1's Room3 run the final head failed a regression the room had shipped.
(c) An LLM check that the brief and the hidden test match in both directions (Harbor's `harbor check` rubric, SWE-bench-Live's llm_filter).
(d) A mutation check of the hidden test against the lines reference.patch changed (StrykerJS command runner plus line ranges), because tests written alongside their own fix are often lax (CoHarden).
(e) A 'fails for the right reason' check. Our exit-code-nonzero-at-base check is also passed by a hidden test that fails only because it imports a module that does not exist yet. The pipelines that parse test logs avoid this by comparing individual test results.
(f) Some check that items do not conflict. In pool 1, Split lost the same 5 items to a src/hub.ts merge conflict. No external tool addresses this either.

Not verified:
- whether SWE-rebench V2's interactive setup agent code is in its repo (I saw only prompts plus Docker and eval scripts);
- whether ScaleSWE released its test-creator pipeline;
- whether any code exists for SWE-Universe, SWE-Playground or FrogNano (none found);
- that Harbor's nop agent is intended as the red-at-base check (the agent exists; that use is my inference).

| Project | Fit | Licence | Activity |
|---|---|---|---|
| [Harbor (Terminal-Bench team) task format + oracle/nop agents + `harbor check` rubric](https://github.com/harbor-framework/harbor) | partial | Apache-2.0 | 5,542 stars; v0.23.0 released 2026-09-12; pushed 2026-09-23 |
| [StrykerJS (mutation testing) as a strength check for hidden tests](https://github.com/stryker-mutator/stryker-js) | strong | Apache-2.0 | 3,145 stars; v10.0.0 released 2026-08-14; pushed 2026-09-21 |
| [DeepSWE (Datacurve) + Pier](https://github.com/datacurve-ai/deep-swe) | partial | Apache-2.0 | 1,742 stars; pushed 2026-08-26 |
| [SWE-smith](https://github.com/SWE-bench/SWE-smith) | partial | MIT | 784 stars; latest main commit 2026-03-21 (PHP support); pushed 2026-09-21; NeurIPS 2025 D&B |
| [SWE-bench-Live curation pipeline + RepoLaunch](https://github.com/microsoft/SWE-bench-Live) | partial | MIT (both) | SWE-bench-Live: 243 stars, pushed 2026-09-10, MultiLang update 21/08/2026 (1,077 instances, 431 repos). RepoLaunch: 146 stars, release v1.4.3 on 2026-09-22. |
| [SWE-rebench V2 tooling](https://github.com/SWE-rebench/SWE-rebench-V2) | weak | MIT | 85 stars; pushed 2026-03-12 |
| [SWE-Factory](https://github.com/DeepSoftwareAnalytics/swe-factory) | weak | Dual: AGPL-3.0 for non-commercial use, commercial licence by request (GitHub shows NOASSERTION) | 196 stars; pushed 2026-05-12; FSE 2026 |
| [FeatureBench](https://github.com/LiberCoders/FeatureBench) | weak | MIT | 95 stars; pushed 2026-09-15; ICLR 2026; dataset v1.1 Aug 2026 |
| [R2E-Gym (SWE-GEN)](https://github.com/R2E-Gym/R2E-Gym) | weak | Apache-2.0 | 335 stars; pushed 2025-07-13; COLM 2025 |
| [Multi-SWE-bench collect + harness](https://github.com/multi-swe-bench/multi-swe-bench) | weak | Apache-2.0 | 362 stars; pushed 2025-12-18 |
| [THUDM SWE-Dev (test-case synthesis pipeline)](https://github.com/THUDM/SWE-Dev) | weak | MIT | 66 stars; pushed 2025-07-21; ACL 2025 Findings |
| [SWT-bench harness](https://github.com/logic-star-ai/swt-bench) | weak | MIT | 91 stars; pushed 2026-07-23 |
| [SWE-Next / ScaleSWE / SWE-Gym (Python mining pipelines)](https://github.com/TIGER-AI-Lab/SWE-Next) | weak (unverified) | Apache-2.0 / CC BY 4.0 / Apache-2.0 | See per-project figures in 'what' |
| [CoHarden (paper: iterative hardening of co-generated tests and fixes)](https://yhtan777.github.io/CoHarden-project-page/) | weak (unverified) | No code released (project page says 'under review') | Paper July 2026; project page repo pushed 2026-07-20 |

### verification

None of the projects I found enforces acceptance by identity inside a live multi-agent room. In ours, a proposal passes only with a machine-parsed verify head that names the exact proposal id and version, is dated after the current text, and comes from a different connection. The hub assigns the reviewer (the least-recently-verifying non-owner, with a fallback when that reviewer leaves). An executable challenge can be answered only by a non-proposer re-running the exact command, or by an adjudicator's ruling; rewording cannot answer it. A second seat's verify entry is needed before anyone can re-freeze a baseline. This works across heterogeneous models, with votes that must quote the proposal. PR-Agent, Codex review, Kodus and the Claude plugins are single reviewer bots on a PR. OpenHands has CI, then review, then QA layers, but no separation of author and reviewer by identity and no binding to a proposal version. So the gate itself is ours and worth keeping.

What we lack is exactly what these tools supply: the gate cannot tell what the command exercised. It accepted 126 of 260 heads that re-ran existing tests, and it cannot confirm the command was real. Plan: extract rather than invent, in this order.
1. Adopt the rule from OpenHands' qa-changes, "do not re-run the suite; exercise the change", in the verifier and recruit prompts, and add a `kind` field to the head. Cheap, but prompt-level.
2. Implement a SWE-bench-style fail-at-base check ourselves with `git worktree`, using the codeState the hub already stamps.
3. Add changed-line coverage (node --experimental-test-coverage producing lcov, then diff-cover) as a cheap deterministic check.
4. For high-risk areas, run StrykerJS v10 (tap-runner, `--import tsx`, `--mutate` ranges from a git diff) with the ACH/TestForge rule: the reviewer's test must kill a mutant that survives the author's tests.

Items 2 to 4 only make the gate harder to satisfy if the hub, or a trusted runner, reads the artifacts or runs the command itself. Our decision record lists that as its 'Revisit-when' condition, so it needs a decision and a sandbox before it is built.

| Project | Fit | Licence | Activity |
|---|---|---|---|
| [StrykerJS + @stryker-mutator/tap-runner](https://github.com/stryker-mutator/stryker-js) | strong | Apache-2.0 | v10.0.0 on 14 Aug 2026 (npm-verified for tap-runner), which adds experimental TypeScript 7 support and needs Node 22+. v9.6.x in Feb to Apr 2026. About 3.1k stars. |
| [OpenHands extensions: qa-changes plugin](https://github.com/OpenHands/extensions/tree/main/plugins/qa-changes) | strong | MIT (repo) | 359 commits, 150 stars, 86 open PRs. No release date is shown on the page. OpenHands' 'Verification Stack' post (June 2026) describes it in production use. |
| [diff-cover](https://github.com/Bachmann1234/diff_cover) | partial | Apache-2.0 | v10.6.0 uploaded to PyPI on 22 Sep 2026 (verified). 843 stars. |
| [fast-check](https://github.com/dubzzz/fast-check) | partial | MIT | v4.10.x released September 2026: npm latest is 4.10.2, and the 4.10.0 plugin API prepares for v5. About 5.2k stars. |
| [Probity (successor to TDD Guard)](https://github.com/nizos/probity) | partial | MIT | v1.10.1 on 15 Sep (the page shows no year; presumed 2026 because TDD Guard's deprecation notice points to it). v1.10.0 and v1.9.0 in July. 208 stars, 571 commits. |
| [PR-Agent (The-PR-Agent/pr-agent)](https://github.com/The-PR-Agent/pr-agent) | partial | MIT per the LICENSE file ("Copyright (c) 2026 The PR Agent") and PyPI. Some secondary coverage says Apache-2.0, which conflicts; the LICENSE file is authoritative. | v0.46.0 uploaded to PyPI on 21 Sep 2026 (verified). About 13.1k stars. |
| [OpenAI Codex CLI review prompt (`codex review` / `/review`)](https://github.com/openai/codex) | partial (unverified) | Apache-2.0 | The repo is very active: about 126k stars and 11k+ commits. |
| [SWE-bench harness (FAIL_TO_PASS / PASS_TO_PASS)](https://github.com/SWE-bench/SWE-bench) | partial | MIT | About 5.9k stars. The page showed no release date; it is actively referenced in 2026 work. |
| [TestForge (open reproduction of Meta ACH)](https://github.com/Luz7818/testforge) | weak | MIT | Early prototype: 7 commits, 1 star. Python only. |
| [Groundhog](https://github.com/abhinavsv3/groundhog) | weak | Apache-2.0 | 2026 activity visible. 0 stars. Validation is Python-only ('Python only, for now'); mining recognises TS/JS test files. |
| [Claude Code code-review plugin](https://github.com/anthropics/claude-code/tree/main/plugins/code-review) | weak | Proprietary: the repo LICENSE says "© Anthropic PBC. All rights reserved. Use is subject to Anthropic's Commercial Terms of Service." | Part of the actively maintained claude-code repo. |
| [claude-code-security-review](https://github.com/anthropics/claude-code-security-review) | weak | MIT | 6.3k stars, 30 commits. No date visible. |
| [OpenHands critic (openhands-critic-4b-v1.0 + critic-rubrics)](https://github.com/OpenHands/critic-rubrics) | weak | Not stated for either the repo or the model weights (unverified). | The critic-rubrics repo was archived on 3 Aug 2026; 21 stars. |
| [AgentCoder](https://github.com/huangd1999/AgentCoder) | weak | MIT | 390 stars, 35 commits. Last commit date not shown; research code from 2023 to 2024. |
| [Agentless](https://github.com/OpenAutoCoder/Agentless) | weak | MIT | Last activity around Dec 2024. 2.1k stars. |
| [Superpowers (skills library)](https://github.com/obra/superpowers) | weak | MIT | 682 commits, 259 open PRs. The page showed about 291k stars, which looks implausibly high, so treat the star count as unverified. |
| [Kodus](https://github.com/kodustech/kodus-ai) | weak | AGPL-3.0 | v2.2.4 on 17 Sep 2026. 1.4k stars, about 6.8k commits. |
| [Mutahunter / Qodo Cover / agentic-pbt (not recommended)](https://github.com/codeintegrity-ai/mutahunter) | weak | Mutahunter AGPL-3.0. Qodo Cover AGPL-3.0. agentic-pbt: no licence stated. | Mutahunter's last commit was 17 Apr 2025. Qodo Cover was archived and unmaintained from 15 Jun 2025. agentic-pbt: 88 stars, date not shown. |

### cost-telemetry

What only we do:
(1) Run-level rollup across providers. One result.json per swarm or bench run combines Claude CLI, Codex and OpenRouter seats, keyed to seat and room names, with explicit coverage (complete/partial/none). A seat that reported nothing stays 'unknown', never $0. No external tool models that.
(2) Research joins. Arm A's --max-budget-usd is matched to arm C's realised cost on the same task and seed. Account-by-regime joins thinkingTokens to the account that served each run. No external tool does either.
(3) In-loop budget control. Seats hand off proactively on cumulative prompt tokens. Every tool above observes after the fact.
(4) OpenRouter seats already record provider-computed cost inline, which is the best source available, so nothing should replace that.

The rest is replaceable. Replace the parsing and pricing, not the rollup: Claude Code's OTel api_request events (tagged per seat with OTEL_RESOURCE_ATTRIBUTES) cover killed-seat cost and per-room usage; a maintained price table (LiteLLM JSON or @pydantic/genai-prices) replaces our 2-row table; `codex exec --json` fills the Codex gap; claude-swap's JSON events replace our log regex.

Three defects in our current code, found while checking. Two I confirmed from data or code; the third rests on official docs:
(a) scripts/seat-cost-estimate.ts prices Sonnet 5 cache writes at $2.50/MTok, but our seats use 1-hour-TTL writes at $4.00. Local transcripts show usage.cache_creation.ephemeral_1h_input_tokens. All 753 claude-sonnet-5 modelUsage entries in bench/results match the CLI's costUSD exactly at $4.00, and none match at $2.50. On that data our table comes out 11.3% low ($191.51 against the CLI's $215.80).
(b) Official docs say per-step output_tokens on stream-json assistant events is a placeholder, so killed-seat estimates undercount output. The fix is --include-partial-messages or OTel.
(c) runCodex reads a <name>.usage.json that nothing writes, so Codex seat usage is always null.

| Project | Fit | Licence | Activity |
|---|---|---|---|
| [Claude Code native OpenTelemetry export (built-in)](https://code.claude.com/docs/en/monitoring-usage) | strong | Proprietary (Claude Code is closed-source; the telemetry feature is free and built in) | Docs current as of Sept 2026 and mention CLI versions up to v2.1.274; the api_request fields were extended recently (client_request_id needs v2.1.214+) |
| [Claude Code stream-json --include-partial-messages (official cost-tracking guidance)](https://code.claude.com/docs/en/agent-sdk/cost-tracking) | strong | Proprietary CLI flag and docs | Docs current as of Sept 2026 |
| [OpenAI Codex CLI: `codex exec --json` usage events and [otel] export](https://developers.openai.com/codex/noninteractive) | strong | Apache-2.0 | rust-v0.156.1 released 2026-09-23; about 126k stars; pushed today |
| [ccusage](https://github.com/ccusage/ccusage) | partial | MIT | v20.0.24 released 2026-09-21; about 18.7k stars; pushed today (now a Rust binary distributed via npm) |
| [LiteLLM model_prices_and_context_window.json (price table; the proxy optionally)](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json) | strong | MIT (everything outside enterprise/) | v1.102.1 released 2026-09-23; about 59.5k stars; pushed today |
| [pydantic/genai-prices](https://github.com/pydantic/genai-prices) | strong | MIT | v0.1.8 released 2026-09-22 (npm latest 0.1.8); about 380 stars; pushed today |
| [models.dev](https://github.com/anomalyco/models.dev) | weak | MIT | Pushed 2026-09-23; about 7k stars (repo moved from sst/models.dev to anomalyco/models.dev) |
| [Langfuse](https://github.com/langfuse/langfuse) | weak | MIT core (ee/ excluded) | v4.43.0 released 2026-09-23; about 35k stars |
| [OpenRouter Broadcast](https://openrouter.ai/docs/guides/features/broadcast) | weak (unverified) | Proprietary hosted feature | Docs live in 2026 |
| [claude-swap `cswap auto --json` events / `cswap run`](https://github.com/realiti4/claude-swap) | strong | MIT | Upstream pushed 2026-09-20; about 2.8k stars; the local clone at the 2026-08-26 commit already has the JSON events (src/claude_swap/autoswitch.py) |
| [Anthropic Usage & Cost Admin API / Claude Code Analytics API](https://platform.claude.com/docs/en/build-with-claude/claude-code-analytics-api) | weak | Proprietary API | Current |
| [OpenLLMetry (traceloop/openllmetry, openllmetry-js)](https://github.com/traceloop/openllmetry) | weak | Apache-2.0 | Python 0.62.3 released 2026-08-10 (about 7.4k stars); JS 0.27.0 released 2026-05-29 (about 410 stars, last push 2026-06-18) |
| [Helicone](https://github.com/Helicone/helicone) | weak | Apache-2.0 | In maintenance mode since the Mintlify acquisition (announced 2026-03-03): security fixes, bug fixes and new models only. Last GitHub release tag 2025-08-21; repo pushed 2026-09-16; about 6.2k stars. |
| [anthropics/claude-code-monitoring-guide](https://github.com/anthropics/claude-code-monitoring-guide) | weak | None detected by GitHub | Last push 2025-07-29; about 370 stars (stale) |

### isolation

Most of the parts that do the actual isolating can be extracted. No project covers the room-aware, mixed-vendor lifecycle around them.

What no project covers:
(1) The seat leaves the room before it is killed. Its budget is set to the launcher's timeout, it heartbeats while working, it hands off its claims, and a replacement is registered with the hub (src/respawn.ts, src/revive.ts). Every sandbox tool here only knows how to kill a process.
(2) The hub knows where each seat works. Each worktree is stamped onto the seat's claim/* entries through seatBeat, branches are named swarm/<run>/<seat> so pool-run can list and integrate them, and node_modules is symlinked in so builds stay fast. Claude's and Codex's --worktree and container-use each do worktrees for their own agent only. None does it across claude, codex and our own OpenRouter seat.
(3) The lsof-cwd stray sweep (scripts/pool-run.ts pidsUnder/stopStrays). On macOS there is no cgroup or PID namespace. The only real containment units are a separate uid (SandVault, alcless) or a VM (apple/container, microsandbox, smolvm, Docker sbx). If seats stay on the host, even under Seatbelt, our sweep is still needed.

Recommendation: keep worktrees and the sweep, and add Seatbelt through Claude Code's sandbox settings for claude seats, srt around seat.ts run_command for OpenRouter seats, and `-s` flags for codex. All three block signals to anything outside the sandbox, which would have stopped the 14-seat kill independently of the stdin fix. The one thing to test first is whether two separately launched sandboxes count as the 'same sandbox'.

Gaps I found in our code while mapping this, none fixed (read-only task):
(a) The stdin fix covers only claude seats. Codex and OpenRouter seats still get the brief in argv: src/swarm.ts runOpenRouter passes "-p", text and runCodex does args.push(text); src/spawner.ts does the same around L314 and L320. A claude seat's `pkill -f` could still match them. `codex exec -` reads stdin.
(b) ~/.codex/config.toml sets sandbox_mode="danger-full-access" and runCodex passes no -s, so codex seats run with no sandbox.
(c) 'Read-only' claude seats get unrestricted Bash (READ_TOOLS includes Bash), so read-only is prompt-only for claude seats.
(d) Outside pool-run, swarm.ts's timeout and SIGTERM handler only call c.kill() on direct children, with no process-group kill and no sweep. Detached dev hubs a seat started can outlive a plain `node dist/swarm.js` run.

| Project | Fit | Licence | Activity |
|---|---|---|---|
| [Claude Code built-in sandboxed Bash (sandbox.* settings)](https://code.claude.com/docs/en/sandboxing) | strong | Claude Code is proprietary (Anthropic terms). The sandbox engine underneath is Apache-2.0 (sandbox-runtime). | Ships in Claude Code; 2.1.281 is installed on this machine. Docs are current as of Sept 2026. |
| [Anthropic sandbox-runtime (srt / @anthropic-ai/sandbox-runtime)](https://github.com/anthropic-experimental/sandbox-runtime) | strong | Apache-2.0 | v0.0.77 released 2026-09-18, last push 2026-09-22, about 5.3k stars. Labelled 'Beta Research Preview'. |
| [OpenAI Codex CLI built-in sandbox (-s workspace-write, `codex sandbox`)](https://github.com/openai/codex) | partial | Apache-2.0 | Very active: pushed 2026-09-23, about 126k stars. 0.155.0-alpha.16.3 is installed here. |
| [Agent Safehouse](https://github.com/eugene1g/agent-safehouse) | partial | Apache-2.0 | v0.12.0 released 2026-09-07, last commit 2026-09-22, about 2.1k stars. |
| [Claude Code `--worktree` / Codex `--worktree` (native worktree creation)](https://code.claude.com/docs/en/worktrees) | partial | Proprietary CLI (Claude Code); Apache-2.0 (Codex). | Current in both CLIs, which are installed locally. |
| [apple/container](https://github.com/apple/container) | partial | Apache-2.0 | 1.4.1 released 2026-09-09, last commit 2026-09-22, about 50k stars. |
| [microsandbox](https://github.com/zerocore-ai/microsandbox) | partial | Apache-2.0 | v0.7.2 released 2026-09-17, last commit 2026-09-22, about 8.4k stars. It says it is beta software and to expect breaking changes. |
| [smolvm](https://github.com/smol-machines/smolvm) | weak | Apache-2.0 | v1.17.0 released 2026-09-21, last commit 2026-09-23, about 6.3k stars. |
| [Docker Sandboxes (sbx)](https://docs.docker.com/ai/sandboxes/) | partial | Proprietary: the docker/sbx-releases LICENSE reads 'Copyright © 2026 Docker Inc. All rights reserved.' The binary is free to use. | v0.46.0-rc3 released 2026-09-23 on docker/sbx-releases, about 400 stars. |
| [container-use (Dagger)](https://github.com/dagger/container-use) | weak | Apache-2.0 | Last release v0.4.2 on 2025-08-19, last commit 2026-08-12, about 4.0k stars. The README says 'early development'. It is slowing. |
| [SandVault](https://github.com/webcoyote/sandvault) | partial | Apache-2.0 | Last push 2026-09-14, about 419 stars. |
| [Alcoholless (alcless)](https://github.com/AkihiroSuda/alcless) | weak | Apache-2.0 | v0.2.1 released 2026-09-17, about 200 stars. |
| [yoloAI](https://github.com/kstenerud/yoloai) | weak | MIT | Last push 2026-08-21, about 213 stars. Public beta. |
| [nono](https://github.com/always-further/nono) | weak | Apache-2.0 | v0.78.0 released 2026-09-16, last commit 2026-09-23, about 4.2k stars. |
| [E2B](https://github.com/e2b-dev/E2B) | weak | Apache-2.0 (SDK and infra) | SDK e2b@2.51.0 released 2026-09-18, about 13.9k stars. The infra repo was pushed 2026-09-23. |
| [Daytona](https://github.com/daytonaio/daytona) | weak | The repo root no longer has a LICENSE file, so current terms are unverified. It was AGPL-3.0 historically. | The README says 'This repository is no longer maintained. As of June 2026, Daytona's core development has moved to a private codebase.' Last release v0.190.0 on 2026-06-23. |
| [Modal Sandboxes](https://modal.com/docs/guide/sandboxes) | weak (unverified) | The client SDK is Apache-2.0 (modal-labs/modal-client). The platform is proprietary and cloud-only. | The SDK repo was pushed 2026-09-23. |
| [nsjail / bubblewrap](https://github.com/google/nsjail) | weak | nsjail Apache-2.0; bubblewrap LGPL (per its COPYING file). | nsjail pushed 2026-08-27, about 4.1k stars. bubblewrap pushed 2026-09-22, about 8.8k stars. |
| [Rivet sandbox-agent](https://github.com/rivet-dev/sandbox-agent) | weak | Apache-2.0 | v0.5.0-rc.3 released 2026-03-30, last commit 2026-06-19, about 1.6k stars. |
| [kubernetes-sigs/agent-sandbox](https://github.com/kubernetes-sigs/agent-sandbox) | weak | Apache-2.0 | v1.0.3 released 2026-09-17, about 4.0k stars. |
