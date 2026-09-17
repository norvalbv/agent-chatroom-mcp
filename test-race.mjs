import { Hub } from "./dist/hub.js";

const hub = new Hub();
const room = hub.createRoom("test-race", { expectedParticipants: 0 });
const { participant: p1 } = hub.join("test-race", "alice", "claude");
const { participant: p2 } = hub.join("test-race", "bob", "claude");

// Test 1: Long-poll should wake immediately when message arrives during wait setup
async function testTocTouRace() {
  const waitPromise = hub.wait("test-race", p1.id, 0, 5000);
  
  // Tiny delay, then post a message (simulating the race condition)
  await new Promise(r => setTimeout(r, 10));
  hub.send("test-race", p2.id, "Hello!");
  
  const start = Date.now();
  const msgs = await waitPromise;
  const elapsed = Date.now() - start;
  
  console.log(`Test 1 - Elapsed: ${elapsed}ms, Messages: ${msgs.length}`);
  if (elapsed > 500) {
    console.log("  ⚠ BUG CANDIDATE: Long-poll didn't wake immediately; took", elapsed, "ms instead");
  } else {
    console.log("  ✓ OK: Long-poll woke up quickly");
  }
}

await testTocTouRace();
