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

/** Lines as claude-swap 0.25.0's own serializers print them (SwitchEvent/PollEvent/NoSwitchEvent.to_json, and a manual
 * `cswap switch --json` result), with example emails; plus a stderr line, as `cswap auto --json >> log 2>&1` leaves. */
const CSWAP_AUTO_JSON = [
  '{"schemaVersion": 1, "event": "poll", "ts": "2026-09-23T13:59:00Z", "active": {"number": 1, "email": "one@example.com"}, "headroomPct": {"1": 8.0, "4": 70.0}, "threshold": 90.0}',
  '{"schemaVersion": 1, "event": "switch", "ts": "2026-09-23T14:00:05Z", "trigger": "proactive", "from": {"number": 1, "email": "one@example.com"}, "to": {"number": 4, "email": "four@example.com"}, "warnings": [], "dryRun": false}',
  '{"schemaVersion": 1, "event": "no-switch", "ts": "2026-09-23T14:05:00Z", "reason": "cooldown", "detail": ""}',
  '{"schemaVersion": 1, "event": "switch", "ts": "2026-09-23T15:00:00Z", "trigger": "proactive", "from": {"number": 4, "email": "four@example.com"}, "to": {"number": 2, "email": "two@example.com"}, "warnings": [], "dryRun": true}',
  '{"schemaVersion": 1, "event": "switch", "ts": "2026-09-23T16:30:00Z", "trigger": "failover", "from": null, "to": {"number": 3, "email": "three@example.com"}, "warnings": [], "dryRun": false}',
  '{"schemaVersion": 1, "switched": true, "from": {"number": 1, "email": "one@example.com"}, "to": {"number": 4, "email": "four@example.com"}, "strategy": "rotation", "reason": "switched", "message": "Switched to Account-4 (four@example.com)", "warnings": []}',
  "Traceback (most recent call last): usage fetch for one@example.com timed out",
];
/** The switcher's log line for a switch at this UTC instant, in the machine-local time the log is written in. */
const logLine = (utc: string, from: number, to: number) => {
  const d = new Date(utc), p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())},412 - INFO - Switched from account ${from} to ${to}`;
};

test("cswap auto --json: switch events give UTC times and slot numbers; dry runs, other kinds, manual results and noise are ignored", () => {
  const sw = extractSwitches(CSWAP_AUTO_JSON.join("\n"));
  assert.deepEqual(sw, [
    { at: "2026-09-23T14:00:05.000Z", from: 1, to: 4, source: "cswap-event" },
    { at: "2026-09-23T16:30:00.000Z", from: null, to: 3, source: "cswap-event" },
  ]);
  assert.ok(!JSON.stringify(sw).includes("@"), "account references are reduced to slot numbers");
  assert.equal(accountAt(sw, Date.parse("2026-09-23T15:00:00Z")), 4);
  assert.equal(accountAt(sw, Date.parse("2026-09-23T13:00:00Z")), 1);
});

test("events and the switcher log together: an auto switch in both is kept once (the UTC event); a manual switch is only in the log", () => {
  const log = [logLine("2026-09-23T14:00:06Z", 1, 4), logLine("2026-09-23T15:10:00Z", 4, 2)].join("\n");
  const sw = extractSwitches(CSWAP_AUTO_JSON.join("\n") + "\n" + log);
  assert.deepEqual(sw.map((s) => [s.at, s.from, s.to, s.source]), [
    ["2026-09-23T14:00:05.000Z", 1, 4, "cswap-event"],
    ["2026-09-23T15:10:00.000Z", 4, 2, "log"],
    ["2026-09-23T16:30:00.000Z", null, 3, "cswap-event"],
  ]);
  assert.deepEqual(extractSwitches(log, "2026-09-23T15:00:00Z").map((s) => s.to), [2], "--since applies to both sources");
});

test("a switch event from an unknown schema version stops the extract instead of being misread", () => {
  assert.throws(() => extractSwitches('{"schemaVersion": 2, "event": "switch", "ts": "2026-09-23T14:00:05Z", "to": {"number": 4}}'), /schemaVersion 2/);
});

test("--since applies to events; after a switch from no active account the target is active; lines that are not events are skipped", () => {
  const sw = extractSwitches(CSWAP_AUTO_JSON.join("\n"), "2026-09-23T15:00:00Z");
  assert.deepEqual(sw.map((s) => [s.from, s.to]), [[null, 3]]);
  assert.equal(accountAt(sw, Date.parse("2026-09-23T17:00:00Z")), 3);
  assert.deepEqual(extractSwitches('{"not": "an event"}\n{ truncated json\n'), []);
});
