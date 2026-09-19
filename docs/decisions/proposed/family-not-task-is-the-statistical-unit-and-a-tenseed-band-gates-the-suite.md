# Proposed decision: family-not-task-is-the-statistical-unit-and-a-tenseed-band-gates-the-suite

From swarm-150725-3vny (concluded); report: swarms/swarm-150725-3vny/report.md. A human promotes this into docs/decisions/ with `guard-decisions add`; nothing is adopted automatically.

DECISION RECORD

slug: `family-not-task-is-the-statistical-unit-and-a-tenseed-band-gates-the-suite`

context: Twenty-plus candidate tasks in the predecessor room, and roughly 45 designs in total, were rejected because one Sonnet seat passes them 5/5 in 2-8 turns. Three tasks had survived a five-seed rule, and two of them (doc-audit, ignore-rules) turned out to be 9/10 on ten seeds. A grid on such tasks could not separate one agent from a team, at 19 times the cost. In this room, three pilots showed how easily a rate misleads. A dead clause produced a false 5/10 (sched-trace-plus v1). A stray extra printed value produced a false 0/3 (layer-views). Printf's primary rate needed a file-backed re-run.

ruling:
- Admit a task only on at least ten arm-A seeds with file-backed results and a non-author spec-only attack.
- Pass rates map to status: 0.3-0.7 primary; above 0.7 up to 0.9 weak; between 0 and 0.3 low; above 0.9 or 0 retired; 3/3 at the three-seed screen rejects.
- A format failure is an excluded invalid run.
- A failing token shared by every failing seed must be traced to a sentence in the spec before the rate counts.
- Tasks built from one specification or mechanism are one family, and statistics use the family as the unit.
- `tasks/SUITE.json` is the machine-readable status table, and bench-grid refuses retired or unlisted ids without `--include-retired`.

consequences: The grid cannot spend money on ceiling tasks by accident. The paper's table comes from one file. Rates are reproducible from raw files. Ambiguity is caught before it is read as difficulty.

tradeoff: Only 3 tasks in 2 families are primary, against a target of at least 4. Every primary task is single-trap, so the rates measure the chance of one slip. Printf sits at the band's lower edge, and the pilot rates are selected, so grid rates will likely differ. About $10.7 of pilot spend and a lot of seat time bought that honesty.

researched: No new papers or URLs this run, so nothing is NEW against the settled arXiv list. What was read: the predecessor room board (`pilot/spend`, `pilot/*`), `paper/amendments.md`, the ADMISSION files, `scripts/bench-grid.ts`, `scripts/rq1-usage-budget.ts`, and the per-seed `result.json` files under `bench/results/suite-3vny/`. The settled axes I relied on are `measure-task-success-on-a-machine-oracle` and `done-means-independently-verified`. This work extends the first: the machine oracle now has a ten-seed band, a family unit and a status registry. It does not change either axis, so there is no RE-TARGET.

rejected:
- **Admit on 1-4 of 5 seeds:** fails on statistical power (a true 0.9 task passes it easily).
- **Keep inventing new families:** fails on evidence (about 45 designs, two mechanisms in band). The maintainer redirected to dial-turning.
- **Count a stray-print failure as a reasoning failure:** fails on validity.
- **Report printf on seeds 6-15 after seeing 16-20:** fails on pre-registration, so the record is seeds 6-20.
- **Pool seeds across tasks of one family:** fails on independence.
- **Pull in `scripts/bench-ak.ts`:** it was unproven and out of scope, so it was left on a separate branch.

revisit-when: A second family lands in 0.3-0.7 on ten or more file-backed seeds, or the real grid on seeds 101-140 shows a primary task's rate outside 0.15-0.85. Either would justify revising the band, the family count or the primary list.
