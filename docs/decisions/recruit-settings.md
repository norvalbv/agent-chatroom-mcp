---
slug: recruit-settings
created: 2026-10-26
---

# recruit-settings

## Target · 2026-10-26 — A recruit inherits its launching run's seat settings

**Context:** A recruit took its settings from the hub's environment, not from the run. On hub 7717 that meant effort high under an xhigh launcher. In 9f66, 18 of 23 agents were recruits.
**Ruling:** The launcher sends seat_settings on create, persisted in the room event. The spawner overlays them, walking parent links: the run first, then the hub, then the default. effort sets the level. Model, accounts and other env are not inherited. Telemetry: recruit_spawn with each setting's source. Built in a7d9f59e and 72bbc955 (recruit-settings; review/a7d9f59e and review/72bbc955 by machine-load).
**Consequences:**
- Positive: probe/recruit-settings-1 (n=1 per side, watched in review/recruit-settings-1): before, at 74fca9be: EFFORT=high, hooks copied, no record;; after: EFFORT=xhigh, no hooks, source run. The quality and cost effect of parity is UNMEASURED.
- Negative: Two runs on one hub now differ by design. The model pin stays the operator's.
**Vision-fit:** n/a — internal tooling: rooms that organise themselves and keep working seats
**Researched:** NEW sources/arXiv:2608.01347; NEW sources/arXiv:2608.20318; NEW sources/arXiv:2603.07915; NEW sources/code.claude.com-model-config; NEW sources/code.claude.com-sub-agents; NEW sources/slurm-sbatch-export.
**Rejected:** inheriting the model; copying accounts or free env; carrying OpenRouter reasoning and time limits (left as remaining work).
**Revisit-when:** recruit_spawn shows source hub for a launched run's recruit, or idea/recruit-effort-override is asked for.
**Scope:** scripts/claude-lean-flags-regression.ts,scripts/hook-bypass-regression.ts,scripts/offline-runner.mjs,scripts/recruit-settings-regression.ts,scripts/seat-compact-default-regression.ts,scripts/seat-env-regression.ts,scripts/seat-prompt-argv.test.ts,src/env.ts,src/hub.ts,src/hub/internal.ts,src/hub/persistence.ts,src/index.ts,src/seat/settings.ts,src/server.ts,src/spawner.ts,src/spawner/worktrees.ts,src/swarm.ts
**Source:** swarm-005940-77tu (RSI-5) prop_49a4a68e v7; promoted 2026-10-26 by the owner's choice (measured items only)
