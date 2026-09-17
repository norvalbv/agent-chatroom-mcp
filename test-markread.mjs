import { Hub } from "./dist/hub.js";

const hub = new Hub();
hub.createRoom("test", { expectedParticipants: 0 });
const { participant: p1 } = hub.join("test", "alice", "claude");
const { participant: p2 } = hub.join("test", "bob", "claude");

// Post messages 1-5 from p2
for (let i = 1; i <= 5; i++) {
  hub.send("test", p2.id, `Message ${i}`);
}

console.log("Initial state:");
console.log(`  p1.lastSeenSeq: ${p1.lastSeenSeq}`);

// Call wait with sinceSeq=0 (so it will return messages 1-5)
const msgs = await hub.wait("test", p1.id, 0, 0);
console.log(`\nAfter wait(sinceSeq=0):`);
console.log(`  Messages returned: ${msgs.length}`);
console.log(`  p1.lastSeenSeq: ${p1.lastSeenSeq}`);

// Now post message 6
hub.send("test", p2.id, "Message 6");

// If lastSeenSeq was set to the last message in the room (6),
// then deliverable() will return messages > 6, which is none
// But if it was set to the last delivered message (5), then 
// deliverable() will return message 6
const msgs2 = await hub.wait("test", p1.id, p1.lastSeenSeq, 0);
console.log(`\nAfter posting message 6 and wait(sinceSeq=lastSeenSeq):`);
console.log(`  Messages returned: ${msgs2.length}`);
console.log(`  Expected: 1 message (message 6)`);
