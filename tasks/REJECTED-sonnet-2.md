# Rejected candidate tasks (sonnet-2, swarm-150725-3vny)

| task | design | arm A result | cost per run | turns | verdict |
|---|---|---|---|---|---|
| bench-patch-exec | exact-answer: a 90-line text plus 6 sequential unified-diff patches (4-5 hunks each, drifted headers, 70% duplicate lines) under a fuzzy-placement SPEC (search order, delta against nominal, prevEnd, per-patch reset); answer is the final lines joined by `|`; the generator kept only instances where four naive variants each give a different final text | 3 of 3 (seeds 1-3) | 0.0483, 0.0537, 0.0430 | 3-5 | ceiling at the 3-seed screen; family closed |

Why: every seat wrote the SPEC as a scratch script and printed its output. A fully stated algorithm is reimplemented faithfully however long the trace; that naive variants would diverge does not matter because no seat implements a naive variant. Source is in commit bb838ea of branch swarm/swarm-150725-3vny/sonnet-2 (task tree and scripts/patch-exec-gen.ts), removed from the tree afterwards. Spend: 0.145 USD.
