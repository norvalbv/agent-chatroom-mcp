# RQ1 table (generated, do not hand-edit)

## Per (task, arm)

| task | arm | n | task_pass | task_fail | parse_failure | timeout | infra_error | comparable_n | success_rate | cost_per_correct | mean_input_tok | mean_cache_read_tok | mean_cache_creation_tok | mean_output_tok | mean_turns | mean_wall_ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bench-printf-format | A | 40 | 14 | 26 | 0 | 0 | 0 | 40 | 0.350 | $0.2734 | 7.6 | 38263.7 | 10563.1 | 4575.5 | 4.70 | 42665 |
| bench-printf-format | C | 40 | 6 | 34 | 0 | 0 | 0 | 40 | 0.150 | $4.9657 | 77.2 | 1098081.8 | 74502.6 | 22707.8 | 58.58 | 97455 |
| stamp-2 | A | 40 | 28 | 12 | 0 | 0 | 0 | 40 | 0.700 | $0.0965 | 6.0 | 26168.3 | 9838.7 | 2295.9 | 4.00 | 27413 |
| stamp-2 | C | 40 | 40 | 0 | 0 | 0 | 0 | 40 | 1.000 | $0.5946 | 75.3 | 974678.1 | 59402.6 | 16186.6 | 55.90 | 85090 |
| stamp-interpreter | A | 40 | 33 | 7 | 0 | 0 | 0 | 40 | 0.825 | $0.0703 | 6.0 | 25807.7 | 8871.8 | 1734.4 | 4.00 | 20456 |
| stamp-interpreter | C | 40 | 40 | 0 | 0 | 0 | 0 | 40 | 1.000 | $0.6018 | 83.3 | 1074277.5 | 61137.2 | 14222.2 | 60.92 | 65565 |

## Arm A vs Arm C significance (paper/protocol.md §5: two-proportion z-test, or Fisher's exact when any cell <5)

| task | test | p_value | significant (α=0.05) |
|---|---|---|---|
| bench-printf-format | z | 0.038867 | true |
| stamp-2 | fisher | 0.000185 | true |
| stamp-interpreter | fisher | 0.011738 | true |
