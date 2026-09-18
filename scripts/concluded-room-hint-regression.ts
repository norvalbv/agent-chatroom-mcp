/** Item 4 (swarm-140213-25wq, reported from frink-open-source-direction-2026-09-18 #129/#132): after a room
 * concludes with an outstanding @-mention still unanswered, wait_for_messages's hint says "The room has
 * concluded. Read the conclusion and leave_room." in the SAME response whose addressed_to_you still lists the
 * outstanding mention and whose your_turn is true (free rooms). The hint and the payload read different state.
 *
 * Root cause: server.ts's hint ternary (room.state === "concluded" branch) is reached only when
 * hub.attentionFocus(r, p) is undefined, and attentionFocus() (hub.ts) explicitly returns undefined for any
 * concluded/closed room. But addressed_to_you (server.ts) is built from hub.addressedBy(r, p), which has no
 * room-state check at all and keeps returning unresolved @-mentions regardless of conclusion. Two different
 * state reads produce a contradictory response.
 *
 * npx tsx scripts/concluded-room-hint-regression.ts */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";

Hub.DEFAULT_NUDGE_MS = 0;
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
  return { call };
}

const room = "concluded-hint-test";
const a = await seat("a"); const b = await seat("b"); const c = await seat("c");
await a.call("join_room", { room, name: "A", agent: "test" });
await b.call("join_room", { room, name: "B", agent: "test" });
await c.call("join_room", { room, name: "C", agent: "test" });

// C addresses B, mirroring Fable's #129/#132 addressing Codex; B never replies before conclusion.
let r = await c.call("send_message", { room, content: "@B what did the gate deliver?", force: true });
assert.ok(!r.error, "ask sent: " + r.text);
await b.call("wait_for_messages", { room, timeout_ms: 0 }); // B reads it, cursor moves past it, still doesn't answer

const TEXT = "Ship the metrics dashboard as drafted.";
r = await a.call("propose", { room, text: TEXT });
assert.ok(!r.error, "proposed: " + r.text);
const proposalId = JSON.parse(r.text).id as string;
r = await b.call("challenge", { room, proposal_id: proposalId, objection: 'The phrase "Ship the metrics dashboard as drafted." overstates readiness before an amend.' });
assert.ok(!r.error, "challenged: " + r.text);
r = await a.call("amend", { room, proposal_id: proposalId, find: "as drafted", replace: "after review" });
assert.ok(!r.error, "amended: " + r.text);
const agree = async (who: typeof a, quote: string) => who.call("vote", { room, proposal_id: proposalId, vote: "agree", quote, reason: "Checked independently." });
assert.ok(!(await agree(a, "Ship the metrics dashboard")).error);
assert.ok(!(await agree(b, "Ship the metrics dashboard")).error);
assert.ok(!(await agree(c, "Ship the metrics dashboard")).error);

const rm = hub.getRoom(room);
assert.equal(rm.state, "concluded", "room concluded");

// B still has C's #-addressed message outstanding (never replied/passed). Poll again post-conclusion.
r = await b.call("wait_for_messages", { room, timeout_ms: 0 });
assert.ok(!r.error, "wait_for_messages: " + r.text);
const payload = JSON.parse(r.text);

console.log("hint:", JSON.stringify(payload.hint));
console.log("addressed_to_you:", JSON.stringify(payload.addressed_to_you));
console.log("your_turn:", payload.your_turn);
console.log("room_state:", payload.room_state);

const stillAddressed = Array.isArray(payload.addressed_to_you) && payload.addressed_to_you.length > 0;
assert.ok(stillAddressed, "test setup broken: C's mention of B should still be outstanding");

// The bug: the hint claims there is nothing left ("Read the conclusion and leave_room", no mention of
// the outstanding address) in the same response whose addressed_to_you says otherwise.
const hintClaimsNothingOutstanding = /^The room has concluded\. Read the conclusion and leave_room\.$/.test(payload.hint ?? "");
assert.ok(
  !hintClaimsNothingOutstanding,
  `BUG REPRODUCED: hint says "${payload.hint}" (nothing more to do) while addressed_to_you still carries an outstanding mention (${JSON.stringify(payload.addressed_to_you)}) and your_turn=${payload.your_turn}. The hint and the payload disagree about whether there is unfinished business.`,
);
// The fixed hint must still say the decision/room has concluded, AND must surface the outstanding address.
assert.match(payload.hint, /concluded/i, "hint should still say the room/decision concluded");
assert.match(payload.hint, /outstanding|addressed you/i, "hint should surface the still-outstanding address instead of silently contradicting addressed_to_you");

console.log("CONCLUDED ROOM HINT REGRESSION: 1/1 passed");
process.exitCode = 0;
