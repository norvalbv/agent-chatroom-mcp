# What peer verification did

260 verify/* writes whose first line is a JSON object, in 36 rooms and sub-rooms (24 hub project, 10 browser game, 2 other), created 2026-09-17 to 2026-09-23, before 2026-09-23T10:00:00Z.
Valid under the hub's own head parser: 241/260. Reported exit code 0: 238/260; nonzero: 4/260; missing: 18/260. Commit named: 128/260.
Coding: two independent coders agreed on 256/260 entries (Cohen's kappa 0.98); 4 were settled by an adjudicator.
Entries by a seat other than the proposal's author, where the author is known: 110.

| Strongest check the entry reports | Hub | Game | Other | All | Not by the author |
|---|---|---|---|---|---|
| Build, type-check or existing tests only | 30 | 97 | 0 | 127/260 | 33/110 |
| Scripted smoke client, model spawning off | 43 | 0 | 0 | 43/260 | 31/110 |
| Read code, docs or history; ran nothing | 7 | 1 | 3 | 11/260 | 3/110 |
| A check the verifying seat wrote itself | 42 | 12 | 0 | 54/260 | 33/110 |
| The built application in a real browser | 0 | 25 | 0 | 25/260 | 10/110 |
| Model-driven agents on the changed build | 0 | 0 | 0 | 0/260 | 0/110 |
| Not enough detail to tell | 0 | 0 | 0 | 0/260 | 0/110 |
