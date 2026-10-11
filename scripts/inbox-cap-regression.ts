/**
 * Inbox cap and acknowledgement races (evidence-pack item 2; claim/inbox-cap). Run: npx tsx scripts/inbox-cap-regression.ts
 *
 * 0btz-build (7750, 11:28 UTC) and 1nwp-external (7717, 12:51 UTC) were each cut off from every post_to_room for
 * 49 and 28.5 minutes by ten open notes that were all ack_required=false: nothing asked anyone to acknowledge them,
 * and only the sender heard about the refusal. 21 of 44 ownership refusals since take/ shipped were two seats
 * acknowledging the same note (evidence/item5-who-took-what).
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";
import { HubError } from "../src/hub/types.js";

function setup(dataDir?: string) {
  const hub = new Hub({ dataDir });
  const a = hub.join("source", "sender", "test", {}, undefined, "source-session").participant;
  const b = hub.join("target", "reader", "test", {}, undefined, "target-session").participant;
  const c = hub.join("target", "peer", "test", {}, undefined, "peer-session").participant;
  const room = hub.getRoom("target");
  const post = (key: string, text = key, required = true) => hub.postToRoom("source", a.id, "target", key, text, required).key;
  return { hub, a, b, c, room, post };
}
const systemLines = (hub: Hub) => hub.getRoom("target").messages.filter((m) => m.kind === "system").map((m) => m.content);

const cases: [string, () => void][] = [
  ["notes that need no acknowledgement never fill the cap", () => {
    const { hub, room, post } = setup();
    for (let i = 0; i < 12; i++) post(`ruling${i}`, "FYI", false);
    assert.doesNotThrow(() => post("digest"));
    assert.deepEqual(hub.unacknowledged(room), ["inbox/source/digest"]);
  }],
  ["the cap refusal is typed inbox-cap", () => {
    const { post } = setup();
    for (let i = 0; i < 10; i++) post(`n${i}`);
    assert.throws(() => post("eleventh"), (e: unknown) => e instanceof HubError && e.code === "inbox-cap" && /10 inbox/.test(e.message));
  }],
  ["the target room is told, once per note, who was refused and what to acknowledge", () => {
    const { hub, room, post } = setup();
    for (let i = 0; i < 10; i++) post(`n${i}`);
    const before = systemLines(hub).length;
    assert.throws(() => post("eleventh"));
    assert.throws(() => post("eleventh"));
    const told = systemLines(hub).slice(before);
    assert.equal(told.length, 1, `one notice for two refusals of the same note, got ${JSON.stringify(told)}`);
    assert.match(told[0], /sender in source/);
    assert.match(told[0], /inbox\/source\/eleventh/);
    assert.match(told[0], /\.ack/);
    assert.equal(room.refusals?.["post_to_room: inbox-cap"], 2, "the refusal is counted in the room it was meant for");
  }],
  ["a second seat's acknowledgement of an acknowledged note is not refused", () => {
    const { hub, b, c, room, post } = setup();
    const key = post("digest");
    hub.setBoard("target", b.id, `${key}.ack`, "ack");
    assert.doesNotThrow(() => hub.setBoard("target", c.id, `${key}.ack`, "ack"));
    assert.equal(room.board.get(`${key}.ack`)!.by, "reader", "a bare repeat ack is a no-op that keeps the first acker");
    assert.doesNotThrow(() => hub.setBoard("target", c.id, `${key}.ack`, "peer will rerun T-B3-4 against the new digest"));
    const merged = room.board.get(`${key}.ack`)!;
    assert.match(merged.text, /^ack/);
    assert.match(merged.text, /peer: peer will rerun T-B3-4/);
    assert.deepEqual(hub.unacknowledged(room), []);
  }],
  ["a stale acknowledgement is replaced by any seat without overwrite", () => {
    const { hub, b, c, room, post } = setup();
    const key = post("digest", "pass 1");
    hub.setBoard("target", b.id, `${key}.ack`, "ack pass 1");
    post("digest", "pass 2");
    assert.deepEqual(hub.unacknowledged(room), [key]);
    assert.doesNotThrow(() => hub.setBoard("target", c.id, `${key}.ack`, "ack pass 2"));
    assert.equal(room.board.get(`${key}.ack`)!.text, "ack pass 2");
    assert.deepEqual(hub.unacknowledged(room), []);
  }],
  ["the refused-note record survives a restart", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "inbox-cap-"));
    try {
      const { post } = setup(dataDir);
      for (let i = 0; i < 10; i++) post(`n${i}`);
      assert.throws(() => post("eleventh"));
      const log = readFileSync(join(dataDir, "target.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const ev = log.find((e) => e.type === "inbox_refused");
      assert.ok(ev, "an inbox_refused event is persisted in the target room's log");
      assert.equal(ev.from_room, "source");
      assert.equal(ev.key, "inbox/source/eleventh");
      assert.equal(ev.open, 10);
      assert.equal(typeof ev.chars, "number");
      assert.equal(ev.text, undefined, "never the note's text");
    } finally { rmSync(dataDir, { recursive: true, force: true }); }
  }],
];
let failed = 0;
for (const [name, test] of cases) {
  try { test(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : error}`); }
}
if (failed) { console.error(`INBOX CAP: ${failed}/${cases.length} failed`); process.exitCode = 1; }
else console.log(`INBOX CAP OK (${cases.length} cases)`);
