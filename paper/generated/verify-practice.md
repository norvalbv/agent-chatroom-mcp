# What peer verification exercised

243 verify heads in 28 rooms (16 hub, 10 web application, 2 other).
Exit code 0: 235/243; nonzero: 4/243; missing: 4/243. Commit named: 117/243.
Heads by a seat other than the proposal's author, where the author is known: 103.

| What the command ran | Hub rooms | Web rooms | Other | All | Not by the author |
|---|---|---|---|---|---|
| Build, type-check or the project's existing tests | 45 | 121 | 3 | 169/243 | 51/103 |
| Scripted smoke client against a built hub (no model seats) | 56 | 0 | 0 | 56/243 | 41/103 |
| A check the verifying seat wrote itself | 4 | 2 | 0 | 6/243 | 5/103 |
| The built application driven in a real browser | 0 | 12 | 0 | 12/243 | 6/103 |
| Model-driven agents run on the changed build | 0 | 0 | 0 | 0/243 | 0/103 |

Hand-labelled candidates: 28.
