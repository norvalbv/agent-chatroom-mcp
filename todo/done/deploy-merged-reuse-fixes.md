---
status: done
added: 2026-09-24
from: merge of the six reuse branches into main (aa2f912d)
after: pool-2-game
done: 2026-09-24 hub restarted on e303d5d5 (gated: 0 launchers, 0 sessions); npm ci --ignore-scripts; skill copies synced; decision promoted in 32eb4c8c
---
# Deploy the merged reuse fixes to the shared hub

main now carries the reuse fixes, but the main checkout's node_modules and dist/ are unchanged on
purpose: the hub on 7717 serves main's dist/, and pool runs link main's node_modules.

When no pool run and no room is live (gate: zero `node dist/swarm.js` launchers, zero live seats):
1. `npm ci` in the main checkout (adds @anthropic-ai/sandbox-runtime and @stryker-mutator/core);
   note husky's prepare step and precommit-hooks-not-running before letting scripts run.
2. `npm run build`, then restart the 7717 hub. Open proposals whose verify entries lack
   fail-to-pass fields stop counting after the restart (review-quality risk).
3. Copy skills/swarm/SKILL.md over ~/.claude/skills/swarm/SKILL.md (both copies must match).
4. Owner: promote docs/decisions/proposed/verify-head-fail-to-pass.md with `guard-decisions add`,
   or reject it.
