# What peer verification did

260 verify/* writes whose first line is a JSON object, in 36 rooms and sub-rooms (24 hub project, 10 browser game, 2 other), created 2026-09-17 to 2026-09-23, before 2026-09-23T10:00:00Z.
Valid under the hub's own head parser: 241/260. Reported exit code 0: 238/260; nonzero: 4/260; missing: 18/260. Commit named: 128/260.
Coding: two independent coders agreed on 256/260 entries (Cohen's kappa 0.98); 4 were settled by an adjudicator.
Corrected after an independent review: 3.
Writer vs proposal author: 110 by a different seat, 11 by the author, 139 with the author unresolved.

| Strongest check the entry reports | Hub | Game | Other | All | Not by the author |
|---|---|---|---|---|---|
| Build, type-check or existing tests only | 31 | 95 | 0 | 126/260 | 31/110 |
| Scripted smoke client, model spawning off | 43 | 0 | 0 | 43/260 | 31/110 |
| Read code, docs or history; ran nothing | 6 | 1 | 3 | 10/260 | 3/110 |
| Added check: own probe or before/after run | 42 | 13 | 0 | 55/260 | 34/110 |
| The built application in a real browser | 0 | 26 | 0 | 26/260 | 11/110 |
| Model-driven agents on the changed build | 0 | 0 | 0 | 0/260 | 0/110 |
| Not enough detail to tell | 0 | 0 | 0 | 0/260 | 0/110 |
