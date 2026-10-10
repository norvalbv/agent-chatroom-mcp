/** Proactivity, the request side (swarm-000525-jcz8; sources/2510.01285: a blackboard works when the side that needs work
 * posts it as a request and idle helpers self-select). In this room seats listed unbuilt ideas in chat and on remaining/*
 * entries while other seats said "nothing of mine is open" and waited: an idea had no key a seat could own, so no idle
 * wait could name it. An idea/<slug> entry nobody has claimed (claim/<slug>) is now open work for a seat with nothing of
 * its own in flight, and it holds back the idle-leave offer: a finished seat is pointed at an unbuilt idea, not the door.
 * npx tsx scripts/unclaimed-ideas-regression.ts */
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

const R = "ideas";
const a = await seat("a"), b = await seat("b"), c = await seat("c");
await ok(a.call("join_room", { room: R, name: "author", agent: "claude", expected_participants: 0 }), "join a");
await ok(b.call("join_room", { room: R, name: "free", agent: "claude" }), "join b");
await ok(c.call("join_room", { room: R, name: "busy", agent: "claude" }), "join c");
await ok(c.call("board_set", { room: R, key: "claim/parser", text: '{"area":"parser"}' }), "busy claims");
await ok(a.call("board_set", { room: R, key: "idea/grow-seats", text: "Start 3 seats and grow on hub triggers. Evidence: 12% of seat-hours polling. Build: --grow N plus a trigger table." }), "idea");

// 1. a seat with nothing of its own in flight is told the unclaimed idea, by key, with the claim call
const w1 = await b.idle(R);
assert.ok(w1.open_work?.some((x) => x.kind === "idea_unclaimed" && x.key === "idea/grow-seats"), `free seat is named the idea: ${JSON.stringify(w1)}`);
assert.match(w1.hint ?? "", /idea\/grow-seats.*claim\/grow-seats/, "the hint says how to take it");
// 2. a seat with its own claim in flight is not pulled off it
const w2 = await c.idle(R);
assert.ok(!(w2.open_work ?? []).some((x) => x.kind === "idea_unclaimed"), `busy seat is left alone: ${JSON.stringify(w2)}`);
assert.doesNotMatch(w2.hint ?? "", /idea\/grow-seats/);
// 3. once claimed, nobody is told it again
await ok(b.call("board_set", { room: R, key: "claim/grow-seats", text: '{"area":"grow-seats"}' }), "free claims the idea");
const w3 = await a.idle(R);
assert.doesNotMatch(JSON.stringify(w3), /idea\/grow-seats/, "a claimed idea is not open work");
// 4. a released claim puts the idea back
await ok(b.call("board_set", { room: R, key: "claim/grow-seats", text: "" }), "release");
const w4 = await a.idle(R);
assert.ok(JSON.stringify(w4).includes("idea/grow-seats") || /idea\/grow-seats/.test(w4.hint ?? ""), `released idea is open again for its author with nothing in flight: ${JSON.stringify(w4)}`);
// 5. an idea its author marked rejected, dropped, withdrawn or built is not offered as unbuilt work
for (const [slug, text] of [["branch-overlap", "REJECTED WITH DATA: two branches rarely touch one file."], ["old-thing", "Built: merged at abc1234."], ["gone", "withdrawn, see remaining/x"]]) {
  await ok(a.call("board_set", { room: R, key: `idea/${slug}`, text }), `idea ${slug}`);
}
const w5 = JSON.stringify(await b.idle(R));
for (const slug of ["branch-overlap", "old-thing", "gone"]) assert.ok(!w5.includes(`idea/${slug}`), `settled idea/${slug} is not offered: ${w5}`);
console.log("UNCLAIMED IDEAS OK");
process.exit(0);
