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
function room3(opts: { requireVerification?: boolean } = {}) {
  const h = new Hub();
  const name = `reviewer-assign-${++serial}`;
  const { room, participant: owner } = h.join(name, "owner", "test", opts);
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

test("an opening burst of claims is spread across seats, not piled on the first seat that joined (swarm-113146-9k8v: 6 of 7 went to one seat)", () => {
  const h = new Hub();
  const name = `reviewer-assign-${++serial}`;
  const seats = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].map((n) => h.join(name, n, "test").participant);
  const load = new Map<string, number>();
  // seven of the eight seats each claim one area before anyone has verified anything
  for (const owner of seats.slice(1)) {
    const entry = h.setBoard(name, owner.id, `claim/area-${owner.name}`, JSON.stringify({ area: owner.name, owner: owner.name, status: "open" }))!;
    assert.ok(entry.reviewer && entry.reviewer !== owner.name, "every claim gets a reviewer who is not its owner");
    load.set(entry.reviewer!, (load.get(entry.reviewer!) ?? 0) + 1);
  }
  const counts = seats.map((s) => load.get(s.name) ?? 0);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `reviews must be spread evenly across seats, got ${JSON.stringify(Object.fromEntries(load))}`);
});

test("reviewer is assigned once at creation; a later edit to the same claim does not reassign it", () => {
  const { h, room, owner, bob, carol } = room3();
  const first = h.setBoard(room.name, owner.id, "claim/x", JSON.stringify({ area: "x", owner: "owner", status: "open" }))!;
  h.setBoard(room.name, carol.id, "verify/dummy2", "n/a"); // would make carol look even more overdue if creation ran again
  const second = h.setBoard(room.name, owner.id, "claim/x", JSON.stringify({ area: "x", owner: "owner", status: "open", note: "progress" }))!;
  assert.equal(second.reviewer, first.reviewer, "reviewer stays put across an update to the same key");
});

test("a sock-puppet second identity on the owner's own session is never assigned as reviewer (identity-is-the-connection)", () => {
  const h = new Hub();
  const name = `reviewer-assign-sockpuppet-${++serial}`;
  const { room, participant: owner } = h.join(name, "owner", "test", {}, undefined, "shared-session");
  const { participant: ownerAlt } = h.join(name, "owner-helper", "test", {}, undefined, "shared-session"); // same session, second name
  const { participant: carol } = h.join(name, "carol", "test", {}, undefined, "carol-session");
  const entry = h.setBoard(room.name, owner.id, "claim/sockpuppet", JSON.stringify({ area: "sockpuppet", owner: "owner", status: "open" }))!;
  assert.equal(entry.reviewer, carol.name, "the only real second connection is carol; the owner's own second identity must not be picked");
  assert.notEqual(entry.reviewer, ownerAlt.name);
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
// Every head below carries fail-to-pass evidence (docs/decisions/proposed/verify-head-fail-to-pass.md) so each case
// still tests the reviewer rule it names, not the missing base_commit/base_exit_code.
const head = (proposal: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ proposal, command: "npm test", cwd: ".", base_commit: "a1b2c3d", base_exit_code: 1, commit: "e4f5a6b", exit_code: 0, output_tail: "ok", ...extra });

test("require_verification is satisfied by the assigned reviewer's entry naming the proposal", () => {
  const { h, room, owner, bob } = room3();
  h.setBoard(room.name, owner.id, "claim/gate", JSON.stringify({ area: "gate", owner: "owner", status: "open" })); // bob assigned
  const pr = h.propose(room.name, owner.id, "Ship the gate change exactly as described here.");
  h.setBoard(room.name, bob.id, "verify/gate", head(pr.id));
  assert.ok(h.verifiedBy(room, pr), "bob is the assigned reviewer and wrote a qualifying entry");
});

test("require_verification does NOT accept a non-reviewer's entry while the assigned reviewer is still active", () => {
  const { h, room, owner, bob, carol } = room3();
  void bob;
  h.setBoard(room.name, owner.id, "claim/gate2", JSON.stringify({ area: "gate2", owner: "owner", status: "open" })); // bob assigned, not carol
  const pr = h.propose(room.name, owner.id, "Ship the second gate change exactly as described here.");
  h.setBoard(room.name, carol.id, "verify/gate2", head(pr.id));
  assert.equal(h.verifiedBy(room, pr), undefined, "carol is not the assigned reviewer and bob (the reviewer) is still active: her entry must not satisfy the gate");
});

test("require_verification falls back to any non-author entry once the assigned reviewer has left", () => {
  const { h, room, owner, bob, carol } = room3();
  h.setBoard(room.name, owner.id, "claim/gate3", JSON.stringify({ area: "gate3", owner: "owner", status: "open" })); // bob assigned
  h.leave(room.name, bob.id, "done for now");
  const pr = h.propose(room.name, owner.id, "Ship the third gate change exactly as described here.");
  h.setBoard(room.name, carol.id, "verify/gate3", head(pr.id));
  assert.ok(h.verifiedBy(room, pr), "the assigned reviewer left, so any qualifying non-author entry counts again");
});

test("the assigned reviewer's rerun with no fail-to-pass evidence does not count; the refusal names the reviewer and what is missing", () => {
  const { h, room, owner, bob } = room3({ requireVerification: true });
  h.setBoard(room.name, owner.id, "claim/gate4", JSON.stringify({ area: "gate4", owner: "owner", status: "open" })); // bob assigned
  h.setBoard(room.name, owner.id, "verify/gate4-author", "npm test, exit 0 in my worktree"); // propose needs any verify/* first
  const pr = h.propose(room.name, owner.id, "Ship the fourth gate change exactly as described here.");
  h.setBoard(room.name, bob.id, "verify/gate4", JSON.stringify({ proposal: pr.id, command: "npm test", cwd: ".", exit_code: 0, output_tail: "ok" }));
  assert.equal(h.verifiedBy(room, pr), undefined, "the reviewer is right, the evidence is not: a rerun that passes shows nothing failed before");
  const refusal = h.blockedBy(room, pr).find((m) => m.startsWith("a verify/* board entry"))!;
  assert.match(refusal, /your assigned reviewer, bob/);
  assert.match(refusal, /bob's verify\/gate4 does not count: it names no "commit"/);
  h.setBoard(room.name, bob.id, "verify/gate4", head(pr.id, { kind: "exercised" }));
  assert.ok(h.verifiedBy(room, pr), "the same reviewer's fail-to-pass head counts");
});

test("a non-reviewer's fail-to-pass head is named back as not counting while the reviewer is present", () => {
  const { h, room, owner, carol } = room3({ requireVerification: true });
  h.setBoard(room.name, owner.id, "claim/gate5", JSON.stringify({ area: "gate5", owner: "owner", status: "open" })); // bob assigned
  h.setBoard(room.name, owner.id, "verify/gate5-author", "npm test, exit 0 in my worktree"); // propose needs any verify/* first
  const pr = h.propose(room.name, owner.id, "Ship the fifth gate change exactly as described here.");
  h.setBoard(room.name, carol.id, "verify/gate5", head(pr.id));
  assert.equal(h.verifiedBy(room, pr), undefined);
  assert.ok(h.blockedBy(room, pr).some((m) => /carol's verify\/gate5 does not count: the assigned reviewer, bob, is still in the room/.test(m)));
});

test("after the reviewer leaves, the fallback entry still needs fail-to-pass evidence (or the refactor path)", () => {
  const { h, room, owner, bob, carol } = room3();
  h.setBoard(room.name, owner.id, "claim/gate6", JSON.stringify({ area: "gate6", owner: "owner", status: "open" })); // bob assigned
  h.leave(room.name, bob.id, "done for now");
  const pr = h.propose(room.name, owner.id, "Ship the sixth gate change exactly as described here.");
  h.setBoard(room.name, carol.id, "verify/gate6", head(pr.id, { base_exit_code: 0 }));
  assert.equal(h.verifiedBy(room, pr), undefined, "passes at both commits, no refactor declared");
  h.setBoard(room.name, carol.id, "verify/gate6", head(pr.id, { base_exit_code: 0, refactor: true }));
  assert.ok(h.verifiedBy(room, pr), "the refactor path counts for the fallback reviewer too");
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
