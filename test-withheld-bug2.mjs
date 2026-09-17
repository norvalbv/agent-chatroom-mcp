import { Hub } from "./dist/hub.js";

const hub = new Hub();
hub.createRoom("test", { expectedParticipants: 0 });
const { participant: alice } = hub.join("test", "alice", "claude");
const { participant: bob } = hub.join("test", "bob", "claude");
const { participant: human } = hub.join("test", "human", "human");

console.log("=== Scenario: Withheld human message lost due to send() ===\n");

// 1. Human sends message (initially visible only to Bob as responder)
console.log("1. Human sends message");
let room = hub.getRoom("test");
const humanMsg = hub.send("test", human.id, "Hi Bob!");
console.log(`   Seq ${humanMsg.seq}: withheld from Alice? ${!hub['visibleTo'](room, humanMsg, alice.id)}`);
console.log(`   Alice lastSeenSeq: ${alice.lastSeenSeq}`);

// 2. Alice sends a message (this calls markRead but not settleRead)
console.log(`\n2. Alice sends message with force=true`);
const aliceMsg = hub.send("test", alice.id, "Checking in", undefined, true);
room = hub.getRoom("test");
console.log(`   Alice lastSeenSeq now: ${alice.lastSeenSeq}`);
console.log(`   Alice withheld: ${JSON.stringify(alice.withheld)}`);
console.log(`   Message ${humanMsg.seq} passed lastSeenSeq? ${humanMsg.seq < alice.lastSeenSeq}`);

// 3. Human message now becomes visible (Bob answers it)
console.log(`\n3. Bob answers human message`);
const bobMsg = hub.send("test", bob.id, "Got it!", humanMsg.id);
room = hub.getRoom("test");
const visibleNow = hub['visibleTo'](room, humanMsg, alice.id);
console.log(`   Message ${humanMsg.seq} visible to Alice now? ${visibleNow}`);

// 4. Alice calls wait - will she see the human message?
console.log(`\n4. Alice calls wait(since=${alice.lastSeenSeq})`);
const delivered = await hub.wait("test", alice.id, alice.lastSeenSeq, 0);
console.log(`   Delivered: ${delivered.map(m => m.seq).join(", ")}`);
console.log(`   Includes human msg (seq ${humanMsg.seq})? ${delivered.some(m => m.seq === humanMsg.seq) ? "YES" : "NO - BUG!"}`);

if (!delivered.some(m => m.seq === humanMsg.seq)) {
  console.log(`\n5. BUG CONFIRMED:`);
  console.log(`   - Human msg seq: ${humanMsg.seq}`);
  console.log(`   - Alice lastSeenSeq: ${alice.lastSeenSeq}`);
  console.log(`   - Alice withheld: ${JSON.stringify(alice.withheld)}`);
  console.log(`   - Since deliverable checks: seq > lastSeenSeq OR seq in withheld`);
  console.log(`   - And ${humanMsg.seq} is neither, message is lost forever!`);
}
