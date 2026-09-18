# RQ1 table (generated, do not hand-edit)

## Per (task, arm)

| task | arm | n | task_pass | task_fail | parse_failure | timeout | infra_error | comparable_n | success_rate | cost_per_correct | mean_input_tok | mean_cache_read_tok | mean_cache_creation_tok | mean_output_tok | mean_turns | mean_wall_ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bench-bug-fix | A | 5 | 5 | 0 | 0 | 0 | 0 | 5 | 1.000 | $0.0507 | 10.0 | 96948.4 | 5107.8 | 970.2 | 5.00 | 16348 |
| bench-bug-fix | C | 5 | 5 | 0 | 0 | 0 | 0 | 5 | 1.000 | $0.9683 | 139.6 | 2460867.8 | 64097.0 | 21594.2 | 72.00 | 126189 |
| bench-fact-check | A | 5 | 5 | 0 | 0 | 0 | 0 | 5 | 1.000 | $0.0318 | 6.4 | 56974.6 | 3973.2 | 345.8 | 3.40 | 7835 |
| bench-fact-check | C | 5 | 5 | 0 | 0 | 0 | 0 | 5 | 1.000 | $0.5985 | 103.6 | 1622936.2 | 42764.6 | 9944.6 | 52.00 | 54621 |

## Arm A vs Arm C significance (paper/protocol.md §5: two-proportion z-test, or Fisher's exact when any cell <5)

| task | test | p_value | significant (α=0.05) |
|---|---|---|---|
| bench-bug-fix | fisher | 1.000000 | false |
| bench-fact-check | fisher | 1.000000 | false |
