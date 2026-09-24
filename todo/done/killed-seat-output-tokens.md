---
status: done
added: 2026-09-23
from: docs/reuse-survey-2026-09-23.md (Output tokens of a seat killed mid-run); Claude Code cost-tracking docs
done: 2026-09-24 430bf8a3 via reuse/cost-usage
---
# Count a killed seat's output tokens from the final usage, not placeholders

The stream loops in bench-build-runtime.ts and bench-rq1.ts sum output_tokens from assistant
events, which the docs call a placeholder. Probe first: kill one short seat mid-run with and
without `--include-partial-messages` and compare against the last message_delta usage. If it
holds, add the flag for stream-json seats and take each message's count from its last
message_delta.

Cost: much larger transcript.jsonl per seat. Subagent usage is still missing either way.
