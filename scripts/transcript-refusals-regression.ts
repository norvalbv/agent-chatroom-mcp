/** What seats saw fail, read from their transcripts (idea/client-side-disconnects step 1; evidence/refusals-by-guard-
 * from-transcripts). The hub records only the refusals it gave; a seat that lost its MCP connection leaves no trace in
 * the room log. Run: npx tsx scripts/transcript-refusals-regression.ts */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { classifyFailure, transcriptFailures } from "../src/transcript-failures.js";

assert.equal(classifyFailure("3 message(s) arrived while you were composing. Read them (below); then retry"), "unread");
assert.equal(classifyFailure('"evidence/x" was written by bob at 2026-10-11T10:00:00Z; replacing it would discard their text.'), "ownership");
assert.equal(classifyFailure('MCP server "chatroom" is not connected'), "client:not-connected");
assert.equal(classifyFailure("ECONNRESET: The socket connection was closed unexpectedly."), "client:connection-reset");
assert.equal(classifyFailure("ECONNREFUSED: Unable to connect."), "client:connection-refused");
assert.equal(classifyFailure("<tool_use_error>Error: No such tool available: mcp__chatroom__wait_for_messages. Its MCP server"), "client:no-such-tool");
assert.equal(classifyFailure("MCP error -32001: Request timed out"), "client:timeout");
assert.equal(classifyFailure('"the old clause" was in prop_ab12cd34 v3, but bob amended it to v4 12 s ago and that text is gone.'), "amend-stale");
assert.equal(classifyFailure("I amended it already"), "other", "amend-stale only from the hub's own words (review/b6e4f285)");
assert.equal(classifyFailure("something new"), "other");

const dir = mkdtempSync(join(tmpdir(), "transcript-refusals-"));
try {
  const use = (id: string, name: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input: {} }] } });
  const res = (id: string, text: string, err = true) => JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: err, content: [{ type: "text", text }] }] } });
  const file = join(dir, "seat.jsonl");
  writeFileSync(file, [
    use("t1", "mcp__chatroom__send_message"), res("t1", "2 message(s) arrived while you were composing."),
    use("t2", "mcp__chatroom__wait_for_messages"), res("t2", 'MCP server "chatroom" is not connected'),
    use("t3", "mcp__chatroom__board_set"), res("t3", "ok", false),
    use("t4", "Bash"), res("t4", "command failed"),
    "not json",
  ].join("\n") + "\n");
  const rows = transcriptFailures([file]);
  assert.deepEqual(rows.map((r) => [r.tool, r.cls, r.n]).sort(), [["send_message", "unread", 1], ["wait_for_messages", "client:not-connected", 1]], "only failed chatroom calls, by class; a local tool's failure is not one");
  // the command over a run's result.json, which names each seat's transcript (ef7c221e)
  writeFileSync(join(dir, "result.json"), JSON.stringify({ scorecard: [{ name: "seat-1", transcript: file }, { name: "seat-2" }] }));
  const out = spawnSync(process.execPath, ["--import", "tsx", "scripts/transcript-refusals.ts", join(dir, "result.json")], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /\| seat-1 \| wait_for_messages \| client:not-connected \| 1 \|/);
  assert.match(out.stdout, /1 of 2 seats have a transcript/);
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log("transcript-refusals-regression OK");
