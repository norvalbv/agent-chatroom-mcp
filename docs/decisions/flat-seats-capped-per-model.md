---
slug: flat-seats-capped-per-model
created: 2026-09-23
---

# flat-seats-capped-per-model

## Target · 2026-09-23 — A flat room puts at most 4 workers on one model unless asked

**Context:** swarm-083203-kooz ran 15 seats of one model for 42 minutes at $89.3 ($2.10/min). Rooms of 3-6 seats cost $0.45-0.95/min, and $/seat-minute stays in a 0.11-0.41 band across the 20 runs with usage data (median about 0.19), so cost is linear in seats. Output is not. Of kooz's 27 non-merge commits, at least 4 were duplication or cleanup after it: 8b9f7d2 and 223d512 are the same 157-line salvage landed 32 s apart, 63d5816 removed the duplicate, and 296ff27 was deleted by 1f9b213. The quorum did no deciding either. The last 34% of the run was amends that reset votes, and the room concluded at 3 of the 4 seats still present after 11 had left (evidence/kooz-15seat-anatomy). The same pattern recurred live in swarm-092653-202z: three seats salvaged the same hdju challenge-cut within 2 minutes (4a4e919, 7541247), five opened with the same seat-cap plan, and 14 of 15 openings gave one diagnosis. The mechanism: flat mode hands every worker a byte-identical brief, including the PRIOR RUNS pointer, so N copies of one model choose the same target at t≈0, before any claim/* exists for the overlap notice (self-organising-teams-by-claims-and-recruitment) to fire on.
**Ruling:** src/seat-cap.ts counts workers per provider:model using the launcher's own rotation. With --flat, swarm.ts exits 2 before starting the hub if more than DEFAULT_MAX_SAME_SEATS (4) workers share one model, unless --max-same-seats N is passed. Mixed-model rooms (the README's 12 seats over 4 models) still launch. skills/swarm/SKILL.md passes --max-same-seats 39 explicitly for the lobby, and src/fleet.ts passes --max-same-seats max(1, AGENTS-1) in both launches because the fleet wants its one-model room on purpose. A non-integer or <1 value exits 2 rather than silently disabling the cap (c23b7e9, 2b55d23).
**Consequences:**
- Positive: The default no longer buys linear cost for duplicated salvage. A maintainer who wants a big same-model room has to say so.
- Negative: This changes behaviour for the operator's own launches. A `--flat --agents 15` single-model research room (swarm-092653-202z's shape) now exits 2 until it passes --max-same-seats 14. That is intended, since a big same-model room becomes a deliberate choice, but existing launch commands have to be updated. 4 is not a measured optimum. It sits between the 3-6 seat rooms that ran cheaply and the 15-seat room that duplicated, and the 5-seat hdju room still had two seats collide on the same audit. Commit-level waste in kooz was modest (12 of 14 seats landed something, evidence/kooz-per-seat-landing), and most redundancy there was reading, reviews and writeups, which a cap only shrinks in proportion.
**Vision-fit:** n/a — internal tooling
**Researched:** No new literature. Own data: swarm-092653-202z evidence/seat-count, evidence/seat-redundancy, evidence/kooz-15seat-anatomy, evidence/kooz-per-seat-landing; git on swarm/swarm-083203-kooz/* against 858dbfa.
**Rejected:** (a) a hard cap with no override. The lobby and deliberate scale tests need more. (b) prompt-only advice to claim before salvaging. The overlap notice already exists and fires too late, since the collisions happen before the first claim.
**Revisit-when:** the machine-oracle bench (measure-task-success-on-a-machine-oracle) shows a same-model room of more than 4 beating one of 4 on the same brief; or distinct per-seat lenses remove the t≈0 collisions
**Scope:** src/seat-cap.ts,src/swarm.ts,src/fleet.ts,scripts/seat-cap-regression.ts,scripts/seat-env-regression.ts,skills/swarm/SKILL.md,README.md
**Source:** manual
