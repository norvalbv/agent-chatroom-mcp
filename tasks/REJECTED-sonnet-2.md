# Rejected candidate tasks (sonnet-2, swarm-150725-3vny)

| task | design | arm A result | cost per run | turns | verdict |
|---|---|---|---|---|---|
| bench-patch-exec | exact-answer: a 90-line text plus 6 sequential unified-diff patches (4-5 hunks each, drifted headers, 70% duplicate lines) under a fuzzy-placement SPEC (search order, delta against nominal, prevEnd, per-patch reset); answer is the final lines joined by `|`; the generator kept only instances where four naive variants each give a different final text | 3 of 3 (seeds 1-3) | 0.0483, 0.0537, 0.0430 | 3-5 | ceiling at the 3-seed screen; family closed |

Why: every seat wrote the SPEC as a scratch script and printed its output. A fully stated algorithm is reimplemented faithfully however long the trace; that naive variants would diverge does not matter because no seat implements a naive variant. Source is in commit bb838ea of branch swarm/swarm-150725-3vny/sonnet-2 (task tree and scripts/patch-exec-gen.ts), removed from the tree afterwards. Spend: 0.145 USD.

| lode-values | invented list language, exact 30-item output, 140-line program; only the general rule "lists are values, like integers" and "arguments are passed by value" stated, the aliasing corners (callee mutation, PUSH/SETAT of a list, = on nested lists) never spelled out; 6 wrong readings each change the answer | 3 of 3 (seeds 1-3) | 0.0500, 0.0519, 0.0499 | 4, 4, 4 | ceiling at the 3-seed screen |

Why (lode-values): value semantics is a rule the seat applies at every place a list is stored or passed; an interpreter written with deep copies (or immutable lists) gets it right without noticing a corner. Unlike stamp's nested DEF, no natural architecture (frame chain, host reference semantics) is silently wrong for one construct once the seat has read "lists are values". Source: commit 5b3625e of branch swarm/swarm-150725-3vny/sonnet-2, removed from the tree afterwards. Spend: 0.152 USD.

| lathe-fn | stamp sibling: unary first-class function values (FN/CALL), flat locals-then-globals scope rule stated as in stamp, closure capture never mentioned; make-adder, counter, nested-FN-writes-outer-local, curried compose, dynamic-arity picks; 28 printed values; 149-line program; 3 wrong readings (closure reads, closure writes, dynamic caller scope) each change the answer; independent spec-only interpreter (sonnet-5) reproduces the oracle | 3 of 3 (seeds 1-3) | 0.0459, 0.0474, 0.0484 | 4, 4, 4 | ceiling at the 3-seed screen; replicates sonnet-1's bench-arrow-fn-values (3/3) |

Why (lathe-fn): when function values are the subject of the program, the scope rule is salient and the seat applies it; stamp's closure prior fires only because a nested DEF is incidental to that program. Two independent builds of the function-value sibling (arrow-fn-values, lathe-fn) both went 3/3, so that dial on stamp is closed. Source: commit e2e5b83 of branch swarm/swarm-150725-3vny/sonnet-2, removed from the tree afterwards. Spend: 0.142 USD.
