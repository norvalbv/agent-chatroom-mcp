/** Test-first reply-metric contract. Run: npx tsx scripts/reply-metrics.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hub } from "../src/hub.js";

test("stats adds strict reply metrics; unrelated chat is activity, not a reply", () => {
  const hub = new Hub();
  const { room, participant: a } = hub.join("reply-metric-test", "asker", "test", { expectedParticipants: 0 });
  const { participant: b } = hub.join(room.name, "target", "test");
  hub.send(room.name, a.id, "@target Please check this", undefined, true);
  hub.send(room.name, b.id, "Unrelated progress", undefined, true);
  const before = (hub.stats(room) as any).reply_metrics;
  assert.ok(before, "hub.stats must expose reply_metrics");
  assert.equal(before.schema_version, 1);
  assert.equal(before.window_minutes, 15);
  assert.equal(before.mentions, 1);
  assert.equal(before.live_mentions, 1);
  assert.equal(before.answered_within_window, 0);
  assert.equal(before.activity_within_window, 1);
  assert.equal(before.reply_rate, 0);
  assert.equal(before.pending_live_mentions, 1);
  assert.equal(before.mature_live_mentions, 0);
  assert.equal(before.mature_reply_rate, null);
  assert.equal(before.declined_within_window, null);
  assert.equal(before.decline_coverage, "unknown");
  const ask = room.messages.find(m => m.kind === "chat" && m.from.id === a.id)!;
  hub.send(room.name, b.id, "Checked", ask.id, true);
  const after = (hub.stats(room) as any).reply_metrics;
  assert.equal(after.answered_within_window, 1);
  assert.equal(after.reply_rate, 1);
  assert.equal(after.pending_live_mentions, 1, "early replies remain pending in mature-window accounting");
});
