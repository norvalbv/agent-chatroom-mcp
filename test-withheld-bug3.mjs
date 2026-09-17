import { Hub } from "./dist/hub.js";

const hub = new Hub();
hub.createRoom("test", { expectedParticipants: 0 });
const { participant: alice } = hub.join("test", "alice", "claude");
const { participant: bob } = hub.join("test", "bob", "claude");
const { participant: human } = hub.join("test", "human", "human");

console.log("=== Scenario: Withheld human message lost due to send() ===\n");

// 1. Human sends message
console.log("1. Human sends message");
let room = hub.getRoom("test");
const humanMsg = hub.send("test", human.id, "Hi Bob!");
console.log(`   Seq ${humanMsg.seq}: visible to Alice? ${hub['visibleTo'](room, humanMsg, alice.id)}`);
console.log(`   Alice lastSeenSeq: ${alice.lastSeenSeq}`);

// 2. Alice sends a message (this calls markRead but not settleRead)
console.log(`\n2. Alice sends message with force=true`);
const aliceMsg = hub.send("test", alice.id, "Checking in", undefined, true);
room = hub.getRoom("test");
console.log(`   Alice lastSeenSeq now: ${alice.lastSeenSeq}`);
console.log(`   Alice withheld: ${JSON.stringify(alice.withheld)}`);

// 3. Human message becomes visible (Bob answers with force=true)
console.log(`\n3. Bob answers with force=true`);
const bobMsg = hub.send("test", bob.id, "Got it!", humanMsg.id, true);
room = hub.getRoom("test");
const visibleNow = hub['visibleTo'](room, humanMsg, alice.id);
console.log(`   Message ${humanMsg.seq} visible to Alice now? ${visibleNow}`);

// 4. Alice calls wait
console.log(`\n4. Alice calls wait(since=${alice.lastSeenSeq})`);
const delivered = await hub.wait("test", alice.id, alice.lastSeenSeq, 0);
console.log(`   Delivered: ${delivered.map(m => m.seq).join(", ")}`);
const hasHumanMsg = delivered.some(m => m.seq === humanMsg.seq);
console.log(`   Includes human msg (seq ${humanMsg.seq})? ${hasHumanMsg ? "YES" : "NO"}`);

if (!hasHumanMsg) {
  console.log(`\n5. BUG REPRODUCED:`);
  console.log(`   - Human msg seq: ${humanMsg.seq}`);
  console.log(`   - Alice lastSeenSeq: ${alice.lastSeenSeq}`);
  console.log(`   - Alice withheld: ${JSON.stringify(alice.withheld)}`);
  console.log(`   - The message is lost forever!`);
}
