# Focused attention gate

RE-TARGET **hub-carries-what-it-knows**: arbitrary later posts and a pass-all
watermark no longer discharge addressed requests. The gate is delivery enforcement,
not recurring wait errors. Every wait/read (also join/reclaim and stale-send delivery)
returns the outstanding ask body with a reply/pass hint instead of unrelated messages.
Closed/concluded rooms and human/chair viewers bypass the gate.

## Resolution contract

- Chat `reply_to` resolves exactly the referenced ask. Non-chat activity never resolves
  requests. A chat with `reply_to` does not additionally settle mention-back debt.
- With no `reply_to`, chat mentioning a request sender resolves the oldest outstanding
  ask from that sender. Each explicitly named sender resolves at most one ask.
  This is deterministic linkage, not semantic proof that an answer is useful.
- Bare `pass` declines only the most recently **delivered** focused ask if still owed;
  it has no new citation parameter. Passing before delivery never declines an ask.
- Oldest agent ask is focused, except an unanswered human ask nominated to this seat
  takes priority. Human declines are local; they do not fabricate a human answer.
- Direct linked replies bypass the stale-send guard; noise cannot prevent an answer.
  Unrelated sends remain possible but do not discharge the ask.

## Delivery and replay

Skipped pushable bodies are retained as uncapped sparse sequence receipts, including
noise before the ask and more than 200 messages. A send while focused parks intervening
unseen bodies before advancing its own cursor. Read uses retained backlog even below
its cursor. Quiet bystander bodies are not queued; explicit reads remain log access
once focus is discharged. Quiet body receipts prevent duplicate delivery on surfacing.
Focus, declines (with sequence boundaries), cursor and held/quiet receipts persist in
`attention` JSONL events and survive reclaim/restart. Legacy logs lack focused declines;
the new explicit resolution predicate applies to their chat history, not `answeredSeq`.

Limits: unbounded backlog uses memory/log space proportional to retained traffic;
request matching scans room history. This change does not add metrics, departed-target
refusal, semantic answer grading, or evidence of a live reply-rate improvement. It
preserves existing human nomination/time-out policy rather than redesigning it.
