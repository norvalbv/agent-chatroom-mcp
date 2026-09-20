# Thinking regime by active subscription account

Single-seat runs (arm A, arm AH, and arm K attempts) in the switch-log window: 1947; 5 straddle a switch and are left out. Long thinking means at least 4000 thinking tokens.

| account | runs with thinking tokens | long-thinking runs | median thinking tokens | min | max |
|---|---|---|---|---|---|
| 1 | 40 | 0/40 | 968 | 463 | 1295 |
| 3 | 11 | 0/11 | 716 | 595 | 1316 |
| 4 | 385 | 384/385 | 7709 | 3742 | 31604 |

Output tokens, for tasks run under more than one account (recorded for every run, including runs from before thinking tokens were recorded):

| task | account | runs | median output tokens | min | max |
|---|---|---|---|---|---|
| bench-printf-format | 1 | 337 | 4645 | 3789 | 6595 |
| bench-printf-format | 3 | 26 | 4225 | 3726 | 5181 |
| bench-printf-format | 4 | 152 | 25144 | 16212 | 43700 |
| sched-trace | 1 | 5 | 2493 | 1962 | 3359 |
| sched-trace | 3 | 5 | 2934 | 1546 | 4022 |
| stamp-2 | 1 | 368 | 2228 | 1796 | 4773 |
| stamp-2 | 3 | 10 | 1892 | 1737 | 2077 |
| stamp-interpreter | 1 | 590 | 1716 | 1357 | 2232 |
| stamp-interpreter | 4 | 313 | 7310 | 4494 | 16896 |

Seats of every arm, by experiment directory and the account active when the seat ran:

| experiment | first seat start (UTC) | last seat end (UTC) | seats by account |
|---|---|---|---|
| rq1 | 2026-09-18T12:25Z | 2026-09-18T12:27Z | account 1: 4 |
| rq1-arm-b-exploratory-stop-174126 | 2026-09-19T18:18Z | 2026-09-19T18:39Z | account 1: 65 |
| rq1-arm-b-pilot | 2026-09-19T18:01Z | 2026-09-19T18:18Z | account 1: 30 |
| rq1-arm-b-pilot-sentinel | 2026-09-19T18:08Z | 2026-09-19T18:11Z | account 1: 5 |
| rq1-arm-k | 2026-09-19T13:22Z | 2026-09-19T15:33Z | account 1: 1000 |
| rq1-arm-k-pilot | 2026-09-19T13:08Z | 2026-09-19T13:12Z | account 1: 25 |
| rq1-confirmatory | 2026-09-19T20:03Z | 2026-09-20T11:45Z | account 1: 6; account 3: 11; account 4: 600; straddles a switch: 8 |
| rq1-confirmatory-pilot | 2026-09-19T19:27Z | 2026-09-19T19:36Z | account 1: 31 |
| rq1-confirmatory-pre-amendment | 2026-09-19T23:27Z | 2026-09-19T23:30Z | account 4: 1 |
| rq1-confirmatory-quota-invalidated | 2026-09-20T07:37Z | 2026-09-20T07:45Z | account 3: 2; account 4: 3 |
| rq1-drift-control | 2026-09-19T13:38Z | 2026-09-19T13:49Z | account 1: 60 |
| rq1-grid1 | 2026-09-18T12:44Z | 2026-09-18T12:52Z | account 1: 7 |
| rq1-grid2 | 2026-09-18T13:25Z | 2026-09-18T13:42Z | account 1: 40 |
| rq1-suite | 2026-09-19T07:43Z | 2026-09-19T11:30Z | account 1: 480 |
| rq1-window-control | 2026-09-19T16:45Z | 2026-09-19T18:11Z | account 1: 49; account 4: 104; straddles a switch: 3 |
| suite-3vny | 2026-09-18T14:25Z | 2026-09-18T16:01Z | account 1: 44; account 3: 141 |
