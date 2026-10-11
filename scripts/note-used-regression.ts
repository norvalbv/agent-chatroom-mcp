/**
 * Whether a cross-room note was used, not only received (telemetry gap G7; evidence-pack item 7 "an acknowledgement
 * shows receipt, not use. Nothing records whether a digest changed what a group did"). The hub now logs note_used
 * {note, by, via, after_s} the first time a seat of the receiving room names a note it was sent (inbox/<room>/<key>)
 * in a board entry, a chat message, a proposal, an amend or a challenge, or acknowledges it with a reply rather than a
 * bare "ack"; and the inbox table counts the notes used. Red on main: no note_used event, no "used" column.
 * Run: npx tsx scripts/note-used-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub } from "../src/hub.js";
import { inboxRow } from "../src/inbox-table.js";

test("citing a note, or acking it with a reply, is logged once per seat and note; a bare ack is not use", () => {
  Hub.LAST_CALL_MS = 0;
  const dir = mkdtempSync(join(tmpdir(), "note-used-"));
  const hub = new Hub({ dataDir: dir });
  const s = hub.join("nu-src", "S", "test", { nudgeAfterMs: 0 }, undefined, "s1").participant;
  hub.join("nu-src", "S2", "test", {}, undefined, "s2");
  const t = hub.join("nu-dst", "T", "test", { nudgeAfterMs: 0 }, undefined, "s3").participant;
  const u = hub.join("nu-dst", "U", "test", {}, undefined, "s4").participant;
  hub.postToRoom("nu-src", s.id, "nu-dst", "ruling-1", "Referee ruling: the 45-day window is the one to use.", true);
  hub.postToRoom("nu-src", s.id, "nu-dst", "digest", "Digest: build found fill factor 0.62.", false);
  hub.postToRoom("nu-src", s.id, "nu-dst", "fyi", "FYI only.", false);
  // T cites the ruling in a result entry and again in chat: one event
  hub.setBoard("nu-dst", t.id, "result/fill", "fill factor 0.58 on the 45-day window, per inbox/nu-src/ruling-1");
  hub.send("nu-dst", t.id, "Following inbox/nu-src/ruling-1 I reran it.", undefined, true);
  // U acks the digest with a reply (use), T acks the ruling bare (receipt only), nobody touches fyi
  hub.setBoard("nu-dst", u.id, "inbox/nu-src/digest.ack", "Used it: our rerun disagrees, 0.58 not 0.62, see result/fill.");
  hub.setBoard("nu-dst", t.id, "inbox/nu-src/ruling-1.ack", "ack");
  const evs = readFileSync(join(dir, "nu-dst.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const used = evs.filter((e) => e.type === "note_used");
  assert.deepEqual(used.map((e) => [e.note, e.by, e.via]).sort(), [["inbox/nu-src/digest", "U", "ack-reply"], ["inbox/nu-src/ruling-1", "T", "board"]]);
  assert.ok(used.every((e) => typeof e.after_s === "number" && e.after_s >= 0), "with seconds from the note landing");
  const row = inboxRow(evs);
  assert.equal(row.notes, 3);
  assert.equal(row.used, 2, "the inbox table counts the notes used: 2 of 3 (fyi never was)");
});
