import { Hub } from "./dist/hub.js";

const hub = new Hub();
hub.createRoom("test", { expectedParticipants: 0 });
const { participant: alice } = hub.join("test", "alice", "claude");
const { participant: bob } = hub.join("test", "bob", "claude");
const { participant: human } = hub.join("test", "human", "human");

console.log("=== Scenario: Withheld human message never delivered ===\n");

// 1. Human sends message while alice is nominated responder
const humanMsg = hub.send("test", human.id, "Hello Alice!");
console.log(`1. Human sent message at seq ${humanMsg.seq}`);
console.log(`   Alice's lastSeenSeq: ${alice.lastSeenSeq}`);

// 2. Alice sends a message NOT addressing human (so it doesn't trigger small-talk guard)
const aliceMsg = hub.send("test", alice.id, "Let me check something", undefined, true);
console.log(`\n2. Alice sent message at seq ${aliceMsg.seq} (not addressing human)`);
console.log(`   Alice's lastSeenSeq: ${alice.lastSeenSeq}`);
console.log(`   Alice's withheld: ${JSON.stringify(alice.withheld)}`);

// 3. Human message becomes answered by Bob
hub.send("test", bob.id, "Hi there!", humanMsg.id);
console.log(`\n3. Bob answered the human message`);

// 4. Check if Alice will see the human message now
const deliverable = await hub.wait("test", alice.id, alice.lastSeenSeq, 0);
console.log(`\n4. Alice calls wait() with since=${alice.lastSeenSeq}`);
console.log(`   Deliverable messages: ${deliverable.length}`);
console.log(`   Message seqs: ${deliverable.map(m => m.seq).join(", ")}`);
console.log(`   Does it include the human msg (seq ${humanMsg.seq})? ${deliverable.some(m => m.seq === humanMsg.seq) ? "YES" : "NO (BUG!)"}`);

// 5. The issue: lastSeenSeq was advanced past the human message without capturing it in withheld[]
console.log(`\n5. Root cause:`);
console.log(`   Human msg seq: ${humanMsg.seq}`);
console.log(`   Alice lastSeenSeq after send(): ${alice.lastSeenSeq}`);
console.log(`   Withheld list: ${JSON.stringify(alice.withheld)}`);
console.log(`   Since deliverable only returns seq > ${alice.lastSeenSeq} OR seqs in withheld,`);
console.log(`   and seq ${humanMsg.seq} is neither, it will never be delivered!`);
