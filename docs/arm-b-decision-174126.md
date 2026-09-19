# Decision record (candidate): arm-b-is-a-no-chat-pipeline-with-an-isolated-reviewer

From swarm-174126-0s5m (open round); built by sonnet-5 on `swarm/swarm-174126-0s5m/sonnet-5` (3fbb33f). Written here because `docs/decisions/` is append-only through `guard-decisions`; a human promotes it with `guard-decisions add arm-b-is-a-no-chat-pipeline-with-an-isolated-reviewer --target measure-task-success-on-a-machine-oracle`. No RE-TARGET: it fills a gap in the pre-registered protocol.

- **context:** RQ2 (`paper/protocol.md` 1 and 2.1) asks whether the chatroom beats a no-chat builder+reviewer pair. Arm B was pre-registered but absent from `scripts/bench-rq1.ts` (parser accepted only A|C), so RQ2 had no cost or success evidence, and the K-vs-C result cannot say whether communication, rather than extra attempts or a second look, explains arm C.
- **ruling:** `bench-rq1.ts TASK B SEED` runs builder-1 (arm-A prompt and tools, no MCP), then a reviewer given the brief and the builder's final message, then at most one builder-2 revision.
  1. The reviewer runs in `<root>/review-workspace`, a copy of the builder's workspace, with only Read/Bash/Glob/Grep. Bash can write anywhere, so "the reviewer cannot edit" is enforced by isolation, not by the prompt. Only the builder's workspace is revised and scored.
  2. `--deadline-ms` is one budget for the whole pipeline (each stage gets the remainder; later stages are skipped once it is spent), so B cannot run up to 3x the wall-clock cap of A/C.
  3. Anything other than a leading `APPROVE` is a revision request, so a malformed review never silently approves. Any stage killed by the deadline forces outcome `timeout`.
  4. B is not budget-matched (`budget: null`, like C). Usage is summed over every stage; unknown stays unknown.
  5. `frozen.seats` is `seatRecords.length` for every arm.
- **consequences:** RQ2 can be run with `node --import tsx scripts/bench-rq1.ts TASK B SEED --root DIR`. `scripts/bench-grid.ts` still accepts only A|C|K, so a B grid needs its own wiring, and the A-is-budget-matched-to-C pairing does not apply to B.
- **tradeoff:** Process isolation is not a hostile-code sandbox; it enforces artifact ownership for cooperative seats. The reviewer copy contains any scratch files the builder left (not separable from a code task's output), so it may see slightly more than the final message. One revision round is the protocol's ceiling, not tuned.
- **researched:** nothing new fetched; `paper/protocol.md` 2.1/2.4, `scripts/bench-rq1.ts`, `src/claude-args.ts`, `src/env.ts` (seat identity via GIT_AUTHOR_NAME keys the offline stubs).
- **rejected:** one workspace shared by builder and reviewer (matches arm C's shared cwd, but a Bash-capable reviewer can change the scored answer with no builder revision); a fresh deadline per stage (breaks "same wall-clock timeout per task").
- **revisit-when:** a real arm-B pilot exists, or the harness moves to a CLI mode that can deny writes to the reviewer outright.
- **tests:** `scripts/bench-rq1.test.ts` (15): approve path, one-revision path, reviewer-tamper isolation, shared deadline. Each new one was red before its fix. Test 7 (arm A, 500 ms kill race) flakes identically on f2a8d5a at load average ~90.
