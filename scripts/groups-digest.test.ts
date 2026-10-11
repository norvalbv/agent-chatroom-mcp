/** The record a run keeps of its consolidation passes: npx tsx --test scripts/groups-digest.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { digestAcks, digestRecords, renderDigests } from "../src/groups.ts";

const passes = [
  { pass: 1, name: "digest-1", startedAt: "2026-10-11T01:00:00.000Z", finishedAt: "2026-10-11T01:03:10.000Z", cost: 0.8 },
  { pass: 2, name: "digest-2", startedAt: "2026-10-11T01:45:00.000Z", finishedAt: "2026-10-11T01:47:00.000Z", cost: 0.6 },
  { pass: 3, name: "digest-3", startedAt: "2026-10-11T02:30:00.000Z" },
];
const leads = {
  "digest/1": { text: '{"pass":1,"rooms":{"s-build":{"seq":40,"at":"x"}},"sent":["s-break"],"no_position":["s-build"],"unacknowledged":[]}\nitems', updated_at: "2026-10-11T01:03:00.000Z" },
  "digest/2": { text: "I sent notes to both groups.", updated_at: "2026-10-11T01:46:50.000Z" },
};

test("each pass is recorded with what the launcher saw and what the pass wrote", () => {
  const d = digestRecords(passes, leads);
  assert.deepEqual(d[0], { pass: 1, name: "digest-1", started_at: passes[0].startedAt, finished_at: passes[0].finishedAt, cost_usd: 0.8, written: true, sent: ["s-break"], no_position: ["s-build"], unacknowledged: [] });
  assert.equal(d[1].written, true, "a digest whose first line is not JSON was still written");
  assert.deepEqual(d[1].sent, [], "and reports nothing rather than guessing");
  assert.deepEqual({ written: d[2].written, finished_at: d[2].finished_at, cost_usd: d[2].cost_usd }, { written: false, finished_at: null, cost_usd: null }, "a pass killed before it wrote is recorded as such, with unknown cost");
  assert.deepEqual(digestRecords(passes, undefined).map((x) => x.written), [false, false, false], "an unreadable consolidation room is not a crash");
});

test("a group's latest note is acknowledged only by an ack written after it", () => {
  const acks = digestAcks("s-leads", {
    "s-build": { "inbox/s-leads/digest": { updated_at: "2026-10-11T01:46:00.000Z" }, "inbox/s-leads/digest.ack": { updated_at: "2026-10-11T01:48:30.000Z" } },
    "s-break": { "inbox/s-leads/digest": { updated_at: "2026-10-11T01:46:00.000Z" }, "inbox/s-leads/digest.ack": { updated_at: "2026-10-11T01:05:00.000Z" } },
    "s-third": {},
  });
  assert.deepEqual(acks[0], { room: "s-build", sent_at: "2026-10-11T01:46:00.000Z", acked_at: "2026-10-11T01:48:30.000Z", ack_seconds: 150 });
  assert.equal(acks[1].acked_at, null, "an ack from the pass before does not cover the new note");
  assert.deepEqual(acks[2], { room: "s-third", sent_at: null, acked_at: null, ack_seconds: null });
  const md = renderDigests(digestRecords(passes, leads), acks);
  assert.match(md, /\| 1 \| digest-1 \| 01:00:00 \| 01:03:10 \| \$0\.80 \| s-break \| s-build \| - \|/);
  assert.match(md, /\| 3 \| digest-3 \| 02:30:00 \| killed \| \? \| no digest written \|/);
  assert.match(md, /s-build: acknowledged after 150s; s-break: not acknowledged\./);
  assert.equal(renderDigests([], acks), "", "a run without passes has no section");
});
