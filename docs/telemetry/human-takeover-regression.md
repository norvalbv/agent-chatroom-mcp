# Human targeted-reply takeover regression

## Scope and decision continuity

Applies `humans-answered-once-by-hub-enforcement`, not a policy re-target:
the established nomination lease already chooses a successor after departure or
targeted timeout. The reply authorization guard incorrectly used the original
addressee instead. `identity-is-the-connection` remains unchanged: tests use
separate sessions. `proposal-is-a-document` remains unchanged.

Prior context read: `docs/fleet-174517-summary.md` and
`docs/fleet-181630-summary.md` (tracked counterparts of the fleet summaries).
The existing dashboard/report recommendations are not repeated here. Historical
motivation is `docs/decisions/humans-answered-once-by-hub-enforcement.md:10-14`:
live-7's human greetings drew three replies; live-8's enforced responder yielded
one short reply. The present evidence is a new deterministic reproduction, not a
claim that this edge case was observed in those historical runs.

## Reproduction and measured result

Branch: `swarm/swarm-214936-s3jy-human/human-research-build-2`.
Baseline: `9d069ee`.
Command: `npx tsx scripts/human-takeover-regression.ts`.

1. Alice and Bob join on separate sessions; human asks `@alice Can you check progress?`.
2. Alice leaves. The hub focuses Bob on the human ask and `responderFor` returns
   `{mine:true, who:'bob'}`.
3. Bob replies with `reply_to` identifying the human message.
4. Baseline refuses: `benji addressed that to bob, not you. Leave it to them.`
   The human must repeat/readdress the question despite an authorized successor.

Equivalent authorization failure follows the existing 60-second targeted lease.
The old addressee can still reply after another seat takes over, because the
same original-id comparison incorrectly permits it.

Initial four-case test was run before modifying source: 1/4 passed, exit 1.
Expanded seven-case suite against the baseline guard: 2/7 passed, exit 1.
After one-line guard replacement (`to !== p.id` becomes `!resp.mine`): 7/7 passed,
exit 0. Covers departure, timeout, pre-timeout exclusivity, post-takeover
exclusivity, register caps, explicit `@all`, and persisted departure/rejoin.
This is deterministic mechanic correctness, not measured end-task improvement.

Author validation:
- `npm run build`: exit 0.
- `npx tsx scripts/attention-gate-regression.ts`: 19/19, exit 0.
- `PORT=8947 npm run smoke`: SMOKE OK, exit 0 (script-owned server terminated).

No nominee-selection, timeout, pass/decline, schema, dashboard, or launcher change.
