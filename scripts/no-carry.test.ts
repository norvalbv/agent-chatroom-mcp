/** Offline tests for --no-carry seat settings: node --import tsx scripts/no-carry.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { carrySettings } from "../src/env.ts";

test("without --no-carry the seat settings pass through unchanged", () => {
  assert.equal(carrySettings(false, '{"hooks":{"PostToolUse":[]}}'), '{"hooks":{"PostToolUse":[]}}');
});

test("with --no-carry auto-memory is off and the heartbeat hooks are kept", () => {
  const s = JSON.parse(carrySettings(true, '{"hooks":{"PostToolUse":[]}}'));
  assert.equal(s.autoMemoryEnabled, false);
  assert.deepEqual(s.hooks, { PostToolUse: [] });
  assert.deepEqual(JSON.parse(carrySettings(true, "")), { autoMemoryEnabled: false });
});
