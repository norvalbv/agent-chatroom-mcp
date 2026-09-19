# Ledger-scale: scaling module count breaks nothing, it changes strategy (room swarm-212551-3vhd)

Room `swarm-212551-3vhd-room`, builder sonnet-1, reviewer 6-astra-2 (codex), verifier `verifier` (both exited when
the hub restarted mid-run and did not return; the room could not conclude by vote, so this is reported directly
per the human maintainer's instruction, not a room-ratified conclusion). Generator:
`scripts/bench-build-ledger-scale-gen.ts`. Tests: `scripts/bench-build-ledger-scale.test.ts` (9/9),
`scripts/generator-file-regex-regression.ts` (2/2, an unrelated provenance-regex gap found in review), both
registered in `scripts/offline-runner.mjs`. `npm run build` and `npm test` green.

## Design

Same mechanism as `scripts/bench-build-ledger-gen.ts` (build-ledger-s1/s2), unchanged: `deriveLedger`/
`buildLedgerSrc` reused verbatim, same S01-S14 taxonomy and `LEDGER_KIND`, same fd3 + permission-allowlist oracle,
same `PUBLIC_TESTS`. The only change: N independently-seeded warehouse shards
(`src/wh01/` .. `src/whNN/`, five files each: types, inventory, orders, backorder, warehouse), one shared
`SPEC.md` stating every warehouse is independent. No coupling between shards, no new defect kind — this isolates
the module-count/total-size axis from the cross-module-invariant axis the unscaled family already exercises
within one shard. Sizes: shards=3 (15 modules), shards=8 (40 modules), shards=20 (100 modules); every shard draws
its own independent 9-of-14 defects, so total planted defects scale with N (27/72/180), not held at a fixed total
per size — the "clean filler shard" alternative was rejected in review as an even more obvious giveaway (see
Finding 1).

## Finding 1 (dispositive): this family cannot be admitted at any size

Non-author review (6-astra-2) found, before any paid screen, that `buildLedgerSrc`'s fully-fixed render is
content-independent of which defects were drawn: `bad(id) = defects.includes(id) && !fixed.has(id)`, so once
`fixed` covers a shard's own `defects`, `bad()` is false for every id regardless of which subset was chosen.
Every shard's fully-correct source is therefore byte-identical to every other shard's, no matter which of the
14 catalogued bugs it started with. A manual attack confirmed it: fixing only `wh01` from the public SPEC and
copying its 5 files verbatim over all 19 other warehouses in the 100-module instance scored 180/180 caught,
0 shipped, on the frozen oracle, without reading the other 95 source files (`evidence/replica-attack-result` on
the room board). **This is a structural property of "replicate the same generator N times," not an artifact of
one seed** — it recurs at every size and cannot be fixed by more seeds or more shards. It would need a
shard-specific SPEC-stated parameter that changes the correct source text per shard, or genuine cross-shard
coupling, to close (see Future work).

## Finding 2: a real single-agent screen independently discovers and uses the same shortcut, but only at the largest size

This was not just a deliberate attacker's finding. At N=20 (100 modules), both real Claude Sonnet screens (seeds
101, 102, arm A, effort medium) produced a workspace where all 20 warehouse directories are byte-identical
(`diff -r` confirmed), scoring 180/180 in 17 and 65 turns respectively, at $0.51 and $1.03 — **cheaper than most
of the N=8 (40-module) runs**, which did not use the shortcut at all (0 of 7 non-wh01 shards were byte-identical
in either N=8 run that missed a defect). So the module-count axis does not exhaust a single agent's read budget
here; past a size where the redundancy becomes obvious, the agent collapses the problem back to solving one
instance and copying it, which is *cheaper and more accurate* than reading everything. This directly negates the
axis's own premise for this design (see docs/build-suite-admission.md's "what was not tried" item 2 and
paper/amendments.md's "regex-repairable copies" caution): scaling identical replicas is not beyond-context work,
it is a compression opportunity a capable agent finds on its own.

## Size-versus-catch-rate table

| size (shards / modules) | seeds | caught / planted per seed | mean catch rate | notes |
|---|---|---|---|---|
| 3 shards / 15 modules | 101,102,103 | 27/27, 27/27, 27/27 | 100% | ceiling, all three at task_pass |
| 8 shards / 40 modules | 101-105 | 64/72, 72/72, 72/72, 72/72, 67/72 | 96.4% (347/360) | first non-ceiling signal; no copy-shortcut used (0/7 shards identical in either miss) |
| 20 shards / 100 modules | 101,102 | 180/180, 180/180 | 100% | ceiling again, via the copy-shortcut (Finding 2); stopped at 2 seeds — the mechanism is structural, not seed-dependent, and admission is already foreclosed by Finding 1 |

No size landed in [0.30, 0.70]. N=8 is the closest (96.4%), still far above band. Per the brief's own stop
conditions ("stop scaling when...falls into band...or exceeds budget; report the curve either way") and given
Finding 1 already forecloses admission at every size, scaling was stopped after 2 confirmatory N=20 seeds rather
than continuing to a full 5 (further seeds would reconfirm the same structural mechanism at real cost with no
new methodological information, and no reviewer/verifier remained after the hub restart to gate an eventual
admission attempt).

## N=8 per-defect catch table (pooled across 5 seeds x 8 shards = up to 40 shard-draws per id)

| defect | kind | planted | caught | rate |
|---|---|---|---|---|
| S01 | cross-module-contract | 30 | 30 | 100% |
| S02 | spec-vs-code | 27 | 27 | 100% |
| S03 | boundary | 29 | 29 | 100% |
| S04 | cross-module-contract | 19 | 19 | 100% |
| S05 | cross-module-contract | 24 | 24 | 100% |
| S06 | boundary | 30 | 30 | 100% |
| S07 | spec-vs-code | 28 | 28 | 100% |
| S08 | spec-vs-code | 37 | 29 | 78% |
| S09 | cross-module-contract | 25 | 21 | 84% |
| S10 | spec-vs-code | 22 | 22 | 100% |
| S11 | cross-module-contract | 21 | 20 | 95% |
| S12 | cross-module-contract | 22 | 22 | 100% |
| S13 | cross-module-contract | 23 | 23 | 100% |
| S14 | cross-module-contract | 23 | 23 | 100% |

S08 ("backorders are retried in the order they were placed") and S09 ("a cancelled order releases stock before
backorders are retried") were the only defects with real misses, both about ordering of side effects across a
retry/cancel call path, not a single-line value — the seed-101 run missed S08 identically in all 8 shards it
appeared in (a single-trap pattern, same shape as `stamp-interpreter` in paper/amendments.md), the seed-105 run
missed S09 in 4 of 5 shards plus one unrelated S11 miss.

## Admission and pilot

Not admitted at any size (Finding 1). No three-arm pilot was run — spending on `scripts/bench-build-grid.ts`
would not change Finding 1's structural conclusion, and the room's reviewer/verifier were unavailable after the
hub restart to gate it per `done-means-independently-verified`.

## Future work (for a next round, not built here)

1. Give each shard a SPEC-stated, shard-specific parameter that changes its *correct* source text (not just its
   runtime data), e.g. a per-warehouse grace-period or rounding rule stated in a per-shard SPEC section, so the
   fully-fixed answer is not universal across shards and a copy no longer scores.
2. Or add a genuine cross-shard invariant (a global backorder queue or transfer ledger spanning all N warehouses)
   so no single shard's fix is self-contained, closing the same hole from the coupling side instead of the
   content side.
3. Re-run the module-count axis on a family whose correct implementation is not derivable independent of which
   defects were planted (the billing or rules generators may or may not have the same degeneracy; not checked
   this round).

## Spend

Total real-model spend this room: **$7.81** of the ~15 USD ledger (10 screens: 3 at 15 modules, 5 at 40 modules,
2 at 100 modules, all arm A, effort medium, `--max-budget-usd 3` uniform per cell). Raw `result.json` per run:
`docs/build-suite-artifacts/ledger-scale/`. No pilot spend.

## Confirmatory command (if a future round wants more N=20 seeds)

```
node --import tsx scripts/bench-rq1.ts tasks/build-ledger-scale20-s10<N> A 10<N> --root /tmp/lsr/s20-10<N> --effort medium --max-budget-usd 3
```

Projected cost for 3 more N=20 seeds at the observed $0.51-$1.03/run range: **$1.50-$3.10**, well inside a
15 USD ledger, but not expected to change Finding 1 or the copy-shortcut mechanism in Finding 2.
