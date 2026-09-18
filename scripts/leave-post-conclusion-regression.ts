/** Once a room concludes or closes, leave_room never refuses for an abandoned claim/* or an owed ask: the hub
 * releases every claim/* itself in one system line instead of asking seats to write a handoff or a claim release.
 * A reason is still required. Board writes (board_set) are refused outright once concluded/closed, with a plain
 * message; verify/* and handoff/* entries written before conclusion stay readable.
 * Reproduction: room swarm-082729-8b5j-room made 14 forced handoff/*-add or claim/*-release board writes in the
 * 55 seconds after it concluded, one refused leave_room call per seat, because leaveRefusal did not know the
 * room was already done.
 * npx tsx scripts/leave-post-conclusion-regression.ts */
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

// ---- Part 1: a concluded room ----
const room = "leave-post-conclusion-test";
const a = await seat("a"); const b = await seat("b"); const c = await seat("c");
await a.call("join_room", { room, name: "A", agent: "test" });
await b.call("join_room", { room, name: "B", agent: "test" });
await c.call("join_room", { room, name: "C", agent: "test" });

// A owns a claim with no handoff/*; C addresses B and never gets a reply. Both would refuse leave_room today.
let r = await a.call("board_set", { room, key: "claim/metrics", text: JSON.stringify({ owner: "A", status: "open" }) });
assert.ok(!r.error, "claim written: " + r.text);
r = await b.call("board_set", { room, key: "verify/build", text: "npm run build; cwd=/repo; commit abc123; exit 0" });
assert.ok(!r.error, "verify written: " + r.text);
r = await c.call("send_message", { room, content: "@B what did the gate deliver?", force: true });
assert.ok(!r.error, "ask sent: " + r.text);
await b.call("wait_for_messages", { room, timeout_ms: 0 });

const TEXT = "Ship the metrics dashboard as drafted, verified in CI.";
r = await a.call("propose", { room, text: TEXT });
assert.ok(!r.error, "proposed: " + r.text);
const proposalId = JSON.parse(r.text).id as string;
r = await b.call("challenge", { room, proposal_id: proposalId, objection: 'The phrase "as drafted, verified in CI" overstates readiness before an amend.' });
assert.ok(!r.error, "challenged: " + r.text);
r = await a.call("amend", { room, proposal_id: proposalId, find: "as drafted, verified in CI", replace: "after review" });
assert.ok(!r.error, "amended: " + r.text);
const agree = async (who: typeof a, quote: string) => who.call("vote", { room, proposal_id: proposalId, vote: "agree", quote, reason: "Checked independently." });
r = await agree(a, "Ship the metrics dashboard");
assert.ok(!r.error, "A agreed: " + r.text);
r = await agree(b, "Ship the metrics dashboard");
assert.ok(!r.error, "B agreed: " + r.text);
r = await agree(c, "Ship the metrics dashboard");
assert.ok(!r.error, "C agreed: " + r.text);

const rm = hub.getRoom(room);
assert.equal(rm.state, "concluded", "room concluded");

// The hub released the claim itself, in one system line, without anyone writing a handoff/*.
assert.ok(!rm.board.has("claim/metrics"), "claim/metrics was released by the hub on conclusion");
const releaseNotice = rm.messages.filter((m) => m.kind === "system" && /released/.test(m.content)).at(-1);
assert.ok(releaseNotice, "a system line announced the release");
assert.match(releaseNotice!.content, /claim\/metrics/);
// verify/* written before conclusion is untouched.
assert.ok(rm.board.has("verify/build"), "verify/build survives conclusion");

// A reason is still required, even in a concluded room.
r = await a.call("leave_room", { room });
assert.ok(r.error && /reason/.test(r.text), "leave still needs a reason: " + r.text);

// A's orphaned claim no longer refuses leave_room once the room has concluded.
r = await a.call("leave_room", { room, reason: "metrics slice is done, room concluded" });
assert.ok(!r.error, "A's leave is not refused for the released claim: " + r.text);

// B's owed ask no longer refuses leave_room once the room has concluded.
r = await b.call("leave_room", { room, reason: "nothing more from me, room concluded" });
assert.ok(!r.error, "B's leave is not refused for the owed ask: " + r.text);

// Board writes are refused outright once concluded (any key, not just claim/*); reads of prior entries still work.
r = await c.call("board_set", { room, key: "evidence/final", text: "final note" });
assert.ok(r.error && /concluded/.test(r.text), "board_set is refused outright post-conclusion: " + r.text);
r = await c.call("board_get", { room, key: "verify/build" });
assert.ok(!r.error && /exit 0/.test(r.text), "board_get still reads pre-conclusion entries: " + r.text);
r = await c.call("leave_room", { room, reason: "room concluded, nothing left to do" });
assert.ok(!r.error, "C's leave succeeds: " + r.text);

// ---- Part 2: a closed room (no conclusion) also releases claims and stops refusing ----
const room2 = "leave-post-close-test";
const d = await seat("d");
await d.call("join_room", { room: room2, name: "D", agent: "test" });
r = await d.call("board_set", { room: room2, key: "claim/thing", text: JSON.stringify({ owner: "D", status: "open" }) });
assert.ok(!r.error, "claim/thing written: " + r.text);
r = await d.call("board_set", { room: room2, key: "handoff/other", text: "unrelated handoff written before close" });
assert.ok(!r.error, "handoff written: " + r.text);
hub.closeRoom(room2, "benji", "abandoned, human closed it");
const rm2 = hub.getRoom(room2);
assert.equal(rm2.state, "closed");
assert.ok(!rm2.board.has("claim/thing"), "claim/thing released on close");
assert.ok(rm2.board.has("handoff/other"), "handoff/other written before close survives");

// closeRoom already deactivated D (abandoned-room cleanup); a seat that reconnects afterwards (the launcher's
// respawn/replacement path, or a late reconnect) still must not be refused for the already-released claim, and
// board_set must still refuse outright even for a freshly (re)joined, active participant.
r = await d.call("join_room", { room: room2, name: "D", agent: "test" });
assert.ok(!r.error, "D rejoins the closed room: " + r.text);
r = await d.call("board_set", { room: room2, key: "evidence/late", text: "too late" });
assert.ok(r.error && /closed/.test(r.text), "board_set is refused outright post-close: " + r.text);
r = await d.call("leave_room", { room: room2, reason: "room closed, nothing left to do" });
assert.ok(!r.error, "D's leave is not refused after close: " + r.text);

console.log("LEAVE-POST-CONCLUSION OK");
