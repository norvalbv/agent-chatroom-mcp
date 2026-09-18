/**
 * Rank 2 (swarm-100622-6jdx's peer-review plan, adopted swarm-102347-phin): the hub assigns a
 * reviewer when a claim/<area> is created — the least-recently-verifying active participant who
 * is not the owner — instead of a verifier being volunteered post-hoc. require_verification then
 * prefers that reviewer's verify/* entry over anyone else's while the reviewer is still active,
 * and falls back to any non-author entry once the reviewer has left. Both the claimant and the
 * reviewer are told; the reviewer's notice wakes a held wait_for_messages.
 * Run: npx tsx scripts/reviewer-assignment-regression.ts
 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";

const cases: [string, () => Promise<void> | void][] = [];
function test(name: string, run: () => Promise<void> | void) {
  cases.push([name, run]);
}

let serial = 0;
function room3() {
  const h = new Hub();
  const name = `reviewer-assign-${++serial}`;
  const { room, participant: owner } = h.join(name, "owner", "test");
  const { participant: bob } = h.join(name, "bob", "test");
  const { participant: carol } = h.join(name, "carol", "test");
  return { h, room, owner, bob, carol };
}

// ---------- assignment at claim creation ----------

test("claiming an area with 3 active participants sets reviewer to a different, least-loaded participant", () => {
  const { h, room, owner, bob } = room3();
  const entry = h.setBoard(room.name, owner.id, "claim/auth", JSON.stringify({ area: "auth", owner: "owner", team: ["owner"], status: "open" }))!;
  assert.equal(entry.reviewer, bob.name, "neither candidate has ever verified; ties break by earliest join (bob before carol)");
  assert.notEqual(entry.reviewer, owner.name, "the owner is never their own reviewer");
});

test("the reviewer is never-verified-first, then least-recently-verified, not just earliest join", () => {
  const { h, room, owner, bob, carol } = room3();
  // bob verifies something (any proposal id is fine, this just stamps lastVerifiedAt), carol never does.
  h.propose(room.name, owner.id, "Dummy proposal so a verify/* entry is well-formed.");
  h.setBoard(room.name, bob.id, "verify/dummy", "checked it, looks fine");
  const entry = h.setBoard(room.name, owner.id, "claim/payments", JSON.stringify({ area: "payments", owner: "owner", status: "open" }))!;
  assert.equal(entry.reviewer, carol.name, "carol has never verified anything; bob has, so carol is more overdue even though bob joined first");
});

test("reviewer is assigned once at creation; a later edit to the same claim does not reassign it", () => {
  const { h, room, owner, bob, carol } = room3();
  const first = h.setBoard(room.name, owner.id, "claim/x", JSON.stringify({ area: "x", owner: "owner", status: "open" }))!;
  h.setBoard(room.name, carol.id, "verify/dummy2", "n/a"); // would make carol look even more overdue if creation ran again
  const second = h.setBoard(room.name, owner.id, "claim/x", JSON.stringify({ area: "x", owner: "owner", status: "open", note: "progress" }))!;
  assert.equal(second.reviewer, first.reviewer, "reviewer stays put across an update to the same key");
});

// ---------- notification: claimant and reviewer both told, reviewer's is addressed ----------

test("both the claimant and the reviewer are told, and the reviewer's notice is addressed (mentions them)", () => {
  const { h, room, owner, bob } = room3();
  const before = room.messages.length;
  h.setBoard(room.name, owner.id, "claim/notify", JSON.stringify({ area: "notify", owner: "owner", status: "open" }));
  const posted = room.messages.slice(before);
  assert.ok(posted.some((m) => m.kind === "board" && /reviewer: bob/.test(m.content)), "the claim-added board notice names the reviewer, visible to everyone including the claimant");
  // kind "chat", not "system": addressedBy()/actionableNow() track an owed @-mention independent
  // of lastSeenSeq (via reply_to/decline bookkeeping, not a seq cursor), which is what makes the
  // wake in the next test survive hub.wait()'s settleRead already having advanced lastSeenSeq past
  // this very message by the time hold_until_actionable re-checks actionableNow. A "system"-kind
  // post looked right in isolation but loses the race every time (caught by sonnet-5's review).
  const toReviewer = posted.find((m) => m.kind === "chat" && m.mentions?.includes(bob.id));
  assert.ok(toReviewer, "a chat-kind, hub-authored line addresses the reviewer directly (from: system)");
  assert.equal(toReviewer!.from.id, "system");
  assert.match(toReviewer!.content, /@bob/);
});

test("a held wait_for_messages wakes for the reviewer on the assignment notice", () => {
  const { h, room, owner, bob } = room3();
  // bob has already read everything up to "now" (simulating a wait that returned with nothing actionable).
  bob.lastSeenSeq = room.messages.at(-1)?.seq ?? 0;
  assert.equal(h.actionableNow(room, bob), false, "nothing actionable yet");
  h.setBoard(room.name, owner.id, "claim/wake", JSON.stringify({ area: "wake", owner: "owner", status: "open" }));
  assert.equal(h.actionableNow(room, bob), true, "the addressed system line assigning bob as reviewer must wake a held wait");
});

test("actionableNow does not wake a bystander who is not the assigned reviewer", () => {
  const { h, room, owner, bob, carol } = room3();
  carol.lastSeenSeq = room.messages.at(-1)?.seq ?? 0;
  h.setBoard(room.name, owner.id, "claim/wake2", JSON.stringify({ area: "wake2", owner: "owner", status: "open" })); // bob gets picked (never-verified tie broken by join order)
  assert.equal(h.actionableNow(room, carol), false, "carol was not addressed; she is not woken by someone else's reviewer notice");
});

// ---------- live integration: the actual race hub.wait()'s settleRead creates ----------
// Unit-level actionableNow checks above set lastSeenSeq BEFORE the triggering write, which never
// exercises the real bug: server.ts's wait_for_messages calls hub.wait() first (which runs
// settleRead and so advances lastSeenSeq past the delivered message in the SAME call), and only
// THEN loops on actionableNow. A "system"-kind post with an explicit mentions field is already
// "seen" by the time that loop checks it and silently rides out the full timeout instead of
// waking promptly. Only a real two-connection wait_for_messages call over the MCP transport can
// tell the two apart; this is the test sonnet-5's review asked for (#64).

test("a held wait_for_messages wakes PROMPTLY (not just eventually) for the reviewer, over the real MCP tool", async () => {
  const hub = new Hub();
  const ownerSession = createSessionServer(hub);
  const bobSession = createSessionServer(hub);
  const ownerClient = new Client({ name: "owner", version: "1" });
  const bobClient = new Client({ name: "bob", version: "1" });
  const [oct, ost] = InMemoryTransport.createLinkedPair();
  const [bct, bst] = InMemoryTransport.createLinkedPair();
  await ownerSession.server.connect(ost);
  await ownerClient.connect(oct);
  await bobSession.server.connect(bst);
  await bobClient.connect(bct);
  const callAs = (client: Client) => async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    assert.ok(!r.isError, JSON.stringify(r));
    return JSON.parse((r.content as { text: string }[])[0].text);
  };
  const asOwner = callAs(ownerClient);
  const asBob = callAs(bobClient);

  const room = "reviewer-wake-live";
  await asOwner("join_room", { room, name: "owner", agent: "test" });
  await asBob("join_room", { room, name: "bob", agent: "test" });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const started = Date.now();
  const pending = asBob("wait_for_messages", { room, hold_until_actionable: true, timeout_ms: 3000 });
  await sleep(30);
  await asOwner("board_set", { room, key: "claim/live", text: JSON.stringify({ area: "live", owner: "owner", status: "open" }) }); // only bob is eligible: he is picked as reviewer

  const result = await pending;
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2500, `must wake promptly on the reviewer notice, not ride out the 3000ms timeout: took ${elapsed}ms`);
  assert.ok(result.messages.some((m: string) => /you are the reviewer/.test(m)), "the reviewer notice is in the delivered messages");
});

// ---------- require_verification: prefers the reviewer, falls back once they leave ----------

test("require_verification is satisfied by the assigned reviewer's entry naming the proposal", () => {
  const { h, room, owner, bob } = room3();
  h.setBoard(room.name, owner.id, "claim/gate", JSON.stringify({ area: "gate", owner: "owner", status: "open" })); // bob assigned
  const pr = h.propose(room.name, owner.id, "Ship the gate change exactly as described here.");
  h.setBoard(room.name, bob.id, "verify/gate", JSON.stringify({ proposal: pr.id, command: "npm test", cwd: ".", exit_code: 0, output_tail: "ok" }));
  assert.ok(h.verifiedBy(room, pr), "bob is the assigned reviewer and wrote a qualifying entry");
});

test("require_verification does NOT accept a non-reviewer's entry while the assigned reviewer is still active", () => {
  const { h, room, owner, bob, carol } = room3();
  void bob;
  h.setBoard(room.name, owner.id, "claim/gate2", JSON.stringify({ area: "gate2", owner: "owner", status: "open" })); // bob assigned, not carol
  const pr = h.propose(room.name, owner.id, "Ship the second gate change exactly as described here.");
  h.setBoard(room.name, carol.id, "verify/gate2", JSON.stringify({ proposal: pr.id, command: "npm test", cwd: ".", exit_code: 0, output_tail: "ok" }));
  assert.equal(h.verifiedBy(room, pr), undefined, "carol is not the assigned reviewer and bob (the reviewer) is still active: her entry must not satisfy the gate");
});

test("require_verification falls back to any non-author entry once the assigned reviewer has left", () => {
  const { h, room, owner, bob, carol } = room3();
  h.setBoard(room.name, owner.id, "claim/gate3", JSON.stringify({ area: "gate3", owner: "owner", status: "open" })); // bob assigned
  h.leave(room.name, bob.id, "done for now");
  const pr = h.propose(room.name, owner.id, "Ship the third gate change exactly as described here.");
  h.setBoard(room.name, carol.id, "verify/gate3", JSON.stringify({ proposal: pr.id, command: "npm test", cwd: ".", exit_code: 0, output_tail: "ok" }));
  assert.ok(h.verifiedBy(room, pr), "the assigned reviewer left, so any qualifying non-author entry counts again");
});

// ---------- visibility ----------

test("the reviewer is surfaced on the reveal-mode board summary (room view / dashboard)", () => {
  const { h, room, owner, bob } = room3();
  h.setBoard(room.name, owner.id, "claim/view", JSON.stringify({ area: "view", owner: "owner", status: "open" }));
  const view = h.summary(room, true);
  assert.equal((view.board["claim/view"] as { reviewer?: string }).reviewer, bob.name);
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}\n${error instanceof Error ? error.stack : error}`);
  }
}
console.log(`REVIEWER ASSIGNMENT: ${cases.length - failed}/${cases.length} passed`);
process.exitCode = failed ? 1 : 0;
