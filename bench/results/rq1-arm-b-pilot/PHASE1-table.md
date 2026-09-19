# Arm-B vs arm-C diagnostic pilot (stamp-interpreter)

DIAGNOSTIC ONLY. n is at most 5 per arm; power is negligible (evidence/power-and-inference), so nothing here shows equivalence or a difference.

| arm | seed | outcome | cost USD | started (UTC) | completed (UTC) | output tokens per seat | build | deadline hit |
|---|---|---|---|---|---|---|---|---|
| B | 401 | task_pass | 0.104 | 18:08:02 | 18:09:11 | builder-1=1726 reviewer=1215 | 31824de | no |
| C | 401 | task_pass | 0.663 | 18:09:12 | 18:10:37 | seat-1=4865 seat-2=4888 seat-3=4995 | 31824de | no |
| B | 402 | task_pass | 0.104 | 18:10:38 | 18:11:36 | builder-1=1689 reviewer=1270 | 31824de | no |
| C | 402 | task_pass | 0.643 | 18:11:37 | 18:13:17 | seat-1=4782 seat-2=5005 seat-3=4975 | 31824de | no |
| B | 403 | task_pass | 0.106 | 18:13:19 | 18:14:05 | builder-1=1779 reviewer=1332 | 31824de | no |
| C | 403 | task_pass | 0.630 | 18:14:06 | 18:15:20 | seat-1=4598 seat-2=4447 seat-3=5119 | 31824de | no |
| B | 404 | task_fail | 0.105 | 18:15:21 | 18:16:01 | builder-1=1690 reviewer=1241 | 31824de | no |
| C | 404 | task_pass | 0.496 | 18:16:01 | 18:17:00 | seat-1=4217 seat-2=3614 seat-3=3977 | 31824de | no |
| B | 405 | task_pass | 0.103 | 18:17:01 | 18:17:41 | builder-1=1683 reviewer=1098 | 31824de | no |
| C | 405 | task_pass | 0.531 | 18:17:43 | 18:18:46 | seat-1=4587 seat-2=4304 seat-3=3897 | 31824de | no |
| A | 401 | task_pass | 0.059 | 18:08:27 | 18:08:53 | single=1648 | 31824de | no |
| A | 402 | task_fail | 0.061 | 18:08:55 | 18:09:21 | single=1849 | 31824de | no |
| A | 403 | task_fail | 0.059 | 18:09:25 | 18:10:18 | single=1748 | 31824de | no |
| A | 404 | task_fail | 0.061 | 18:10:21 | 18:10:51 | single=1759 | 31824de | no |
| A | 405 | task_fail | 0.064 | 18:10:51 | 18:11:17 | single=1962 | 31824de | no |

| arm | n | pass | pass rate | total cost USD | cost per pass USD |
|---|---|---|---|---|---|
| A | 5 | 1 | 0.20 | 0.305 | 0.305 |
| B | 5 | 4 | 0.80 | 0.523 | 0.131 |
| C | 5 | 5 | 1.00 | 2.963 | 0.593 |

No missing cells.
Fisher exact B vs C, two-sided, unadjusted: B 4/5 vs C 5/5, p = 1.0000
