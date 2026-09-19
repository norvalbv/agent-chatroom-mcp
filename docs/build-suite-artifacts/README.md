# Raw run artifacts

Every `result.json` (from `scripts/bench-rq1.ts`) and `build-result.json` (from 6-astra-4's `scripts/bench-build.ts`) produced
during the build-suite admission screens and the three-arm pilot, copied verbatim from the `/tmp` run roots referenced in
`docs/build-suite-admission.md` and `docs/build-suite-pilot.json`. `MANIFEST.json` records each file's original path and a
sha256 of its content taken at copy time. These are raw seat/runner output (including full seat transcript text where the
runner recorded it); `docs/build-suite-admission-runs.json` and `docs/build-suite-pilot.json` are the smaller derived tables
cited in the admission record and prereg. Runner/task commits: generators and tasks at `swarm/swarm-191133-4hqx/sonnet-1`
(see `git log` for the exact commit each screen ran against, noted in docs/build-suite-admission.md); the pilot ran
6-astra-4's `bench-build.ts` at `9c37a6b`.
