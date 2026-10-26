/**
 * A run's shape is read from its room logs: how it was launched (one flat room, groups under a leads room, or planner
 * sub-rooms) and every break-out opened later, with when and by whom (chair, worker, verifier, recruit). No record
 * carried it: comparing flat and grouped runs (owner ask 3, swarm-005940-77tu evidence/room-shape) meant inferring the
 * shape from room names and result.json run by run, and who opens break-outs (owner ask 1) meant a hand census.
 * src/metrics/run-shape.ts reads it; runs-table --by-run prints it and puts it in --json.
 * Run: npx tsx --test scripts/run-shape-regression.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import test from "node:test";
import { groupRuns, renderRunShapes, runShape, shapeText } from "../src/metrics/run-shape.js";
import { runOf } from "../src/run-timeline.js";

const at = (s: number) => new Date(Date.parse("2026-10-25T16:42:00Z") + s * 1000).toISOString();
const roomEv = (room: string, s: number, opts: Record<string, unknown> = {}) => ({ type: "room", room, opts: { topic: room, ...opts }, createdAt: at(s) });
const join = (room: string, name: string, s: number, role?: string) => ({ type: "join", room, p: { name, joinedAt: at(s), ...(role ? { role } : {}) } });
const sys = (room: string, content: string, s: number) => ({ type: "message", msg: { room, kind: "system", from: { id: "system", name: "system" }, content, ts: at(s) } });

const flatRun = () => {
  const main = [roomEv("swarm-164210-9f66-room", 0),
    join("swarm-164210-9f66-room", "chair-claude", 5, "chair"), join("swarm-164210-9f66-room", "claude-opus-5-5-5", 6),
    join("swarm-164210-9f66-room", "verifier", 7, "verifier"),
    // request_agent(new_room): the recruiting line names the room without the run prefix
    sys("swarm-164210-9f66-room", "chair-claude recruited claude-recruit-1, claude-recruit-2 (claude/claude-opus-5-5, into bk1-time-to-beat, area time-to-beat): You are one of 3 seats", 11_700),
    // join_room(parent=): the hub's own line
    sys("swarm-164210-9f66-room", "claude-opus-5-5-5 opened breakout room swarm-164210-9f66-scout: code sweep. Work there with join_room(room=\"swarm-164210-9f66-scout\")", 1_380),
  ];
  const bk1 = [roomEv("swarm-164210-9f66-bk1-time-to-beat", 11_700, { parent: "swarm-164210-9f66-room" }), join("swarm-164210-9f66-bk1-time-to-beat", "claude-recruit-1", 11_760, "recruit")];
  const scout = [roomEv("swarm-164210-9f66-scout", 1_380, { parent: "swarm-164210-9f66-room" }), join("swarm-164210-9f66-scout", "claude-opus-5-5-5", 1_381)];
  return [main, bk1, scout];
};

test("a flat run with break-outs: launch shape, and each break-out's minute and opener role", () => {
  const s = runShape(flatRun(), "swarm-164210-9f66");
  assert.deepEqual(s, {
    launch: "flat", launchRooms: 1,
    breakouts: [
      { room: "swarm-164210-9f66-scout", minute: 23, by: "claude-opus-5-5-5", role: "worker" },
      { room: "swarm-164210-9f66-bk1-time-to-beat", minute: 195, by: "chair-claude", role: "chair" },
    ],
  });
  assert.equal(shapeText(s), "flat + 2 break-outs (chair 1, worker 1)");
  assert.match(renderRunShapes([{ run: "swarm-164210-9f66", shape: s }]), /\| swarm-164210-9f66 \| flat \+ 2 break-outs \(chair 1, worker 1\) \| 23: claude-opus-5-5-5 \(worker\), 195: chair-claude \(chair\) \|/);
});

test("a grouped run: groups under the leads room at launch are not break-outs", () => {
  const leads = [roomEv("swarm-130459-mrw4-leads", 0), join("swarm-130459-mrw4-leads", "chair-claude", 5, "chair"), join("swarm-130459-mrw4-leads", "digest-1", 1_800)];
  const crypto = [roomEv("swarm-130459-mrw4-crypto", 1, { parent: "swarm-130459-mrw4-leads" })];
  const tennis = [roomEv("swarm-130459-mrw4-tennis", 2, { parent: "swarm-130459-mrw4-leads" })];
  const s = runShape([leads, crypto, tennis], "swarm-130459-mrw4");
  assert.deepEqual(s, { launch: "grouped", launchRooms: 3, breakouts: [] });
  assert.equal(shapeText(s), "grouped (3 rooms)");
});

test("older grouped runs had no parent link: a consolidator seat in the leads room still marks them grouped", () => {
  const leads = [roomEv("swarm-123021-1nwp-leads", 0), join("swarm-123021-1nwp-leads", "digest-2", 2_000)];
  const audit = [roomEv("swarm-123021-1nwp-audit", 1)];
  assert.equal(runShape([leads, audit], "swarm-123021-1nwp")?.launch, "grouped");
});

test("a planner's sub-rooms with no digest seat are planned; a lone room not named -room is single", () => {
  const leads = [roomEv("swarm-102607-irkd-leads", 0)];
  const a = [roomEv("swarm-102607-irkd-tool-surface", 20)];
  const b = [roomEv("swarm-102607-irkd-context-waste", 21)];
  assert.deepEqual(runShape([leads, a, b], "swarm-102607-irkd"), { launch: "planned", launchRooms: 3, breakouts: [] });
  assert.equal(runShape([[roomEv("probe-x", 0)]], "probe-x")?.launch, "single");
  assert.equal(runShape([[]], "nothing"), undefined);
  assert.equal(shapeText(undefined), "-");
});

test("a break-out whose opener line is missing is still a break-out, opener unknown", () => {
  const main = [roomEv("swarm-003601-tky5-room", 0)];
  const bk = [roomEv("swarm-003601-tky5-overflow", 600, { parent: "swarm-003601-tky5-room" })];
  const s = runShape([main, bk], "swarm-003601-tky5");
  assert.deepEqual(s?.breakouts, [{ room: "swarm-003601-tky5-overflow", minute: 10 }]);
  assert.equal(shapeText(s), "flat + 1 break-out (unknown 1)");
});

test("an opener with no join line in the room it opened from has no role, not \"worker\" (review/8b73d0ed nit 2)", () => {
  const main = [roomEv("swarm-003601-tky5-room", 0), sys("swarm-003601-tky5-room", "ghost-seat opened breakout room swarm-003601-tky5-side: x", 600)];
  const side = [roomEv("swarm-003601-tky5-side", 600, { parent: "swarm-003601-tky5-room" })];
  const s = runShape([main, side], "swarm-003601-tky5");
  assert.deepEqual(s?.breakouts, [{ room: "swarm-003601-tky5-side", minute: 10, by: "ghost-seat" }]);
  assert.equal(shapeText(s), "flat + 1 break-out (unknown 1)");
});

// kcj5: 6-1-sol-6 opened swarm-005617-verdict-telemetry from swarm-005617-kcj5-room; the name has no run tag
const untaggedRun = () => [
  [roomEv("swarm-005617-kcj5-room", 0), join("swarm-005617-kcj5-room", "6-1-sol-6", 5),
    sys("swarm-005617-kcj5-room", "6-1-sol-6 opened breakout room swarm-005617-verdict-telemetry: Prototype the verdict", 1_200)],
  [roomEv("swarm-005617-verdict-telemetry", 1_200, { parent: "swarm-005617-kcj5-room" }), join("swarm-005617-verdict-telemetry", "6-1-sol-6", 1_201)],
];

test("a break-out named without its run tag goes with the room it was opened from (review/8b73d0ed nit 1)", () => {
  const byRun = groupRuns(untaggedRun(), runOf);
  assert.deepEqual([...byRun.keys()], ["swarm-005617-kcj5"]);
  assert.equal(shapeText(runShape(byRun.get("swarm-005617-kcj5")!, "swarm-005617-kcj5")), "flat + 1 break-out (worker 1)");
  // a parent's parent: the chain is followed to the room the run was launched in
  const nested = [...untaggedRun(), [roomEv("swarm-005617-deeper", 1_500, { parent: "swarm-005617-verdict-telemetry" })]];
  assert.deepEqual([...groupRuns(nested, runOf).keys()], ["swarm-005617-kcj5"]);
  // groups linked to their leads room stay in the run they were already in
  assert.deepEqual([...groupRuns([[roomEv("swarm-130459-mrw4-leads", 0)], [roomEv("swarm-130459-mrw4-crypto", 1, { parent: "swarm-130459-mrw4-leads" })]], runOf)].map(([k, v]) => [k, v.length]), [["swarm-130459-mrw4", 2]]);
});

test("the command: runs-table --by-run puts an untagged break-out under its parent's run", () => {
  const dir = mkdtempSync(pathJoin(tmpdir(), "run-shape-"));
  try {
    const files = untaggedRun().map((events) => {
      const f = pathJoin(dir, `${(events[0] as { room: string }).room}.jsonl`);
      writeFileSync(f, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
      return f;
    });
    const out = spawnSync(process.execPath, ["--import", "tsx", "scripts/runs-table.ts", "--by-run", ...files], { encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /\| swarm-005617-kcj5 \| flat \+ 1 break-out \(worker 1\) \| 20: 6-1-sol-6 \(worker\) \|/, out.stdout);
    assert.doesNotMatch(out.stdout, /\| swarm-005617-verd \|/, out.stdout); // runOf of the untagged name, as a run of its own
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the command: runs-table --by-run prints the shape per run and puts it in --json", () => {
  const dir = mkdtempSync(pathJoin(tmpdir(), "run-shape-"));
  try {
    const files = flatRun().map((events) => {
      const f = pathJoin(dir, `${(events[0] as { room: string }).room}.jsonl`);
      writeFileSync(f, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
      return f;
    });
    const text = spawnSync(process.execPath, ["--import", "tsx", "scripts/runs-table.ts", "--by-run", ...files], { encoding: "utf8" });
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /\| swarm-164210-9f66 \| flat \+ 2 break-outs \(chair 1, worker 1\) \|/, text.stdout);
    const json = spawnSync(process.execPath, ["--import", "tsx", "scripts/runs-table.ts", "--by-run", "--json", ...files], { encoding: "utf8" });
    assert.equal(json.status, 0, json.stderr);
    const runs = JSON.parse(json.stdout).runs as { run: string; shape?: { launch: string; breakouts: unknown[] } }[];
    assert.equal(runs.length, 1);
    assert.equal(runs[0].shape?.launch, "flat");
    assert.equal(runs[0].shape?.breakouts.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
