/** Inbox acknowledgement regressions. Run: npx tsx scripts/test-inbox-handover.ts */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";

function setup(dataDir?: string) {
  const hub = new Hub({ dataDir });
  const a = hub.join("source", "sender", "test", {}, undefined, "source-session").participant;
  const b = hub.join("target", "reader", "test", {}, undefined, "target-session").participant;
  hub.join("target", "peer", "test", {}, undefined, "peer-session");
  const room = hub.getRoom("target");
  const post = (key: string, text = key, required = true) => hub.postToRoom("source", a.id, "target", key, text, required).key;
  const ack = (key: string) => hub.setBoard("target", b.id, `${key}.ack`, "ack");
  return { hub, a, b, room, post, ack };
}
const cases: [string, () => void][] = [
  ["cap releases after acknowledgement", () => {
    const { hub, room, post, ack } = setup();
    for (let i = 0; i < 10; i++) ack(post(`n${i}`));
    assert.deepEqual(hub.unacknowledged(room), []);
    assert.doesNotThrow(() => post("eleventh"));
    assert.equal(hub.unacknowledged(room).length, 1);
  }],
  ["cap holds at ten open notes and permits in-place replacement", () => {
    const { hub, room, post, ack } = setup();
    for (let i = 0; i < 10; i++) post(`n${i}`);
    assert.throws(() => post("eleventh"), /10 inbox/);
    assert.doesNotThrow(() => post("n0", "revised"));
    assert.equal(hub.unacknowledged(room).length, 10);
    ack("inbox/source/n0");
    assert.doesNotThrow(() => post("eleventh"));
    assert.equal(hub.unacknowledged(room).length, 10);
  }],
  ["replacement reopens and blocks proposal", () => {
    const { hub, b, room, post, ack } = setup();
    const key = post("result", "old revision");
    ack(key);
    post("result", "new revision");
    assert.deepEqual(hub.unacknowledged(room), [key]);
    assert.throws(() => hub.propose("target", b.id, "Adopt the reviewed result."), /Acknowledge the notes/);
    ack(key);
    assert.deepEqual(hub.unacknowledged(room), []);
    assert.doesNotThrow(() => hub.propose("target", b.id, "Adopt the reviewed result."));
  }],
  ["an old acknowledgement never covers new text, even with equal timestamps", () => {
    const { hub, room, post, ack } = setup();
    const key = post("result", "old revision");
    const oldAck = ack(key)!;
    const oldTime = room.board.get(key)!.updatedAt;
    post("result", "new revision");
    // Deliberately restore the old event to exercise coverage, not just deletion.
    room.board.set(`${key}.ack`, oldAck);
    room.board.get(key)!.updatedAt = oldTime;
    assert.deepEqual(hub.unacknowledged(room), [key]);
  }],
  ["optional notes share cap but only required notes block proposals", () => {
    const { hub, b, room, post, ack } = setup();
    for (let i = 0; i < 10; i++) post(`info${i}`, "FYI", false);
    assert.deepEqual(hub.unacknowledged(room), []);
    assert.throws(() => post("action"), /10 inbox/);
    assert.throws(() => post("eleventh-info", "FYI", false), /10 inbox/);
    assert.doesNotThrow(() => post("info0", "updated FYI", false));
    ack("inbox/source/info0");
    assert.doesNotThrow(() => post("action"));
    assert.equal(hub.unacknowledged(room).length, 1);
    assert.throws(() => hub.propose("target", b.id, "Adopt the reviewed result."), /Acknowledge the notes/);
  }],
  ["legacy acknowledgements without coverage are conservative", () => {
    const { hub, room, post, ack } = setup();
    const key = post("result");
    ack(key);
    room.board.set(`${key}.ack`, { text: "ack", by: "reader", updatedAt: room.board.get(key)!.updatedAt });
    assert.deepEqual(hub.unacknowledged(room), [key]);
    ack(key);
    assert.deepEqual(hub.unacknowledged(room), []);
  }],
  ["reopening an acknowledged note cannot exceed the cap", () => {
    const { post, ack, hub, room } = setup();
    ack(post("done"));
    for (let i = 0; i < 10; i++) post(`open${i}`);
    assert.throws(() => post("done", "new revision"), /10 inbox/);
    assert.equal(hub.unacknowledged(room).length, 10);
  }],
  ["reserved prefixes and target-room membership remain enforced", () => {
    const { hub, a, b, post } = setup();
    const key = post("result");
    assert.throws(() => hub.setBoard("target", a.id, `${key}.ack`, "ack"));
    assert.throws(() => hub.setBoard("target", b.id, key, "overwrite"), /written by post_to_room/);
    assert.throws(() => hub.setBoard("target", b.id, "hold/other", "hold"), /hold for this room/);
  }],
  ["acknowledgement coverage and replacement replay identically", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "inbox-handover-"));
    try {
      const { hub, room, post, ack } = setup(dataDir);
      const key = post("result", "old revision");
      ack(key);
      const restart = () => {
        const replay = new Hub({ dataDir });
        assert.deepEqual([...replay.getRoom("target").board], [...room.board]);
        assert.deepEqual(replay.unacknowledged(replay.getRoom("target")), hub.unacknowledged(room));
        return replay;
      };
      assert.deepEqual(restart().unacknowledged(restart().getRoom("target")), []);
      post("result", "new revision");
      assert.deepEqual(hub.unacknowledged(room), [key]);
      restart();
      ack(key);
      restart();
      assert.deepEqual(hub.unacknowledged(room), []);
    } finally { rmSync(dataDir, { recursive: true, force: true }); }
  }],
];
let failed = 0;
for (const [name, test] of cases) {
  try { test(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : error}`); }
}
if (failed) { console.error(`INBOX HANDOVER: ${failed}/${cases.length} failed`); process.exitCode = 1; }
else console.log(`INBOX HANDOVER OK (${cases.length} cases)`);
