# tasks/bench-long-brief — R1 handoff measurement fixture

Deterministic long-brief task: 20 files / 600 records (~84KB) that must all be read and
verified. A seat's transcript of reading them exceeds the default `maxContextChars`
(240_000) before the work is done, and the work itself exceeds the frozen seat budget
(3 min / 60 steps), so a seat cannot finish. This is exactly the R1 pressure profile:
the seat must hand off *before* the hard caps (step cap / maxMinutes / silent trim).

## Why it is deterministic

If you are about to confirm that the fixture brief is longer than the budget, the proofs
are baked into `scripts/handoff-task-fixture.test.ts`: 40 reads (20 files x 2, each over
the 400-line window) x the 6000-char tool clamp = 240_000 chars > 0.9 x `maxContextChars`,
so the context-pressure threshold fires before the reading is done; and the minimal turn
count (40 reads + 20 ledger calls + join/finish = 62) exceeds the frozen 60-step budget.
The brief also mandates `board_set claim/bench-long-brief` up front, so the seat under test
holds a claim and the handoff/* written is deterministic (one handoff entry per owned claim).

## Acceptance (survival verdict), read from the arm's own data dir

1. Seat process exit code 0 (`ok` stays true; it is a handoff, not a crash).
2. At least one `handoff/*` board entry in the arm data dir jsonl:
   `CHATROOM_DATA_DIR/<room>.jsonl`, event `{"type":"board","key":"handoff/<area>"}`.
3. A `leave_room` reason naming the handoff: last `{"type":"leave"}` event carries
   `p.leaveReason` containing the handoff reference and what is done / where / undone.

No task answer is expected (`oracle.json` kind `handoff`); `answer.txt` absence scores
`parse_failure` in the baseline scorer, which is fine — the delta for this task is the
survival verdict above, not the answer.

## Runner support: pending-r9.1

`scripts/bench-bench.ts` currently waits for a room conclusion and cannot express the
seat-exit-as-completion barrier or the survival verdict; per lobby inbox
`r1-harness-split`, runner features belong to R9.1 (lobby `claim/goal-4-hash-closure`),
which folds per-arm `max_steps` env override + survival metric (handoff/* count, exit-0,
leave_room reason from the arm's own data dir) into its probe spec. This room's verify
entry records the before/after numbers by running the seat against throwaway hubs
(`PORT=8xxx node dist/index.js`) and notes the runner portion as pending-r9.1.
