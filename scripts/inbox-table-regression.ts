/**
 * inbox-table reads a room log written by a real hub and reports notes, acknowledgements, cap refusals and how long
 * the inbox was full under each rule (claim/inbox-table; telemetry for evidence-pack item 2).
 * Run: npx tsx scripts/inbox-table-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";
import { parseRoomLog } from "../src/run-metrics.js";
import { inboxRow, renderInboxTable } from "../src/inbox-table.js";

const dataDir = mkdtempSync(join(tmpdir(), "inbox-table-"));
let failed = 0;
try {
  const hub = new Hub({ dataDir });
  const s = hub.join("leads", "referee", "test", {}, undefined, "s-leads").participant;
  const b = hub.join("group", "builder", "test", {}, undefined, "s-b").participant;
  const c = hub.join("group", "peer", "test", {}, undefined, "s-c").participant;
  const post = (key: string, text: string, required: boolean) => hub.postToRoom("leads", s.id, "group", key, text, required).key;
  // ten rulings nobody is asked to acknowledge: the traffic that filled 0btz-build's inbox
  for (let i = 0; i < 10; i++) post(`ruling${i}`, `ruling ${i}`, false);
  // a digest, acknowledged by two seats: a bare ack, then a reply
  const digest = post("digest", "pass 1", true);
  hub.setBoard("group", b.id, `${digest}.ack`, "ack");
  hub.setBoard("group", c.id, `${digest}.ack`, "peer reruns T-B3-4 against this digest");
  // replaced by pass 2 and left unacknowledged, then ten more required notes fill the cap and one is refused
  post("digest", "pass 2", true);
  for (let i = 0; i < 9; i++) post(`req${i}`, `required ${i}`, true);
  assert.throws(() => post("req9", "one too many", true));
  hub.setBoard("group", b.id, "inbox/leads/ruling0.ack", "will hold the wide book until R12 is ruled");

  const row = inboxRow(parseRoomLog(readFileSync(join(dataDir, "group.jsonl"), "utf8")));
  assert.equal(row.room, "group");
  assert.equal(row.notes, 21, "10 rulings + digest twice + 9 required");
  assert.equal(row.required, 11);
  assert.equal(row.optional, 10);
  assert.equal(row.acked, 2, "digest pass 1 and ruling0 (the second seat's reply joins the first ack, it is not a second ack)");
  assert.equal(row.bareAcks, 1);
  assert.equal(row.replyAcks, 1);
  assert.equal(row.requiredUnacked, 10, "digest pass 2 and the 9 required notes are still open");
  assert.equal(row.refused, 1, "the note the cap refused is in the target room's log");
  assert.equal(typeof row.ackMedianMin, "number");
  assert.match(renderInboxTable([row]), /\| group \| 21 \(11 \/ 10\) \| 2 \| 10 \|/);
  console.log("PASS a hub-written log reads back as notes, acks, replies and a cap refusal");

  // the two cap rules on one stream of events: every note counted fills the inbox when the tenth ruling lands; ack-required only never does
  const at = (min: number) => new Date(Date.UTC(2026, 9, 11, 11, min)).toISOString();
  const events: Record<string, unknown>[] = [{ type: "room", room: "replay", createdAt: at(0) }];
  for (let i = 0; i < 10; i++) events.push({ type: "board", room: "replay", key: `inbox/leads/ruling${i}`, entry: { text: `r${i}`, by: "referee", updatedAt: at(i) } });
  events.push({ type: "board", room: "replay", key: "inbox/leads/digest", entry: { text: "d", by: "digest-1", updatedAt: at(12), ackRequired: true } });
  for (let i = 0; i < 10; i++) events.push({ type: "board", room: "replay", key: `inbox/leads/ruling${i}.ack`, entry: { text: "ack", by: "builder", updatedAt: at(58) } });
  events.push({ type: "state", room: "replay", state: "concluded", ts: at(90) });
  const replay = inboxRow(events);
  assert.equal(replay.fullMinAllNotes, 49, "full from the tenth ruling (11:09) until the first ack (11:58)");
  assert.equal(replay.fullMinRequiredOnly, 0);
  assert.equal(replay.requiredUnacked, 1);
  console.log("PASS the same events give 49 minutes full under the old rule and none under the current one");
} catch (e) {
  failed++;
  console.error(`FAIL ${e instanceof Error ? e.message.split("\n")[0] : e}`);
} finally { rmSync(dataDir, { recursive: true, force: true }); }
if (failed) { console.error("INBOX TABLE: failed"); process.exitCode = 1; } else console.log("INBOX TABLE OK (2 cases)");
