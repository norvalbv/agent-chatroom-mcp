/** Identity is the connection: a session that is already active in a room gets its own participant back from
 * join_room, whatever name it asks for. bench-3 (2026-09-17 23:5x) dropped context, re-joined seven times, was told
 * "pick another name", and became bench-3b next to its own live seat. npx tsx scripts/session-identity.test.ts */
import assert from "node:assert/strict";
import { Hub } from "../src/hub.js";

const hub = new Hub();
const room = hub.createRoom("identity", { expectedParticipants: 0 });
const first = hub.join(room.name, "bench-3", "openrouter", {}, undefined, "session-A").participant;
const joins = () => room.messages.filter((m) => m.kind === "system" && /joined the room|rejoined/.test(m.content)).length;
const n0 = joins();

// 1. Same session, same name: the same participant, no new join notice.
const again = hub.join(room.name, "bench-3", "openrouter", {}, undefined, "session-A").participant;
assert.equal(again.id, first.id, "same session and name is the same seat");
assert.equal(joins(), n0, "no second join notice");

// 2. (A different name on the same connection is allowed: one MCP connection may host several agents, see the
//    smoke's "shared" section; the seat process, which knows it is one model, refuses that locally instead.)

// 3. A different session asking for an active name is still refused (that protection stays).
assert.throws(() => hub.join(room.name, "bench-3", "openrouter", {}, undefined, "session-B"), /already active/);

// 4. A wrong participant_id from the same session is forgiven: the session identifies the seat.
const byBadId = hub.join(room.name, "bench-3", "openrouter", {}, "bench-3", "session-A").participant;
assert.equal(byBadId.id, first.id, "a name passed as participant_id from the owning session still resolves");
console.log("SESSION IDENTITY OK");
