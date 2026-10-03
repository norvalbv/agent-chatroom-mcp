# Cold-start evidence for harness comparisons

The historical cost comparison in `swarm-181144-uxtr` began with a warm baseline
and a cold release. Reanalysis of the retained traces confirms the existing
report: the three baseline seats each read 13,547 cached input tokens on their
first request, whereas the three release seats each read zero. The evidence,
including source trace hashes and first/later usage, is in
[harness-cold-start-audit.json](../measurements/harness-cold-start-audit.json).
This ratifies the prior report's limitation; it is not a new runtime improvement
or a benchmark of the current changes.

`scripts/swarm-tool-usage.py` now exposes each trace's `request_cache` and a run
`cold_start` verdict. It deduplicates assistant message IDs, preserves the first
request even when its usage is absent, and accepts cold only with an explicit
integer zero in `cache_read_input_tokens` and a preceding CLI initialization or
root user event. Missing fields, truncated starts, unsupported provider traces,
and seats with only aggregate sidecars are unknown. A later warm request does
not invalidate a cold start. Source artifacts must cover the actual room roster;
`--expected-seats` catches a mismatched artifact count but cannot authenticate
which seats belong to the room.

```sh
python3 scripts/swarm-tool-usage.py --run-dir swarms/RUN \
  --discover-claude --expected-seats 3 --require-cold-start > cache-audit.json
```

The optional check exits nonzero on warm or unknown evidence, including an empty
run. It writes the report before exiting so failures stay inspectable. Without
the check, historical analyses retain their previous successful CLI behavior.

Anthropic's [prompt-caching documentation](https://code.claude.com/docs/en/prompt-caching)
explains that cached prefixes live server-side, that changing conversation
content preserves earlier system/project prefixes, and that cache lifetimes vary
by request and billing mode. Consequently, a fresh room, process or user-message
nonce is not proof of a cold start. Its documented `DISABLE_PROMPT_CACHING=1`
control disables caching for every request. The
[environment-variable reference](https://code.claude.com/docs/en/env-vars)
also documents this control. Both pages were read on 2026-10-03.

A private Claude benchmark can set that variable on both launchers, verify the
reported cache reads, and explicitly report an **uncached throughout** regime.
Its costs cannot be extrapolated to default caching. A cold initial request with
caching enabled for later requests is a different regime; no prefix-isolation
method was established by this change. Flags document intent, while request
usage supplies evidence.

The measurement follows `measure-task-success-on-a-machine-oracle` and
`token-cost-is-resent-context`; neither ruling changes. Same-brief comparisons
still need the task oracle, build and brief hashes, model turns, tool calls,
provider usage/cost, conclusion time, and replication. A cold-cache check alone
does not establish an effective harness.

Validation: the existing Python regression suite was extended to exercise cold,
warm, absent/invalid fields, missing initial usage, incomplete traces, duplicate
blocks, sidecar-only seats, empty runs, expected-seat coverage and CLI exit
status. The new assertions fail against the parent analyzer and pass with the
change. The retained historical traces independently reproduce the warm/cold
classification above.
