/** Codex seat usage from `codex exec --json`: node --import tsx scripts/codex-seat.test.ts
 * turn.completed carries the thread's running total (docs/reuse-survey-2026-09-23.md, skeptic check; confirmed on a real
 * two-turn gpt-6-astra thread, recorded in seat-launch-fixture.ts), so the seat's usage is the last event, not a sum. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { codexUsageTracker, turnCompletedUsage, type CodexUsageSidecar } from "../src/codex-seat.ts";
import { CODEX_TWO_TURN_JSONL, CODEX_TWO_TURN_SIDECAR } from "./seat-launch-fixture.ts";

const feed = (chunks: (string | Buffer)[]) => {
  const seen: CodexUsageSidecar[] = [];
  const track = codexUsageTracker((u) => seen.push(u));
  for (const c of chunks) track(c);
  return seen;
};

test("the recorded two-turn stream: the last turn.completed is the seat's usage, the two are never summed", () => {
  const seen = feed([CODEX_TWO_TURN_JSONL]);
  assert.equal(seen.length, 2, "one update per turn.completed, so a seat stopped after the first keeps it");
  assert.deepEqual(seen.at(-1), CODEX_TWO_TURN_SIDECAR);
  assert.equal(seen.at(-1)!.prompt_tokens, 44084, "not 19390 + 44084");
  assert.equal(seen.at(-1)!.cost, null, "codex reports no USD: unknown, never 0");
});

test("lines and multi-byte characters split across chunks still parse", () => {
  const stream = '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"déjà vu ✓"}}\n' + CODEX_TWO_TURN_JSONL;
  const bytes = Buffer.from(stream, "utf8");
  const chunks: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += 7) chunks.push(bytes.subarray(i, i + 7));
  assert.deepEqual(feed(chunks).at(-1), CODEX_TWO_TURN_SIDECAR);
});

test("anything that is not a turn.completed with numeric usage is ignored", () => {
  assert.deepEqual(feed(["not json\n", '{"type":"turn.failed","error":{"message":"quota"}}\n', '{"type":"turn.completed","usage":{"input_tokens":"12"}}\n', '{"type":"turn.completed"}\n']), []);
  assert.deepEqual(feed(['{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":1}}']), [], "a line is only complete at its newline");
  assert.deepEqual(turnCompletedUsage('{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":1,"cached_input_tokens":"x","extra":3}}'), { input_tokens: 5, output_tokens: 1 });
});
