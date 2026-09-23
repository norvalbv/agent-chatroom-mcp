/** A killed claude seat's output tokens come from each message's final message_delta, not the assistant-event
 * placeholder: node --import tsx scripts/killed-seat-output-tokens.test.ts
 * Source: Claude Code cost-tracking docs (an assistant message's output_tokens is only the count at message_start);
 * docs/reuse-survey-2026-09-23.md "Output tokens of a seat killed mid-run"; todo/killed-seat-output-tokens.md. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeArgs } from "../src/claude-args.ts";
import { runClaudeSeat } from "./bench-build-runtime.ts";
import { estimateFrom } from "./pool-run.ts";
import { estimateSeatCost, listPriceUsd, PRICE_ROWS, StreamUsage } from "./seat-cost-estimate.ts";

/** Recorded 2026-09-23: a claude-opus-5-5 stream-json seat with --include-partial-messages, SIGTERMed at 60 s.
 * Kept: init, message_start/delta/stop and each assistant event's id, model and usage (ids shortened, text and
 * content_block_delta events dropped). msg_5 was in flight at the kill. The CLI's own session log recorded
 * output_tokens 49, 134, 1658 and 2334 for msg_1..msg_4, the message_delta values. */
const KILLED_SEAT: object[] = [
  {"type":"system","subtype":"init","model":"claude-opus-5-5"},
  {"type":"stream_event","event":{"type":"message_start","message":{"id":"msg_1","usage":{"output_tokens":16}}}},
  {"type":"assistant","message":{"id":"msg_1","model":"claude-opus-5-5","usage":{"input_tokens":2,"cache_creation_input_tokens":572,"cache_read_input_tokens":3692,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":572},"output_tokens":16},"content":[{"type":"tool_use"}]}},
  {"type":"stream_event","event":{"type":"message_delta","usage":{"output_tokens":49}}},
  {"type":"stream_event","event":{"type":"message_stop"}},
  {"type":"stream_event","event":{"type":"message_start","message":{"id":"msg_2","usage":{"output_tokens":16}}}},
  {"type":"assistant","message":{"id":"msg_2","model":"claude-opus-5-5","usage":{"input_tokens":2,"cache_creation_input_tokens":109,"cache_read_input_tokens":4264,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":109},"output_tokens":16},"content":[{"type":"tool_use"}]}},
  {"type":"stream_event","event":{"type":"message_delta","usage":{"output_tokens":134}}},
  {"type":"stream_event","event":{"type":"message_stop"}},
  {"type":"stream_event","event":{"type":"message_start","message":{"id":"msg_3","usage":{"output_tokens":4}}}},
  {"type":"assistant","message":{"id":"msg_3","model":"claude-opus-5-5","usage":{"input_tokens":2,"cache_creation_input_tokens":1703,"cache_read_input_tokens":4373,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":1703},"output_tokens":4},"content":[{"type":"thinking"}]}},
  {"type":"assistant","message":{"id":"msg_3","model":"claude-opus-5-5","usage":{"input_tokens":2,"cache_creation_input_tokens":1703,"cache_read_input_tokens":4373,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":1703},"output_tokens":4},"content":[{"type":"text"}]}},
  {"type":"assistant","message":{"id":"msg_3","model":"claude-opus-5-5","usage":{"input_tokens":2,"cache_creation_input_tokens":1703,"cache_read_input_tokens":4373,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":1703},"output_tokens":4},"content":[{"type":"tool_use"}]}},
  {"type":"stream_event","event":{"type":"message_delta","usage":{"output_tokens":1658}}},
  {"type":"stream_event","event":{"type":"message_stop"}},
  {"type":"stream_event","event":{"type":"message_start","message":{"id":"msg_4","usage":{"output_tokens":8}}}},
  {"type":"assistant","message":{"id":"msg_4","model":"claude-opus-5-5","usage":{"input_tokens":2,"cache_creation_input_tokens":5719,"cache_read_input_tokens":6076,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":5719},"output_tokens":8},"content":[{"type":"thinking"}]}},
  {"type":"assistant","message":{"id":"msg_4","model":"claude-opus-5-5","usage":{"input_tokens":2,"cache_creation_input_tokens":5719,"cache_read_input_tokens":6076,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":5719},"output_tokens":8},"content":[{"type":"text"}]}},
  {"type":"assistant","message":{"id":"msg_4","model":"claude-opus-5-5","usage":{"input_tokens":2,"cache_creation_input_tokens":5719,"cache_read_input_tokens":6076,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":5719},"output_tokens":8},"content":[{"type":"tool_use"}]}},
  {"type":"stream_event","event":{"type":"message_delta","usage":{"output_tokens":2334}}},
  {"type":"stream_event","event":{"type":"message_stop"}},
  {"type":"stream_event","event":{"type":"message_start","message":{"id":"msg_5","usage":{"output_tokens":8}}}},
];
const ndjson = (events: object[]) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";
const FINAL = [49, 134, 1658, 2334];

test("stream-json seats ask for partial messages; json seats do not", () => {
  assert.ok(claudeArgs({ mcpJson: "/m.json", tools: ["Read"], outputFormat: "stream-json" }).includes("--include-partial-messages"));
  assert.ok(!claudeArgs({ mcpJson: "/m.json", tools: ["Read"], outputFormat: "json" }).includes("--include-partial-messages"));
});

test("each message's output count is its last message_delta; summing assistant events counted placeholders", () => {
  const s = new StreamUsage();
  for (const e of KILLED_SEAT) s.consume(e);
  const placeholders = KILLED_SEAT.filter((e: any) => e.type === "assistant").reduce((n, e: any) => n + e.message.usage.output_tokens, 0);
  assert.equal(placeholders, 68, "what the stream loops used to record");
  assert.deepEqual(s.messages().map((m) => m.usage.output_tokens), FINAL, "msg_5 had no assistant event, so it is not a message yet");
  assert.equal(s.outputTokens(), 4175);
  assert.equal(s.finalOutputMessages(), 4);
});

test("a message killed before its message_delta keeps its placeholder, and is counted as not final", () => {
  const cut = KILLED_SEAT.findIndex((e: any) => e.event?.type === "message_delta" && e.event.usage.output_tokens === 2334);
  const s = new StreamUsage();
  for (const e of KILLED_SEAT.slice(0, cut)) s.consume(e);
  assert.deepEqual(s.messages().map((m) => m.usage.output_tokens), [49, 134, 1658, 8]);
  assert.equal(s.finalOutputMessages(), 3);
});

test("a transcript without stream events (older seats, session logs) prices exactly as before", () => {
  const s = new StreamUsage();
  for (const e of KILLED_SEAT.filter((e: any) => e.type !== "stream_event")) s.consume(e);
  assert.deepEqual(s.messages().map((m) => m.usage.output_tokens), [16, 16, 4, 8]);
  assert.equal(s.finalOutputMessages(), 0);
});

test("a subagent's stream events (parent_tool_use_id) do not overwrite the main stream's message", () => {
  const s = new StreamUsage();
  const ev = (event: object, parent?: string) => ({ type: "stream_event", event, ...(parent ? { parent_tool_use_id: parent } : {}) });
  const asst = (id: string) => ({ type: "assistant", message: { id, usage: { output_tokens: 1 } } });
  for (const e of [ev({ type: "message_start", message: { id: "main" } }), ev({ type: "message_start", message: { id: "sub" } }, "toolu_1"), asst("main"), asst("sub"),
    ev({ type: "message_delta", usage: { output_tokens: 500 } }), ev({ type: "message_delta", usage: { output_tokens: 70 } }, "toolu_1")]) s.consume(e);
  assert.deepEqual(s.messages().map((m) => [m.id, m.usage.output_tokens]), [["main", 500], ["sub", 70]]);
});

test("the killed seat's cost estimate prices the final output counts", () => {
  const row = PRICE_ROWS["claude-opus-5-5"]!;
  const s = new StreamUsage();
  for (const e of KILLED_SEAT) s.consume(e);
  const expected = s.messages().reduce((n, m) => n + listPriceUsd(m.usage, row)!, 0);
  const est = estimateSeatCost(s.messages(), ["claude-opus-5-5"], "claude-opus-5-5");
  assert.ok(est && Math.abs(est.usd - expected) < 1e-12 && est.messages_priced === 4);
  const pool = estimateFrom(ndjson(KILLED_SEAT), []);
  assert.equal(pool.cost_estimated, true);
  assert.ok(Math.abs(pool.cost_usd! - expected) < 1e-12, `pool-run estimateFrom: ${pool.cost_usd} vs ${expected}`);
  const withPlaceholders = estimateSeatCost(KILLED_SEAT.filter((e: any) => e.type === "assistant").map((e: any) => ({ id: e.message.id, usage: e.message.usage })), ["claude-opus-5-5"], "claude-opus-5-5")!;
  assert.ok(Math.abs(expected - withPlaceholders.usd - ((4175 - 44) * 20) / 1e6) < 1e-12, "placeholders (16+16+4+8) under-priced output by $0.083 in one minute");
});

test("runClaudeSeat (bench-build-runtime, pool solo/split seats) records the final count for a seat killed at its deadline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "killed-seat-tokens-"));
  try {
    const fake = join(dir, "claude");
    writeFileSync(join(dir, "events.jsonl"), ndjson(KILLED_SEAT));
    writeFileSync(fake, `#!/usr/bin/env node
process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(join(dir, "events.jsonl"))}, 'utf8'));
setInterval(() => {}, 1000);
`);
    chmodSync(fake, 0o755);
    const args = claudeArgs({ mcpJson: "/m.json", tools: ["Read"], model: "claude-opus-5-5", outputFormat: "stream-json" });
    const rec = await runClaudeSeat("seat-1", args, dir, 1500, { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, stdin: "brief" });
    assert.equal(rec.killed_by_deadline, true);
    assert.equal(rec.partial_usage?.output_tokens, 4175);
    assert.equal(rec.partial_usage?.output_tokens_final_messages, 4);
    assert.equal(rec.partial_usage?.assistant_messages_observed, 8, "assistant events, as before");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
