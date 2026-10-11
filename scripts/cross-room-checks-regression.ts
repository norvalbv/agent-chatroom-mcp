/**
 * A check written in one room of a run, of a result in another room of the same run, is counted (evidence-pack item 4
 * and item 7; decision/check-links NOT DONE). Grouped runs put opposing groups in separate rooms: in swarm-100951-0btz
 * the break group reran the build group's results in its own room, and the pack counted "build 5 of 14 reviewed (2 by
 * break)" by hand because no tool joins the rooms. runTotals now resolves a check that names nothing in its own room
 * against the other rooms of the run, with the same resolver the hub uses (src/hub/checks.ts), and reports, per room,
 * how many of its results were checked from another room.
 * Run: npx tsx --test scripts/cross-room-checks-regression.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { renderRunTotals, runTotals } from "../src/run-timeline.js";

const at = (s: number) => new Date(Date.parse("2026-10-11T12:00:00Z") + s * 1000).toISOString();
const board = (room: string, key: string, by: string, s: number, text = "x".repeat(60)) => ({ type: "board", room, key, entry: { text, by, updatedAt: at(s) } });
const roomEv = (room: string) => ({ type: "room", room, opts: { topic: room }, createdAt: at(0) });

test("a break group's rerun of a build group's result is counted for the build room, once", () => {
  const build = [roomEv("run-build"),
    board("run-build", "result/lone-quote-real-fills", "build-1", 100),
    board("run-build", "result/shared-fill-factor", "build-2", 110),
    board("run-build", "result/never-rerun", "build-1", 120),
    board("run-build", "rerun/shared-fill-factor-by-build-1", "build-1", 300), // an in-room check: not cross-room
  ];
  const brk = [roomEv("run-break"),
    board("run-break", "result/T-B1-1-fills-eat-rewards", "break-1", 105),
    board("run-break", "rerun/T-B1-1-by-break-2", "break-2", 200), // in-room: resolves to break's own result
    board("run-break", "rerun/lone-quote-real-fills-by-break-3", "break-3", 400), // names a build result
    board("run-break", "attack/build-shared-fill-factor", "break-1", 410, "the fill factor in result/shared-fill-factor double counts the maker side"),
    board("run-break", "audit/unrelated", "break-2", 420, "nothing here names anything"),
    board("run-break", "result/T-B3-5-lone-pay-bound", "break-3", 430, "attack on build's result/never-rerun: the bound is loose"), // named, not a check
  ];
  const t = runTotals([build, brk], "run");
  assert.deepEqual(t.crossChecked, { "run-build": { results: 3, checkedFromOtherRooms: 2, namedFromOtherRooms: 2 }, "run-break": { results: 2, checkedFromOtherRooms: 0, namedFromOtherRooms: 0 } });
  assert.match(renderRunTotals([t]), /run-build 2 of 3 \(named 2\), run-break 0 of 2 \(named 0\)/);
});

test("a check made before the result existed, or of your own result from another room, does not count", () => {
  const build = [roomEv("r-build"), board("r-build", "result/late", "lead", 500)];
  const leads = [roomEv("r-leads"),
    board("r-leads", "rerun/late", "break-1", 100), // written before result/late existed
    board("r-leads", "rerun/late-again", "lead", 600, "rechecked result/late"), // the result's own author, in another room
  ];
  assert.deepEqual(runTotals([build, leads], "r").crossChecked, { "r-build": { results: 1, checkedFromOtherRooms: 0, namedFromOtherRooms: 0 } });
});

test("a note another room sent under a checking name is that room's check; a digest naming a result is not", () => {
  const build = [roomEv("g-build"), board("g-build", "result/lone-pay-factor", "build-3", 100), board("g-build", "result/escrow-bound", "build-1", 110)];
  const leads = [roomEv("g-leads"),
    board("g-leads", "inbox/g-break/attack-lone-pay-factor", "break-3", 300, "I reran owned_full.py and the output is byte-identical"),
    board("g-leads", "inbox/g-leads/digest", "digest-2", 310, "Pass 2: result/escrow-bound and result/lone-pay-factor"),
  ];
  assert.deepEqual(runTotals([build, leads], "g").crossChecked, { "g-build": { results: 2, checkedFromOtherRooms: 1, namedFromOtherRooms: 0 } });
});
