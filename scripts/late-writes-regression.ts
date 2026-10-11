/**
 * A result that lands after the room concluded is recorded, marked late, instead of lost (evidence-pack items 1 and 4;
 * chat-and-friction issues 3 and 10). Board writes were refused outright once a room concluded, and late results and
 * verifier verdicts were lost in 7 rooms: tky5 verifier-2's verify entries, 0btz-break's outside rerun (concluded 6 s
 * after "I'll amend that line when it lands"), 1nwp-internal's 17-diff capacity table, 00cp's three cited-but-refused
 * entries. For Hub.LATE_WRITE_MS after the conclusion, findings, results, verify/review and handoff entries are accepted,
 * marked late and logged; the conclusion never changes. Coordination keys (claim/, take/, hold/, draft/) stay refused,
 * as does every write to a closed room or after the window.
 * Run: npx tsx --test scripts/late-writes-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hub } from "../src/hub.js";

function concluded(t: { after: (fn: () => void) => void }, dataDir?: string) {
  const hub = new Hub(dataDir ? { dataDir } : {});
  const name = "late-writes";
  const a = hub.join(name, "Alice", "test", { requireChallenge: false, expectedParticipants: 2 }, undefined, "session-a").participant;
  const b = hub.join(name, "Bob", "test", {}, undefined, "session-b").participant;
  const room = hub.getRoom(name);
  t.after(() => { clearTimeout(room.nudgeTimer); clearTimeout(room.openingsTimer); });
  const pr = hub.propose(name, a.id, "Ship the metrics table as drafted.");
  hub.vote(name, b.id, pr.id, "agree", undefined, undefined, "Ship the metrics table");
  assert.equal(room.state, "concluded");
  return { hub, room, a, b, pr };
}

test("a result written after conclusion is kept, marked late, said in the notice and logged; the conclusion does not change", (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "late-writes-"));
  const { hub, room, b } = concluded(t, dataDir);
  const before = JSON.stringify(room.conclusion);
  for (const key of ["result/capacity-17diffs", "verify/final", "review/0b612061", "handoff/bob"]) {
    const e = hub.setBoard(room.name, b.id, key, `late text for ${key}`)!;
    assert.equal(e.late, true, `${key} is marked late`);
  }
  assert.equal(JSON.stringify(room.conclusion), before, "late entries never change the conclusion");
  assert.match(room.messages.filter((m) => m.kind === "board").at(-1)!.content, /late: written after the room concluded; recorded, the conclusion does not change/);
  assert.match(room.messages.find((m) => m.kind === "conclusion")!.content, /board stays open to late results/);
  const summary = hub.summary(room) as { board: Record<string, { late?: boolean }> };
  assert.equal(summary.board["result/capacity-17diffs"].late, true, "room_status marks late entries");
  const events = readFileSync(join(dataDir, `${room.name}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type === "late_write");
  assert.deepEqual(events.map((e) => [e.key, e.by, typeof e.after_s]), [
    ["result/capacity-17diffs", "Bob", "number"], ["verify/final", "Bob", "number"], ["review/0b612061", "Bob", "number"], ["handoff/bob", "Bob", "number"],
  ]);
});

test("coordination keys, closed rooms and writes after the window stay refused", (t) => {
  const { hub, room, b } = concluded(t);
  // attack/: its @-ask to the author would be an owed ask nobody can answer in a concluded room (review/6a584cdd finding 1)
  for (const key of ["claim/more", "take/rerun", `hold/${room.name}`, "draft/bob", "attack/result/x"]) {
    assert.throws(() => hub.setBoard(room.name, b.id, key, "{}"), /concluded/, `${key} is coordination, refused after conclusion`);
  }
  const saved = Hub.LATE_WRITE_MS;
  t.after(() => { Hub.LATE_WRITE_MS = saved; });
  Hub.LATE_WRITE_MS = 0;
  assert.throws(() => hub.setBoard(room.name, b.id, "result/too-late", "x"), /concluded/);
});

test("a late verdict that fails a commit the conclusion cites is said in the room and logged as contradicting it", (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "late-writes-"));
  const hub = new Hub({ dataDir });
  const name = "late-verdict";
  const a = hub.join(name, "Alice", "test", { requireChallenge: false, expectedParticipants: 2 }, undefined, "session-a").participant;
  const b = hub.join(name, "Bob", "test", {}, undefined, "session-b").participant;
  const room = hub.getRoom(name);
  t.after(() => { clearTimeout(room.nudgeTimer); clearTimeout(room.openingsTimer); });
  const pr = hub.propose(name, a.id, "Merged a1b2c3d4e5 and f6e5d4c3b2; both verified.");
  hub.vote(name, b.id, pr.id, "agree", undefined, undefined, "f6e5d4c3b2; both verified");
  assert.equal(room.state, "concluded");
  const head = (commit: string, exit: number) => JSON.stringify({ proposal: "pending", command: "npx tsx scripts/x.ts", cwd: "/w", base_commit: "0123abc", base_exit_code: 1, commit, exit_code: exit, output_tail: "x" });
  hub.setBoard(name, b.id, "verify/late-pass", head("a1b2c3d4e5", 0));
  hub.setBoard(name, b.id, "verify/late-fail", head("f6e5d4c3b2", 1));
  hub.setBoard(name, b.id, "review/0a0b0c0d0e", head("0a0b0c0d0e", 1)); // fails, but not a commit the conclusion cites
  const lines = room.messages.filter((m) => m.kind === "system" && /after the conclusion/.test(m.content)).map((m) => m.content);
  assert.equal(lines.length, 1, "one line, for the failing verdict on a cited commit only");
  assert.match(lines[0], /verify\/late-fail by Bob reports exit_code 1 on f6e5d4c3b2, which the conclusion cites: a verdict after the conclusion contradicts it/);
  const events = readFileSync(join(dataDir, `${name}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type === "late_write");
  assert.deepEqual(events.map((e) => [e.key, e.contradicts ?? null]), [["verify/late-pass", null], ["verify/late-fail", "f6e5d4c3b2"], ["review/0a0b0c0d0e", null]]);
});

test("an append to a shared log after conclusion is marked late and logged like any late write (verifier, #140)", (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "late-writes-"));
  const { hub, room, b } = concluded(t, dataDir);
  const e = hub.setBoard(room.name, b.id, "ledger", "T-9 | rerun finished after the vote", { append: true })!;
  assert.equal(e.late, true, "the appended entry is marked late");
  assert.match(room.messages.filter((m) => m.kind === "board").at(-1)!.content, /appended to "ledger".*late: written after the room concluded/);
  const events = readFileSync(join(dataDir, `${room.name}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((x) => x.type === "late_write");
  assert.deepEqual(events.map((x) => [x.key, x.by]), [["ledger", "Bob"]]);
  const saved = Hub.LATE_WRITE_MS;
  t.after(() => { Hub.LATE_WRITE_MS = saved; });
  Hub.LATE_WRITE_MS = 0;
  assert.throws(() => hub.setBoard(room.name, b.id, "ledger", "too late", { append: true }), /concluded/);
});

test("a breakout that concludes after its parent delivers its conclusion to the parent's board, marked late", (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "late-writes-"));
  const hub = new Hub({ dataDir });
  const opts = { requireChallenge: false, expectedParticipants: 2 };
  const a = hub.join("late-parent", "Alice", "test", opts, undefined, "session-a").participant;
  const b = hub.join("late-parent", "Bob", "test", {}, undefined, "session-b").participant;
  const ca = hub.join("late-child", "Alice", "test", { ...opts, parent: "late-parent" }, undefined, "session-a").participant;
  const cc = hub.join("late-child", "Carol", "test", {}, undefined, "session-c").participant;
  const parent = hub.getRoom("late-parent"), child = hub.getRoom("late-child");
  t.after(() => { for (const r of [parent, child]) { clearTimeout(r.nudgeTimer); clearTimeout(r.openingsTimer); } });
  const pr = hub.propose("late-parent", a.id, "The leads room adopts the table as it stands.");
  hub.vote("late-parent", b.id, pr.id, "agree", undefined, undefined, "adopts the table as it stands");
  assert.equal(parent.state, "concluded");
  const before = JSON.stringify(parent.conclusion);
  const cp = hub.propose("late-child", ca.id, "Capacity is 17 diffs per run, measured on the internal set.");
  hub.vote("late-child", cc.id, cp.id, "agree", undefined, undefined, "Capacity is 17 diffs per run");
  assert.equal(child.state, "concluded");
  const e = parent.board.get("inbox/late-child/conclusion");
  assert.ok(e, "the late group's answer reaches the parent's board (1nwp-internal's 17-diff table did not)");
  assert.equal(e!.late, true);
  assert.match(e!.text, /Capacity is 17 diffs per run/);
  assert.match(parent.messages.at(-1)!.content, /breakout late-child concluded after this room did; its conclusion is on this board as inbox\/late-child\/conclusion, marked late/);
  assert.equal(JSON.stringify(parent.conclusion), before);
  const events = readFileSync(join(dataDir, "late-parent.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((x) => x.type === "late_write");
  assert.deepEqual(events.map((x) => [x.key, x.by]), [["inbox/late-child/conclusion", "system"]]);
});
