Offline cost attribution for a swarm run from the Claude Code session logs of its seats
(~/.claude/projects/*<run-id>*/*.jsonl), deduplicated per API message id. Usage: python3 <script> <run-id>, e.g. 083203-kooz.
- by-tool.py: input tokens by the tool each API call chose, plus tool-result bytes by tool
- wait-fields.py: wait_for_messages payload bytes by field
- wake-causes.py: cost of the call that reads each wait result, by what woke the seat
- challenge-delta-replay.py: what the challenge delta (Hub.challengesDelta) would have saved, including later re-reads
