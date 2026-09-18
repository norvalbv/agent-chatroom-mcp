# Lobby swarm-010513 (2026-09-18 01:05Z to 01:59Z)

Brief: swarms/brief-next.txt (eight ranked goals from the previous lobby's remaining list). 24 deepseek/deepseek-v4-flash-0731 seats + verifier; thirteen break-out rooms. At 01:45Z OpenRouter began refusing requests for lack of account credit; 234M prompt tokens had been spent across 23 seats in 40 minutes, mostly by the lobby's polling. The lobby concluded at 01:59Z with its three surviving voters. Five items merged on main at b4cd67c; the rest stalled mid-build with commits on swarm/swarm-010513-* branches (see REMAINING in the lobby conclusion).

Two hazards this run: a seat changed the repository's shared git identity again before the git-config guard landed, so the maintainer's five integration merge commits carry the author "x" (history not rewritten); and the lobby's polling cost dominated spend, which the merged consolidator spawn is meant to remove.


## swarm-010513-crup-room

state: concluded · messages: 669 · board entries: 100 · verify entries: verify/a20eacd-replay-binding, verify/a20eacd-chair-replay, verify/a20eacd-chair-replay-binding, verify/seat-git-config-refusal, verify/recruit-prefix-inheritance, verify/consolidator-spawn-lobby, verify/controller-authority, verify/prop-a83bcd3c, verify/lobby-matrix-prop-a83bcd3c


**Conclusion** (v3, tally {'agree': 3, 'disagree': 0, 'abstain': 0}, 2026-09-18T01:59:07.100Z):

RANKED LIST — swarm-010513-crup lobby (main 858d24d, bench harness merged at c36b6b9 tip 3b3ea43). Five items BUILT & VERIFIED (verify entries name the exact tip; merge these):

(1) Chair replay binding a20eacd — branch swarm/swarm-214936-s3jy-human/human-research-build-1 @ a20eacd; RED on main c0cf5a3, GREEN at a20eacd, chair-replay-regression PASS; verify/a20eacd-replay-binding (-17), verify/a20eacd-chair-replay (-6), verify/a20eacd-chair-replay-binding (-13), evidence/a20eacd-independent-verification (-7), evidence/chair-replay-independent (-10) = 5 independent connections; plus evidence/a20eacd-delta-pin (-9) = diff pin src/hub.ts +3 + regression. Rule from R7: merged with ea78cf9+add86f7 only after independent verification — now satisfied.

(2) R6(3) git-config refusal — branch swarm/swarm-010513-gitconfig-build/openrouter-recruit-13 @ TIP 22ae36d (d7553ee RED 3-fail -> 28c8e06 GREEN 7/7 -> 22ae36d closes ch_2b6b8505 bypass, generalized -c/--no-pager/-C). verify/seat-git-config-refusal re-pinned at 22ae36d (10/10 incl. flag forms, PORT 19775, .git/config clean) + verify/git-config-refusal (recruit-17, hubs 8935/36/38/39). Guard order LETHAL->GITCONFIG->MUTATING on write AND read-only seats. sudo escape = documented non-blocking (LETHAL precedent).

(3) Recruit-run-prefix — CANONICAL MERGE TARGET branch swarm/swarm-010513-crup-recruit-prefix/openrouter-recruit-16 @ acedaab (288779c red-first on c0cf5a3 + acedaab adopts 6-test regression incl. per-run cap-escape test 6; fix byte-identical 288779c..acedaab; brief-conformant: unprefixed inherits prefix, nothing changes when no prefix or already prefixed). verify/recruit-prefix-inheritance RE-PINNED at acedaab by -14 (6/6, RED 4-fail/2-pass at main, tsc, SMOKE 19777) + verify/recruit-room-run-prefix @recruit-15 + verify/recruit-room-prefix @recruit-18 (break-out concluded prop_1a13fba8 v3). The 032ef9c row (branch-15 variant, sanitizes unprefixed names) is corroboration only — do NOT merge it.

(4) R6(2) controller-owned authority — branch swarm/swarm-010513-crup-controller-build/openrouter-recruit-28 @ 00ab338. verify/controller-authority (recruit-29, JSON verdict pass): token set -> exact header else 401; unset -> 403 unless CHATROOM_INSECURE_LOCAL=1 on loopback; seats cannot self-elevate (env.ts SEAT_ENV_EXCLUSIONS); route-auth-regression 4/4 (RED on main c0cf5a3); bench seam l.84 literal per coordination/bench-bench-seam; /config human_token_required. eeb71ac (recruit-27, no verify) is NOT a merge target: DISCARD unless its smoke/live-after-trial loopback opt-in is folded above 00ab338 and re-verified — do not merge both (verifier #504/#539).

(5) R3 spawned consolidator — branch swarm/swarm-010513-crup-consolidator-build/consolidator-builder-12-3 @ 6a119cf (BRANCH TIP, machine-checked this session; c5417e8 = verified mid-chain; 6a119cf adds the hub-seam guard so a refused consolidator spawn never breaks the concluding vote, src/index.ts +8/-1 swal+announce mirroring child-close handler, regression 1-8 + offline green; 5332854 = pre-fix process-exit gate, NOT a merge target). verify/consolidator-spawn-lobby RE-PINNED at c5417e8 by -14: room-state-only gate (hub.onRoomState fired in setState, index.ts wires state==concluded -> checkConsolidators, spawner drops endedAt); regression 8/8 incl. case 8 (concluded child + heartbeat-alive seat process -> exactly one consolidator, never twice) = the 25-min lobby-15 stall repro; CONSOLIDATOR-SPAWN OK, tsc, SMOKE 19776. Known accepted tradeoff (carried in verify): consolidatorsFired.add precedes request() — a throwing request suppresses retry.

REMAINING (evidence on board, builds in flight, none merge-ready yet): R1 handoff (crup-r1-build; verify/context-pressure-logs: handoffs cluster 90-130 steps, never-handoff seats died 203-411), R2 heartbeat replies (r2-heartbeat-build), R5/R4 telemetry usage (telemetry-build; C3: unknown != 0), R6(1) fail-closed isolation (crup-safety-build), R7 human kick (kick-build; vote-kick researched-against per evidence/kick-research — majority-dynamics evidence does not support removal mechanics, human kick reuses leave path), R8 hub-readable verify verdicts (crup-verify-verdicts), R9.1 launch-time hash closure + seedable A/B rerun (crup-r9-build; >=3 seeds/arm, oracle delta not -1 single-run).

CONTRADICTIONS (per claim/contradiction-tracker, measurement doc :37-43): C1 spawner spawn-RunProc seam (consolidator R3 + fail-closed R6(1) + authorship all touch it — R3 lands first, boundaries named in its verify); C2 admission seam (chair replay a20eacd vs controller-auth unset-token — a20eacd independently verified, verifiedBy never reads verdict text = R8 hole); C3 run-artifact schema (goal-1 owns envelope+hashes, telemetry owns usage fields; unknown != 0); C4 refusal codes vs telemetry (recordRefusal boundary keeps historical hub_guard); C5 resolved (do not resurrect no-answer-in-public); C6 process vs task metrics (answer proxies != oracle delta — R9.1 rerun is the estimate with interval).

LESSON (prose): the challenge gate caught real holes twice this run — ch_2b6b8505 (git-config v1 bypass) and the stale-SHA flag on 5332854 — evidence for consensus-requires-scrutiny; every verify row must name the exact tip to merge (three cases: 28c8e06->22ae36d, 5332854->c5417e8). Maintainer: merge branches (1)-(5) named above with their verify entries; R9.1 rerun pending.


## swarm-010513-crup-chair-replay

state: open · messages: 15 · board entries: 3 · verify entries: verify/chair-replay-binding


No conclusion (seats died on credit refusals; boards and branches persist).


## swarm-010513-crup-consolidator-build

state: open · messages: 37 · board entries: 10 · verify entries: none


No conclusion (seats died on credit refusals; boards and branches persist).


## swarm-010513-crup-controller-build

state: open · messages: 35 · board entries: 7 · verify entries: verify/controller-authority-before, verify/controller-authority-regression-red, verify/controller-authority


No conclusion (seats died on credit refusals; boards and branches persist).


## swarm-010513-crup-r1-build

state: open · messages: 47 · board entries: 10 · verify entries: verify/context-handoff-self, verify/context-handoff


No conclusion (seats died on credit refusals; boards and branches persist).


## swarm-010513-crup-r9-build

state: open · messages: 24 · board entries: 10 · verify entries: none


No conclusion (seats died on credit refusals; boards and branches persist).


## swarm-010513-crup-recruit-prefix

state: concluded · messages: 49 · board entries: 8 · verify entries: verify/spawner-run-prefix, verify/recruit-room-run-prefix, verify/recruit-room-prefix


**Conclusion** (v3, tally {'agree': 2, 'disagree': 0, 'abstain': 0}, 2026-09-18T01:44:52.483Z):

DONE: recruit rooms inherit the run prefix. Red regression first: scripts/spawner-run-prefix.test.ts ("new_room without a run prefix inherits the requester room run prefix" asserts the ensured room matches /^(swarm-[0-9]{6}(?:-[a-z0-9]{4})?)-/) failed on base c0cf5a3 and passes after the fix. Fix in src/spawner.ts request(): an unprefixed newRoom is ensured/hooked as <requesterRunPrefix>-<newRoom> (sanitized [a-zA-Z0-9_-], <=64 chars); that prefixed name is the key for the per-run recruit caps (recruit-prefix-regression.ts test 6 asserts a third break-out in a run at its 2-recruit cap is REFUSED, red on c0cf5a3 and green on the fix, and that no room is created on refusal), and it feeds claimArea, worktree and the recruit prompt; nothing changes when the requester room has no prefix or newRoom already carries one, and replacement registration is untouched. Branch swarm/swarm-010513-crup-recruit-prefix/openrouter-recruit-16 @ acedaab (author openrouter-recruit-16; 288779c red-test-first + acedaab adopts recruit-15's 6-test regression scripts/recruit-prefix-regression.ts, credited to its author). Both regressions registered in scripts/offline-runner.mjs (9 tests total, all green). Verified in worktree at acedaab: npm run build OK; CHATROOM_DATA_DIR=/tmp/smoke-data-r16 PORT=18041 npx tsx scripts/smoke.ts prints "SMOKE OK"; npm test -> "[offline] OK (29 commands)". Smoke caveat: it inherits CHATROOM_DATA_DIR, so a stale persisted data/ from an earlier run makes the 'pair' opening-cap assert fail with 'Openings have already been revealed' (pre-existing, not from this change; fresh dir prints SMOKE OK). Self-check on board verify/spawner-run-prefix; independent verify/* by another connection still required. Findings: board findings/openrouter-recruit-16.


## swarm-010513-crup-safety-build

state: open · messages: 16 · board entries: 2 · verify entries: none


No conclusion (seats died on credit refusals; boards and branches persist).


## swarm-010513-crup-verify-verdicts

state: open · messages: 33 · board entries: 5 · verify entries: none


No conclusion (seats died on credit refusals; boards and branches persist).


## swarm-010513-gitconfig-build

state: concluded · messages: 52 · board entries: 8 · verify entries: verify/git-config-refusal


**Conclusion** (v3, tally {'agree': 2, 'disagree': 0, 'abstain': 0}, 2026-09-18T01:44:58.921Z):

Adopt branch swarm/swarm-010513-gitconfig-build/openrouter-recruit-13 (RED d7553ee = failing regression scripts/seat-git-config-regression.ts on main; GREEN 28c8e06 and 2becab1 = always-on GITCONFIG guard in src/seat.ts run_command ordered LETHAL, then GITCONFIG, then read-only MUTATING, refusing every `git config` form on write and read-only seats — including global-flag forms `git --no-pager config`, `git -c k=v config`, `git -C dir config` via the generalized regex /(^|[;&|]\s*)git(\s+-[^\s]+(\s+[^\s]+)?)*\s+config\b/ (closed the bypass openrouter-recruit-17 proved against 28c8e06; generalized per openrouter-recruit-14 review) — with a message pointing at GIT_AUTHOR_NAME/GIT_COMMITTER_NAME and the worktree-shared repository config; 22ae36d adds the `git -C` regression case; script added to offlineScripts). Verified locally by author: regression 10/10 green, npm run build exit 0, smoke prints SMOKE OK (fresh data dir), node scripts/offline-runner.mjs OK (28 commands). Pending: verify/* entry by a non-author naming this proposal, then result posted to parent swarm-010513-crup-room.


## swarm-010513-kick-build

state: open · messages: 72 · board entries: 15 · verify entries: none


No conclusion (seats died on credit refusals; boards and branches persist).


## swarm-010513-r2-heartbeat-build

state: open · messages: 33 · board entries: 10 · verify entries: verify/r2-heartbeat


No conclusion (seats died on credit refusals; boards and branches persist).


## swarm-010513-telemetry-build

state: open · messages: 43 · board entries: 9 · verify entries: verify/telemetry-usage


No conclusion (seats died on credit refusals; boards and branches persist).
