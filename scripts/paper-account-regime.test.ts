import assert from "node:assert/strict";
import { test } from "node:test";
import { accountAt, buildTable, extractSwitches, type SeatRow } from "./paper-account-regime.js";

test("extractSwitches keeps only switch lines, carries no email, and sorts by time", () => {
  const log = [
    "2026-09-19 17:38:54,809 - INFO - Switched from account 1 to 4",
    "2026-09-19 17:39:00,000 - INFO - Usage for someone@example.com: 12%",
    "2026-09-19 14:01:51,766 - INFO - Switched from account 4 to 1",
  ].join("\n");
  const sw = extractSwitches(log);
  assert.equal(sw.length, 2);
  assert.deepEqual(sw.map((s) => [s.from, s.to]), [[4, 1], [1, 4]]);
  assert.ok(!JSON.stringify(sw).includes("@"));
});

test("accountAt: before the first switch it is the account that switch left; after, the account switched to", () => {
  const sw = [{ at: "2026-09-19T16:38:54.000Z", from: 1, to: 4 }, { at: "2026-09-19T18:01:34.000Z", from: 4, to: 1 }];
  assert.equal(accountAt(sw, Date.parse("2026-09-19T10:00:00Z")), 1);
  assert.equal(accountAt(sw, Date.parse("2026-09-19T17:00:00Z")), 4);
  assert.equal(accountAt(sw, Date.parse("2026-09-19T19:00:00Z")), 1);
  assert.equal(accountAt([], 0), null);
});

test("buildTable: a run straddling a switch is left out; long-thinking counts use the frozen 4000 threshold; only shared tasks are compared", () => {
  const sw = [{ at: "2026-09-19T10:00:00.000Z", from: 1, to: 4 }, { at: "2026-09-19T12:00:00.000Z", from: 4, to: 1 }];
  const at = (h: number, m = 0) => Date.parse(`2026-09-19T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  const row = (task: string, h: number, thinking: number | null, output: number, endH = h, endM = 5): SeatRow => ({ path: "x", task, arm: "A", started: at(h), completed: at(endH, endM), thinking, output });
  const t = buildTable(sw, [row("t1", 10, 9000, 9500), row("t1", 11, 3999, 5000), row("t1", 13, 900, 1500), row("t1", 11, 8000, 9000, 12, 30), row("only-one-account", 13, 800, 1200)]);
  assert.equal(t.runs_straddling_a_switch, 1);
  assert.deepEqual(t.thinking.map((r) => [r.account, r.n, r.long]), [[1, 2, 0], [4, 2, 1]]);
  assert.deepEqual(t.output.map((r) => [r.task, r.account, r.n]), [["t1", 1, 1], ["t1", 4, 2]]);
});
