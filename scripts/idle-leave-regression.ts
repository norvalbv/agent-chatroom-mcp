/** Claude seats poll; harnessed seats do not. Across past rooms pure polling is 17-19% of a Claude seat's time against
 * 1.5% for OpenRouter seats and 3.3% for Codex seats (scripts/measure/idle-waits-by-seat-kind.py): src/seat.ts hands a
 * harnessed seat off after 20 turns with nothing actionable (R2, handoffIdleTurns), and a Claude Code seat has no
 * harness to do that, so it is woken every 55 s, pays a full turn, and is told to wait again.
 *
 * The hub now says the same thing to a seat it can see has polled N times running with nothing open for it: put what
 * you have on handoff/<area> and leave (leaving blocks nothing), or say in one line whom you are waiting on. It is an
 * offer, never a removal; a seat that is working locally, owes something, or has open work never sees it, and the
 * verifier (who must be there for the final vote) is not asked.
 *
 * npx tsx scripts/idle-leave-regression.ts */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";
import * as openWork from "../src/hub/open-work.js";

Hub.DEFAULT_NUDGE_MS = 0;
const policy = (openWork as unknown as { idlePolicy?: { leaveWaits: number } }).idlePolicy;
assert.ok(policy, "src/hub/open-work.ts exports idlePolicy");
assert.equal(policy.leaveWaits, 8, "default: eight idle waits running, about eight minutes of polling");
policy.leaveWaits = 3;

const hub = new Hub();
async function seat(name: string) {
  const session = createSessionServer(hub);
  const client = new Client({ name, version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await session.server.connect(st); await client.connect(ct);
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name: tool, arguments: args });
    return { error: !!r.isError, text: (r.content as { text: string }[])[0]?.text ?? "" };
  };
  const wait = async (room: string) => JSON.parse((await call("wait_for_messages", { room, timeout_ms: 0 })).text) as { hint?: string; messages: string[] };
  /** Drain what is queued, then return the hints of `n` empty waits running (the one that ended the drain is the first). */
  const idle = async (room: string, n: number) => {
    const hints: string[] = [];
    for (let i = 0; i < 6 && !hints.length; i++) { const w = await wait(room); if (!w.messages.length) hints.push(w.hint ?? ""); }
    while (hints.length < n) { await new Promise((r) => setTimeout(r, 3)); hints.push((await wait(room)).hint ?? ""); }
    return hints;
  };
  return { call, idle, wait };
}
const OLD = "No new messages yet. Call wait_for_messages again.";
const OFFER = /leave_room/;

const room = "idle-leave";
const a = await seat("a"); const b = await seat("b"); const v = await seat("v");
await a.call("join_room", { room, name: "A", agent: "test" });
await b.call("join_room", { room, name: "B", agent: "test" });
await v.call("join_room", { room, name: "V", agent: "test", role: "verifier" });
const pid = (name: string) => [...hub.getRoom(room).participants.values()].find((x) => x.name === name)!.id;

// 1. A seat with nothing open polls: plain line until the Nth idle wait running, then the offer, then plain again.
let hints = await a.idle(room, 5);
assert.deepEqual(hints.slice(0, 2), [OLD, OLD], `the first idle waits are the plain line: ${JSON.stringify(hints)}`);
assert.match(hints[2], OFFER, `the third idle wait running carries the offer: ${hints[2]}`);
assert.match(hints[2], /what you finished and where it is/, "it asks for a leave reason that says where the work is");
assert.match(hints[2], /waiting on|waiting for/, "and gives the alternative: say whom you are waiting on");
assert.match(hints[2], /3 /, "and counts the waits");
assert.deepEqual(hints.slice(3), [OLD, OLD], "it is not repeated on every wait after that");
hints = await a.idle(room, 1);
assert.match(hints[0], OFFER, "it returns after another N idle waits");

// 2. A seat that is working locally between waits is never idle, however many times it peeks.
for (let i = 0; i < 6; i++) {
  await new Promise((r) => setTimeout(r, 3));
  hub.heartbeat(room, pid("B"), { tool: "Bash", detail: "npm test" });
  const h = (await b.idle(room, 1))[0];
  assert.equal(h, OLD, `a seat heartbeating local tool calls is not offered the door (wait ${i + 1}): ${h}`);
}

// 3. Saying something resets the count: the seat has told the room what it is waiting on.
const c = await seat("c");
await c.call("join_room", { room, name: "C", agent: "test" });
hints = await c.idle(room, 2);
await c.call("send_message", { room, content: "Waiting on A's merge of the parser branch before I can rebase.", force: true });
hints = await c.idle(room, 2);
assert.deepEqual(hints, [OLD, OLD], `a seat that spoke starts again from zero: ${JSON.stringify(hints)}`);

// 4. The verifier is not offered the door: the room needs it for the final vote.
hints = await v.idle(room, 6);
assert.ok(hints.every((h) => !OFFER.test(h)), `the verifier is never told to leave: ${JSON.stringify(hints)}`);

// 5. Open work outranks the offer: a seat with something named to it is told that, not to leave.
await b.call("board_set", { room, key: "help/fixtures", text: "Need a second seat on CRLF fixtures." });
const d = await seat("d");
await d.call("join_room", { room, name: "D", agent: "test" });
hints = await d.idle(room, 5);
assert.ok(hints.every((h) => !OFFER.test(h)), `a seat with open work is not offered the door: ${JSON.stringify(hints)}`);
assert.match(hints[0], /help\/fixtures/);
await b.call("board_set", { room, key: "help/fixtures", text: "" });

// 6. While a proposal is open nobody is offered the door: votes are owed or about to be.
await b.call("propose", { room, text: "Ship the parser fix as it stands." });
const e = await seat("e");
await e.call("join_room", { room, name: "E", agent: "test" });
await e.call("challenge", { room, proposal_id: [...hub.getRoom(room).proposals.keys()][0], objection: '"as it stands" has no test behind it.' });
await e.call("vote", { room, proposal_id: [...hub.getRoom(room).proposals.keys()][0], vote: "disagree", reason: "add the CRLF test first" });
hints = await e.idle(room, 5);
assert.ok(hints.every((h) => !OFFER.test(h)), `no offer while a proposal is open: ${JSON.stringify(hints)}`);

// 7. Zero turns it off.
policy.leaveWaits = 0;
const f = await seat("f");
const room2 = "idle-leave-off";
await f.call("join_room", { room: room2, name: "F", agent: "test" });
hints = await f.idle(room2, 6);
assert.ok(hints.every((h) => h === OLD), "leaveWaits 0 disables the offer");

// 8. A seat whose own claim is still unreviewed may be waiting on its own long job (dev room swarm-004642-76kz-room:
// the offer reached the soak owner while its 6-minute soak ran). It is not offered the door; once a peer has reviewed
// the work it is, and it is pointed at the handoff entry leave_room will ask it for.
policy.leaveWaits = 3;
const g = await seat("g");
const h = await seat("h");
const room3 = "idle-leave-claim";
await g.call("join_room", { room: room3, name: "G", agent: "test" });
await h.call("join_room", { room: room3, name: "H", agent: "test" });
await g.call("board_set", { room: room3, key: "claim/parser", text: '{"owner":"G","area":"parser"}' });
await g.call("board_set", { room: room3, key: "evidence/parser", text: "CRLF fix on g/parser @ abc1234, 7/7; soak running." });
hints = await g.idle(room3, 6);
assert.ok(hints.every((x) => !OFFER.test(x)), `a seat whose claim nobody has reviewed is not offered the door: ${JSON.stringify(hints)}`);
await h.call("board_set", { room: room3, key: "review/parser", text: "Reran the parser tests at abc1234 myself: 7/7, holds." });
hints = await g.idle(room3, 3);
assert.match(hints[2], OFFER, `once reviewed, the claim holder is offered the door: ${JSON.stringify(hints)}`);
assert.match(hints[2], /handoff\/parser/, `and told to write handoff/<its area> first: ${hints[2]}`);

// 9. A seat that is the hub-assigned reviewer of a live claim whose work has not landed yet is not free: its review is
// coming (claude-opus-5-5-3's dev room swarm-005845-4g7o-room offered the door to exactly that seat).
const i = await seat("i"); const j = await seat("j");
const room4 = "idle-leave-reviewer";
await i.call("join_room", { room: room4, name: "I", agent: "test" });
await j.call("join_room", { room: room4, name: "J", agent: "test" });
await i.call("board_set", { room: room4, key: "claim/slow", text: '{"owner":"I","area":"slow"}' });
const rev = hub.getRoom(room4).board.get("claim/slow")!.reviewer;
assert.equal(rev, "J", "J is the assigned reviewer of claim/slow");
hints = await j.idle(room4, 6);
assert.ok(hints.every((x) => !OFFER.test(x)), `the assigned reviewer of work still coming is not offered the door: ${JSON.stringify(hints)}`);
await i.call("board_set", { room: room4, key: "evidence/slow", text: "Slow piece done on i/slow @ 1a2b3c4, 9/9." });
await j.call("board_set", { room: room4, key: "verify/slow", text: "Reran slow at 1a2b3c4 myself: 9/9." });
hints = await j.idle(room4, 3);
assert.match(hints[2], OFFER, `once it has reviewed, it may be offered the door: ${JSON.stringify(hints)}`);

console.log("idle-leave-regression: OK");
process.exit(0);
