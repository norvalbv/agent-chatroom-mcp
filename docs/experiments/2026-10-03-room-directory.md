# Compact room directory rejected after live trials

The compact `list_rooms` default in candidate `809a208c` is **not selected for landing**. Both builds solved all three instances, while every candidate run cost more. The evidence commit retains the benchmark, an unapplied candidate patch and measurements only; it changes no runtime tools or prompts.

The candidate introduced a short directory, optional literal `prefix` and `state` filters, and `full=true` to restore the old full summary. Its deterministic MCP fixture reduced the same serialized listing from 10,378 to 918 bytes and passed confidentiality/filter/recovery checks that failed on baseline `31daae67`. Assigned reviewer opus-1 independently exercised another fixture, including anonymous labels and full-result equality. This established a working projection, not a task-level benefit. The live result below rejects the inference that fewer bytes in one response implies less total context or cost. Settled decisions `measure-task-success-on-a-machine-oracle` and `token-cost-is-resent-context` govern that distinction; no settled axis is re-targeted.

## Same-brief live measurement

Three Claude Opus 5.5 seats, including a verifier, ran each of three task instances on each build. Agents were asked to identify the open room owning deployment segment MERIDIAN, read its complete acceptance key, scrutinise the answer and change no other room. They were not told which discovery tools to use. Twelve seeded rooms included a target and decoy whose first 240 topic characters matched; the other ten previews named other segments. Corresponding arms used identical briefs, fixture hashes, model choices and recruit-policy pins. Recruits remained permitted. Each arm served its actual built hub; entry and whole-dist hashes are retained.

All baseline repetitions preceded all candidate repetitions. Both arms used `DISABLE_PROMPT_CACHING=1`: **uncached throughout**, not an estimate of normally cached sessions. The audit independently observed zero cache reads on the first request of all 18 seats and complete three-seat coverage per room. All subsequent reported cache reads and writes were also zero. Model turns mean unique provider request IDs, including final answers without tool calls. Costs come from the retained launcher usage; tool calls and result bytes come from normalized provider traces. Bytes mean UTF-8 tool text, excluding transport envelopes, and are not token counts.

| Arm | Rep | Oracle | Cost USD | Model turns | USD/turn | All tool calls | Hub calls | Hub text bytes | Conclusion seconds |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 1 | PASS | 3.418243 | 29 | 0.117870 | 40 | 40 | 94,419 | 36.781 |
| base | 2 | PASS | 3.278596 | 28 | 0.117093 | 34 | 34 | 95,209 | 25.160 |
| base | 3 | PASS | 3.491020 | 30 | 0.116367 | 36 | 36 | 91,097 | 33.161 |
| head | 1 | PASS | 3.766344 | 31 | 0.121495 | 38 | 36 | 113,321 | 36.907 |
| head | 2 | PASS | 4.471101 | 36 | 0.124197 | 52 | 52 | 117,311 | 42.490 |
| head | 3 | PASS | 3.716276 | 32 | 0.116134 | 51 | 50 | 97,421 | 32.226 |

Mean room cost rose from $3.395953 to $3.984574 (17.33%). Mean turns rose from 29 to 33; aggregate cost per model turn rose from $0.117102 to $0.120745. Mean total hub text rose from 93,575 to 109,351 bytes. Mean conclusion time was 31.701 versus 37.208 seconds. Per-pair latency was mixed, and other private rooms could run concurrently after the owner relaxed the initial queue; timing is descriptive. These small, non-randomized trials do not establish a general causal effect across other tasks or models.

All baseline seats used the existing full listing immediately. Candidate traces show additional compact listings, full listings and room-status lookups; the first candidate run made seven list calls versus three at baseline and returned 71,406 versus 50,903 bytes through that tool. Reduced first-response size did not offset added discovery work in this task. The normalized calls retain actual arguments and results so this explanation can be checked rather than inferred from aggregate cost alone. No claim is made about improved intuition, breakout formation, recruitment, or a universal preference for verbose tools. Filters or an opt-in compact result would require separate evaluation.

## Retained evidence and reproduction

- [All six run metrics, exact cold audits, fixture hashes, served build hashes and usage](../measurements/room-directory-2026-10-03.json).
- [Normalized calls, returned text, source trace hashes and cache audits](../measurements/room-directory-2026-10-03-traces.jsonl).
- [Deterministic projection fixture measurement](2026-10-03-room-directory.json).
- [Unapplied rejected candidate source/test/skill patch](room-directory-rejected-candidate.patch), based on `31daae67`; candidate remains at `809a208c`.
- Benchmark driver: `scripts/bench-room-directory.ts`. Build a clean export of `31daae67`; build another export with the retained patch applied. Run the same driver with `--build <export> --label <arm> --reps 3 --port <free-private-port> --out <json>`. Its model/recruit pins, neutral task cwd, cache disabling, seeded fixture and oracle are identical across arms. Never use port 7717. Driver stops only its owned private hub PID.

The oracle requires the exact room/key in the conclusion and unchanged seeded topics/message counts. It uses string inclusion rather than a general semantic judge; all six retained conclusions were also read and state the affirmative correct answer. All private hubs for this experiment are stopped. This is one read-only discovery task, not a broad organisation benchmark. The historical census found no observed `list_rooms` calls in its available 40-trace slice, so the controlled measurements must not be presented as historical savings.

Prior-art review was recorded **unverified** because no reference checkout was declared. GitHub MCP's [repository search](https://github.com/github/github-mcp-server/blob/71ef8266e48110974b13aef50b4df6ff9914ff68/pkg/github/search.go) provides an existing compact/default and full-result pattern; the [MCP tool specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) permits resource references for detail. These sources motivated an experiment and do not override its observed negative result.
