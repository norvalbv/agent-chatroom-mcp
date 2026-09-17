/** Archiving hides a room from listings, keeps it on disk, closes an empty open room first, refuses a live one,
 * survives replay, and the dead sweep skips rooms younger than ten minutes. npx tsx scripts/archive-regression.ts */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";

const dir = mkdtempSync(join(tmpdir(), "archive-"));

let hub = new Hub({ dataDir: dir });
hub.createRoom("empty-open", { topic: "t" });
const { room: live } = hub.join("live", "A", "test");
hub.join("live", "B", "test");
const { room: old } = hub.join("finished", "C", "test");
hub.leave("finished", [...old.participants.values()][0].id);
// Fresh rooms are not dead yet: a launcher pre-creates rooms before seats join.
assert.deepEqual(hub.archiveDead("benji"), []);
old.createdAt = new Date(Date.now() - 11 * 60_000).toISOString();
hub.getRoom("empty-open").createdAt = old.createdAt;
live.createdAt = old.createdAt;
const swept = hub.archiveDead("benji").sort();
assert.deepEqual(swept, ["empty-open", "finished"], "dead = nobody in it and older than ten minutes");
assert.equal(hub.getRoom("empty-open").state, "closed", "an empty open room is closed before archiving");
assert.equal(hub.getRoom("empty-open").archived, true);
assert.throws(() => hub.archiveRoom("live", "benji"), /still has participants/);
assert.deepEqual(hub.listRooms().map((r) => r.name), ["live"], "archived rooms leave the default listing");
assert.equal(hub.listRooms(false, true).length, 3, "…but stay listable");
assert.equal(hub.summary(hub.getRoom("finished")).archived, true);
hub.archiveRoom("finished", "benji", false);
assert.equal(hub.getRoom("finished").archived, false, "unarchive");
// Replay: the archive flag is an event, so a restarted hub agrees.
hub = new Hub({ dataDir: dir });
assert.equal(hub.getRoom("empty-open").archived, true, "archived survives replay");
assert.equal(hub.getRoom("finished").archived, false, "unarchive survives replay");
assert.deepEqual(hub.listRooms().map((r) => r.name).sort(), ["finished", "live"]);
console.log("ARCHIVE OK");
