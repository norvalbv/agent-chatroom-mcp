/** The runs table told three known untruths (evidence pack, "Three cautions before using any number"; telemetry gaps G1, G2):
 * hours ran to the owner archiving the room (gwhf: 36.08 h for 0.19 h of work), a seat in two rooms of a grouped run was
 * paid for twice (0btz $436.19 for $331.09), and the launcher's resource/* seeding counted as the room's findings (35 of
 * 214 in 0btz). Run: npx tsx scripts/runs-table-truth-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runRow, runTotals } from "../src/run-timeline.js";

const T0 = Date.parse("2026-10-11T10:00:00.000Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const join_ = (room: string, id: string, name: string, key: string) => ({ type: "join", room, p: { id, name, agent: "claude", joinedAt: at(0), seatKeyHash: key } });
// the hub writes a seat process's cumulative usage to every room that seat sits in (src/hub.ts usage)
const usage = (room: string, seat: string, min: number, cost: number) => ({ type: "usage", room, seat, ts: at(min), usage: { requests: min, output_tokens: min * 10, cost_usd: cost, at: at(min) } });
const board = (room: string, key: string, by: string, min: number) => ({ type: "board", room, key, entry: { text: "x", by, updatedAt: at(min) } });

// 1. hours stop at the last thing done in the room, not the owner's archive the next day
const solo = [
  { type: "room", room: "r", opts: { topic: "t" }, createdAt: at(0) },
  join_("r", "p_a", "a", "ka"),
  { type: "message", room: "r", msg: { seq: 1, kind: "chat", from: { id: "p_a", name: "a" }, content: "hi", ts: at(12) } },
  { type: "state", room: "r", conclusion: { text: "done", decidedAt: at(12) } },
  { type: "archive", room: "r", archived: true, by: "benji", ts: at(36 * 60) },
  // a later room's seat reading this log is not this room working (src/hub.ts recordOutsideRead)
  { type: "outside_read", room: "r", by: { room: "later", pid: "p_z" }, via: "file", tool: "Bash", ts: at(50 * 60) },
  // a seat still long-polling an hour after the conclusion is not the run going on
  { type: "call_completion", room: "r", tool: "wait_for_messages", outcome: "success", participant: "p_a", empty: true, ts: at(70) },
];
assert.equal(runRow(solo).hours, 0.2, "the owner archiving a room 36 h later is not run time");

// 2. launcher-seeded resource/* entries are what the room was given, not what it found
const seeded = [...solo.slice(0, 3), board("r", "resource/evidence-pack", "launcher", 0), board("r", "resource/mine", "a", 5), board("r", "evidence/x", "a", 6)];
assert.equal(runRow(seeded).findings, 2, "resource/mine and evidence/x; not the launcher's resource/evidence-pack");

// 3. a grouped run: the lead sits in leads and group, so its usage is in both logs; the run total counts it once
const leads = [
  { type: "room", room: "run-leads", opts: { topic: "lead it" }, createdAt: at(0) },
  join_("run-leads", "p_l", "lead", "kl"),
  usage("run-leads", "kl", 10, 5), usage("run-leads", "kl", 60, 20),
];
const group = [
  { type: "room", room: "run-g1", opts: { topic: "do it" }, createdAt: at(0) },
  join_("run-g1", "p_l2", "lead", "kl"), join_("run-g1", "p_w", "worker", "kw"),
  usage("run-g1", "kl", 10, 5), usage("run-g1", "kw", 30, 7), usage("run-g1", "kl", 60, 20), usage("run-g1", "kw", 90, 11),
];
assert.equal(runRow(leads).costUsd! + runRow(group).costUsd!, 51, "per room, the lead is in both: 20 + 31");
const total = runTotals([leads, group]);
assert.equal(total.costUsd, 31, "per run, each seat process once: lead 20 + worker 11");
assert.equal(total.seats, 2, "two seat processes, not three seats");
assert.deepEqual(total.rooms, ["run-g1", "run-leads"]);
assert.equal(total.hours, 1.5);

// the command: --by-run adds one row per run under the per-room rows
const dir = mkdtempSync(join(tmpdir(), "runs-truth-"));
try {
  writeFileSync(join(dir, "swarm-100000-abcd-leads.jsonl"), leads.map((e) => JSON.stringify({ ...e, room: "swarm-100000-abcd-leads" })).join("\n") + "\n");
  writeFileSync(join(dir, "swarm-100000-abcd-g1.jsonl"), group.map((e) => JSON.stringify({ ...e, room: "swarm-100000-abcd-g1" })).join("\n") + "\n");
  const out = spawnSync(process.execPath, ["--import", "tsx", "scripts/runs-table.ts", "--by-run", join(dir, "swarm-100000-abcd-leads.jsonl"), join(dir, "swarm-100000-abcd-g1.jsonl")], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /\| swarm-100000-abcd \| 2 \| 2 \| \$31 \| 1\.5 \|/, out.stdout);
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log("RUNS TABLE TRUTH OK");
