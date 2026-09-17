import { Hub } from "./dist/hub.js";

const hub = new Hub();
hub.createRoom("test", { expectedParticipants: 0 });
const { participant: p1 } = hub.join("test", "alice", "claude");
const { participant: human } = hub.join("test", "human-user", "human");

console.log("Initial state:");

// Send an unanswered human message
const humanMsg = hub.send("test", human.id, "Hey Alice!");
console.log(`Human sent message at seq ${humanMsg.seq}`);

// Now p1 (alice) calls wait
// The human message should be withheld (only visible to responder)
const msgs = await hub.wait("test", p1.id, 0, 0);
console.log(`\nAfter wait():`);
console.log(`  Messages returned to p1: ${msgs.length}`);
console.log(`  p1.withheld: ${JSON.stringify(p1.withheld)}`);
console.log(`  p1.lastSeenSeq: ${p1.lastSeenSeq}`);

// The room's last message seq
const lastSeq = hub.getRoom("test").messages.at(-1).seq;
console.log(`  Last message in room: seq ${lastSeq}`);
