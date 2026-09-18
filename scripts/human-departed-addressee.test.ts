/** A human ask addressed to a seat that has left, answered by the hub's own nominated responder after the human has
 * already said something else, is answered: the hub must not keep nominating every fresh seat to answer it again.
 * Reproduction: swarm-214936-s3jy-room #587 "@union-alpha-25-r1 looks like it is concluded?" was re-served to lobby seats
 * for an hour (#694, #720, #731, #732 all answer it). npx tsx scripts/human-departed-addressee.test.ts */
import assert from "node:assert/strict";
import { Hub } from "../src/hub.js";

const hub = new Hub();
const room = hub.createRoom("departed-addressee", { expectedParticipants: 0 });
const gone = hub.join(room.name, "union-alpha-25-r1", "openrouter", {}, undefined, "s-gone").participant;
const a = hub.join(room.name, "lobby-5", "openrouter", {}, undefined, "s-a").participant;
const b = hub.join(room.name, "lobby-2", "openrouter", {}, undefined, "s-b").participant;
const benji = hub.join(room.name, "benji", "human").participant;
const ask = hub.send(room.name, benji.id, "@union-alpha-25-r1 looks like it is concluded? Go into the room and read it.", undefined, true); // the dashboard route sends with force
// ...and then the addressee dies (live: the model was withdrawn five minutes later).
hub.leave(room.name, gone.id, "provider error");
// The addressee is gone, so the hub nominates whoever asks first: lobby-5.
assert.equal(hub.responderFor(room, ask, a.id).mine, true, "a is nominated for the orphaned ask");
assert.equal(hub.responderFor(room, ask, b.id).mine, false, "b is not");
// The human says something else before the answer lands.
hub.send(room.name, benji.id, "@all feel free to recruit more if you need further guidance");
// The nominated responder answers by name, without reply_to, after that later human message.
hub.send(room.name, a.id, "@benji Yes: that room concluded prop_659f2937 v2, all seats left on purpose.", undefined, true);
assert.equal(hub.isAnswered(room, ask), true, "the nominated responder's named reply answers the ask even after a later human message");
// A seat joining now is not asked to answer it.
const c = hub.join(room.name, "lobby-9", "openrouter", {}, undefined, "s-c").participant;
assert.equal(hub.responderFor(room, ask, c.id).mine, false, "a fresh seat is not nominated for an answered ask");
assert.notEqual(hub.unansweredHuman(room)?.id, ask.id, "the hub no longer reports #1 as the unanswered human message");

// Control: a reply by someone who was NOT nominated, after a later human message, still does not answer an ask
// (the attribution rule that keeps "hi benji" from answering the wrong message stays).
const gone2 = hub.join(room.name, "union-alpha-26-r1", "openrouter", {}, undefined, "s-gone2").participant;
const ask2 = hub.send(room.name, benji.id, "@union-alpha-26-r1 second question for a seat about to die", undefined, true);
hub.leave(room.name, gone2.id, "provider error");
assert.equal(hub.responderFor(room, ask2, a.id).mine, true);
hub.send(room.name, benji.id, "unrelated third human message");
hub.send(room.name, b.id, "@benji I was not asked but here is a thought.", undefined, true);
assert.equal(hub.isAnswered(room, ask2), false, "an un-nominated reply after a later human message does not answer");
// The ask's addressee has left: the hub hands the ask to its nominated successor (human-takeover contract), who may
// answer it with reply_to; naming the human is allowed even when the human is not currently active.
const ask3 = hub.send(room.name, benji.id, "@lobby-9 a third question, to a seat that will leave", undefined, true);
hub.leave(room.name, c.id, "budget");
hub.leave(room.name, benji.id);
assert.equal(hub.responderFor(room, ask3, b.id).mine, true, "b becomes the successor responder");
const reply = hub.send(room.name, b.id, "@benji answering the orphaned ask with reply_to", ask3.id, true);
assert.equal(reply.replyTo, ask3.id);
assert.equal(hub.isAnswered(room, ask3), true, "a reply_to from anyone answers an orphaned ask");
// ...but a live addressee is still protected from others answering for them.
const live = hub.join(room.name, "lobby-10", "openrouter", {}, undefined, "s-live").participant;
const h2 = hub.join(room.name, "benji", "human").participant;
const ask4 = hub.send(room.name, h2.id, "@lobby-10 only you please", undefined, true);
assert.throws(() => hub.send(room.name, b.id, "@benji butting in", ask4.id, true), /addressed that to/);
assert.ok(hub.send(room.name, live.id, "@benji here", ask4.id, true));
console.log("HUMAN DEPARTED ADDRESSEE OK");
