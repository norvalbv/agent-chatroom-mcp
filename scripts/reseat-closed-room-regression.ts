/**
 * A seat is not put back in a room that has been closed. A launched seat that reconnects (the hub restarted, or its MCP
 * session dropped) takes its seat back by its seat key on its next call (scripts/reseat-regression.ts), but the rule
 * never looked at the room: closing a room marks every seat inactive with no leave reason, which is exactly what a
 * dropped session looks like, so the seat's next call re-activated it, wrote a join event and posted "rejoined the
 * room" in a room nobody can act in (merge-review backlog B9d, docs/self-improvement-swarm-003601-tky5.md). A concluded
 * room keeps its seats: they still read the conclusion there.
 * Run: npx tsx scripts/reseat-closed-room-regression.ts
 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { reseatable } from "../src/hub/liveness.js";
import { createSessionServer } from "../src/server.js";

const cases: [string, () => Promise<void> | void][] = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

Hub.DEFAULT_NUDGE_MS = 0;
/** One MCP connection, as a launcher starts it: its seat key is bound to the connection before any call. */
async function connect(h: Hub, seatKey?: string) {
  const session = createSessionServer(h);
  if (seatKey) h.bindSeat(seatKey, session.sessionKey);
  const client = new Client({ name: seatKey ?? "walk-in", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await session.server.connect(st); await client.connect(ct);
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name: tool, arguments: args });
    const text = (r.content as { text: string }[])[0]?.text ?? "";
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text); } catch { /* a refusal is prose */ }
    return { error: !!r.isError, text, data };
  };
  return { call, session };
}
let serial = 0;
/** A room with two launched seats; the first one's connection then drops, as it does over a hub restart. */
async function room() {
  const h = new Hub();
  const name = `reseat-closed-${++serial}`;
  const a = await connect(h, "key-a"), b = await connect(h, "key-b");
  const aId = (await a.call("join_room", { room: name, name: "a", agent: "claude", topic: "t" })).data.participant_id as string;
  await b.call("join_room", { room: name, name: "b", agent: "claude" });
  a.session.leaveAll();
  const seat = () => h.getRoom(name).participants.get(aId)!;
  const said = (re: RegExp) => h.getRoom(name).messages.filter((m) => re.test(m.content)).length;
  return { h, name, aId, seat, said };
}

test("control: in an open room the seat's next call on a new connection puts it back", async () => {
  const { h, name, aId, seat, said } = await room();
  assert.equal(seat().active, false);
  const again = await connect(h, "key-a");
  const r = await again.call("board_get", { room: name });
  assert.equal(r.error, false, r.text);
  assert.equal(seat().active, true);
  assert.equal(said(/^a rejoined the room/), 1);
  assert.equal(reseatable(h.getRoom(name), seat().seatKeyHash, aId)?.id, aId);
});

test("in a closed room it is not: the seat stays out, nothing is posted, and the refusal says the room is closed", async () => {
  const { h, name, aId, seat, said } = await room();
  h.closeRoom(name, "human", "stopped");
  const hash = seat().seatKeyHash;
  assert.ok(hash, "the seat carries its key's hash");
  assert.equal(reseatable(h.getRoom(name), hash), undefined, "no seat to take back in a closed room");
  assert.equal(reseatable(h.getRoom(name), hash, aId), undefined, "nor by its id");
  const again = await connect(h, "key-a");
  // the board of a closed room is still read by anyone (board_get asks for no seat), and reading it seats nobody
  assert.equal((await again.call("board_get", { room: name })).error, false);
  assert.equal(seat().active, false, "a read does not put the seat back");
  for (const [tool, args] of [["send_message", { room: name, content: "still here" }], ["board_set", { room: name, key: "findings/a", text: "late", participant_id: aId }], ["wait_for_messages", { room: name, timeout_ms: 0 }]] as const) {
    const r = await again.call(tool, args);
    assert.equal(r.error, true, `${tool} is refused: ${r.text.slice(0, 120)}`);
    assert.match(r.text, /is closed/, `${tool}: the refusal says why`);
    assert.doesNotMatch(r.text, /call join_room again/i, `${tool}: and does not send the seat back in`);
  }
  assert.equal(seat().active, false, "the seat is still out");
  assert.equal(said(/rejoined the room/), 0, "no rejoin line in a closed room");
  assert.equal(h.recentRefusals(h.getRoom(name), 1)[0]?.reason, "state", "recorded as a typed refusal in the room");
});

test("a concluded or stalled room still gives the seat back: the conclusion is read there", async () => {
  for (const state of ["concluded", "stalled"] as const) {
    const { h, name, aId, seat } = await room();
    h.getRoom(name).state = state;
    assert.equal(reseatable(h.getRoom(name), seat().seatKeyHash, aId)?.id, aId, state);
  }
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).message.split("\n")[0]}`);
  }
}
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nRESEAT CLOSED ROOM OK (${cases.length} cases)`);
process.exit(failed ? 1 : 0);
