## Arm K (k independent single-agent attempts, oracle-free selection)

Holm-Bonferroni over a fixed family of 6 (3 tasks x {K vs C, K vs A}), two-sided unpaired Fisher on K groups vs all arm A/C runs of the task, raw and adjusted p side by side; ceiling rows are outside the family.

| task | groups | K pass | K vs | other pass/n | Fisher p | Holm p | significant (Holm, 0.05) |
|---|---|---|---|---|---|---|---|
| bench-printf-format | 40 | 7/40 | C | 6/40 | 1.000000 | 1.000000 | false |
| bench-printf-format | 40 | 7/40 | A | 14/40 | 0.126277 | 0.577840 | false |
| stamp-2 | 40 | 39/40 | C | 40/40 | 1.000000 | 1.000000 | false |
| stamp-2 | 40 | 39/40 | A | 28/40 | 0.001495 | 0.008968 | true |
| stamp-interpreter | 40 | 36/40 | C | 40/40 | 0.115568 | 0.577840 | false |
| stamp-interpreter | 40 | 36/40 | A | 33/40 | 0.517892 | 1.000000 | false |

### Cost (arm K cost is the sum over all k attempts, killed attempts included)

| task | mean K cost/seed (known) | groups with unknown cost | null votes (harness) | unloadable candidates (selector) | paired mean C cost | K-C paired diff | mean A cost (all seeds) | K <= C | K cost per correct |
|---|---|---|---|---|---|---|---|---|---|
| bench-printf-format | 0.6772 | 0 | 0 | 0 | 0.7449 | -0.0676 | 0.0957 | true | $3.8699 |
| stamp-2 | 0.5317 | 0 | 0 | 0 | 0.5946 | -0.0628 | 0.0676 | true | $0.5454 |
| stamp-interpreter | 0.5732 | 0 | 0 | 0 | 0.6018 | -0.0286 | 0.0580 | true | $0.6368 |

### Vote distribution per group (sorted answer counts, e.g. 7-2-1 = seven attempts agree, two agree, one alone; none = no attempt answered)

- bench-printf-format: 4-3 x13, 5-2 x13, 6-1 x11, 7 x3
- stamp-2: 7-1 x11, 8 x10, 6-2 x10, 5-3 x3, 5-2-1 x3, 6-1-1 x2, 4-4 x1
- stamp-interpreter: 6-4 x6, 9-1 x6, 10 x4, 7-3 x4, 7-2-1 x3, 6-3-1 x2, 5-4-1 x2, 5-3-1-1 x2, 8-2 x2, 4-4-1-1 x2, 4-4-2 x1, 6-2-2 x1, 6-2-1-1 x1, 5-3-2 x1, 8-1-1 x1, 5-5 x1, 5-2-2-1 x1

### Oracle ceiling (NOT an arm: any of the k attempts passes; a bound on what selection could reach, never a result)

| task | groups where any attempt passes | ceiling |
|---|---|---|
| bench-printf-format | 37/40 | 0.925 |
| stamp-2 | 40/40 | 1.000 |
| stamp-interpreter | 40/40 | 1.000 |

