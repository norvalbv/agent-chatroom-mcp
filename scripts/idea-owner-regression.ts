/** A pitch is closed by the seat whose problem it answers (decision/scout, owner ask #288 in swarm-092526-89rn). Of 61
 * idea/* entries across 12 rooms, 45 (74%) got no claim, no attack and no verdict (evidence/scout-ideas-closure): an
 * unclaimed idea was named only to a seat holding no claim of its own, and in a room where every worker holds one it
 * reached nobody but its author. An idea that names another seat's board entry (evidence/x, decision/y) is now owed a
 * verdict by that entry's author, busy or not: claim/<slug>, attack/idea/<slug>, or a settled line on the idea. The
 * scout never closes its own pitch (sources/scout-lit: LLM self-evaluation is weak; critic diversity raises feasibility).
 * npx tsx scripts/idea-owner-regression.ts */
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
  const idle = async (room: string) => {
    for (let i = 0; i < 6; i++) {
      const w = JSON.parse((await call("wait_for_messages", { room, timeout_ms: 0 })).text);
      if (!w.messages?.length && !w.remaining) return w as { hint?: string; open_work?: { kind: string; key: string }[] };
    }
    throw new Error("wait never drained");
  };
  return { call, idle };
}
const ok = async (p: Promise<{ error: boolean; text: string }>, what: string) => { const r = await p; assert.ok(!r.error, `${what}: ${r.text}`); return r; };
const owed = (w: { open_work?: { kind: string; key: string }[] }, key: string) => (w.open_work ?? []).find((x) => x.key === key)?.kind;

const R = "pitches";
const s = await seat("s"), o = await seat("o"), x = await seat("x");
await ok(s.call("join_room", { room: R, name: "scout", agent: "claude", expected_participants: 0 }), "join scout");
await ok(o.call("join_room", { room: R, name: "owner", agent: "claude" }), "join owner");
await ok(x.call("join_room", { room: R, name: "other", agent: "claude" }), "join other");
await ok(o.call("board_set", { room: R, key: "claim/cache", text: '{"area":"cache"}' }), "owner busy");
await ok(x.call("board_set", { room: R, key: "claim/parser", text: '{"area":"parser"}' }), "other busy");
await ok(s.call("board_set", { room: R, key: "claim/scouting", text: '{"area":"scouting"}' }), "scout busy");
await ok(o.call("board_set", { room: R, key: "evidence/cache-resets", text: "7 cross-org switches cost 19% of the room." }), "evidence");
await ok(s.call("board_set", { room: R, key: "idea/defer-switch", text: "PROBLEM: evidence/cache-resets (19%). SOURCE: arXiv:2601.00001. Defer switches to between rooms." }), "pitch");

// 1. the busy owner of the cited evidence is asked for a verdict, by key
const w1 = await o.idle(R);
assert.equal(owed(w1, "idea/defer-switch"), "idea_verdict_owed", `the evidence owner owes a verdict: ${JSON.stringify(w1)}`);
assert.match(w1.hint ?? "", /idea\/defer-switch.*evidence\/cache-resets.*claim\/defer-switch.*attack\/idea\/defer-switch/, w1.hint);
// 2. a busy seat whose entries the pitch does not cite is left alone, and so is the scout (it does not judge its own pitch)
assert.equal(owed(await x.idle(R), "idea/defer-switch"), undefined, "an uncited busy seat is not pulled in");
assert.notEqual(owed(await s.idle(R), "idea/defer-switch"), "idea_verdict_owed", "the pitch's author owes no verdict on it");
// 3. an attack closes it for the owner: a reasoned rejection is an outcome
await ok(x.call("board_set", { room: R, key: "attack/idea/defer-switch", text: 'REJECT "Defer switches": the switch is forced by the usage limit.' }), "attack");
assert.equal(owed(await o.idle(R), "idea/defer-switch"), undefined, "an attacked pitch is no longer owed");
// 4. a claim closes it too, and a settled line on the idea does as well
await ok(s.call("board_set", { room: R, key: "idea/trim-schema", text: "PROBLEM: evidence/cache-resets. Trim tool schemas." }), "pitch 2");
assert.equal(owed(await o.idle(R), "idea/trim-schema"), "idea_verdict_owed");
await ok(o.call("board_set", { room: R, key: "claim/trim-schema", text: '{"area":"trim-schema"}' }), "owner adopts");
assert.equal(owed(await o.idle(R), "idea/trim-schema"), undefined, "a claimed pitch is no longer owed");
await ok(s.call("board_set", { room: R, key: "idea/third", text: "PROBLEM: evidence/cache-resets. Third." }), "pitch 3");
await ok(s.call("board_set", { room: R, key: "idea/third", text: "REJECTED: owner showed it is already done in src/x.ts." }), "settled");
assert.equal(owed(await o.idle(R), "idea/third"), undefined, "a settled pitch is no longer owed");
console.log("IDEA OWNER OK");
process.exit(0);
