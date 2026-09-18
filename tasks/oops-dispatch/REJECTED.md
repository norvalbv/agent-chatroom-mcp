# Rejected: oops-dispatch

Author sonnet-2 (predecessor), piloted by sonnet-1. Multiple-inheritance method dispatch with SUPER/SELF/HERE/OBJ over 19 PRINTs.
Oracle: `oracle/reference.mjs` and an independent Python interpreter written by sonnet-1 from `spec.txt` print the same 19 results.
Arm A, `bench-rq1.ts tasks/oops-dispatch A <seed> --model sonnet`: seeds 1, 2, 3 all task_pass, 4 turns each, $0.0450 / $0.0313 / $0.0482. 3 of 3 at the screen: retired (above 0.9). Seeds 4-10 not run.

## Sources removed
Retired at the 3-seed screen and covered by no test, so its `public/`, `oracle/`, `fixtures/` and `task.json` were removed from the tree (hygiene, tasks/SUITE.json). The last commit that holds them is `1035322` on swarm/swarm-150725-3vny/sonnet-6 (`git show 1035322:tasks/oops-dispatch/public`).
