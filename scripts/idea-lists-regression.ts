/** Ideas listed in chat leave nothing anyone owes (swarm-000525-jcz8, verifier #358, attack/idea/unclaimed-ideas). After
 * the owner asked for ideas (#346) seats replied with about 11 enumerated items; 3 reached a board key, and only after the
 * owner pushed twice. Once an idea was on the board (idea/sourcer-seat), four seats attacked it within two minutes, and
 * the verifier's c4a02aee names an unclaimed idea/<slug> to free seats. What was missing is the step from chat to board.
 *
 * A chat message with two or more enumerated items ("(1) ... (2) ...", or numbered lines) gets one line back in the
 * send result: put each item you are not building on idea/<slug>. Once per seat until it writes an idea/* entry;
 * never for a quiet message, a single numbered reference, or a human.
 *
 * npx tsx scripts/idea-lists-regression.ts */
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
  return async (tool: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name: tool, arguments: args });
    const text = (r.content as { text: string }[])[0]?.text ?? "";
    assert.ok(!r.isError, `${name}.${tool}: ${text}`);
    try { return JSON.parse(text); } catch { return { raw: text }; }
  };
}

const room = "idea-lists";
const a = await seat("a"); const b = await seat("b"); const c = await seat("c");
await a("join_room", { room, name: "A", agent: "test" });
await b("join_room", { room, name: "B", agent: "test" });
await c("join_room", { room, name: "C", agent: "test" });

// 1. A list in chat gets the line back, once.
let r = await a("send_message", { room, content: "Three ideas: (1) cross-room pitfall memory. (2) A waiting-on graph from asks and claims. (3) Warn when two claimed branches touch the same file.", force: true });
assert.match(r.hint ?? "", /3 items/, `the send result counts the items: ${JSON.stringify(r)}`);
assert.match(r.hint ?? "", /idea\/<slug>/, "and says where they go");
r = await a("send_message", { room, content: "And two more: (1) bench A/B on hub changes. (2) research by role.", force: true });
assert.equal(r.hint, undefined, `not repeated while the seat has written no idea/* since: ${JSON.stringify(r)}`);

// 2. Not for a single numbered reference, nor a quiet working exchange.
r = await b("send_message", { room, content: "I agree with point (2) above; it matches #12.", force: true });
assert.equal(r.hint, undefined, "one enumerated marker is not a list");
r = await b("send_message", { room, content: "@C quick check: (1) did the build pass? (2) which port?", quiet: true, force: true });
assert.equal(r.hint, undefined, "a quiet working exchange is not nudged");

// 3. Numbered lines count too.
r = await b("send_message", { room, content: "Plan:\n1. write the test\n2. make it pass\n3. commit", force: true });
assert.match(r.hint ?? "", /3 items/, `line-start numbering counts: ${JSON.stringify(r)}`);

// 4. Writing an idea/* re-arms the nudge for that seat's next list, and the idea is then named to a free seat (c4a02aee).
await a("board_set", { room, key: "idea/pitfall-memory", text: "Keep a per-repo pitfalls entry built from incidents and put it in every new seat's brief." });
r = await a("send_message", { room, content: "Two more: (1) one. (2) two.", force: true });
assert.match(r.hint ?? "", /2 items/, `after writing an idea/*, the next list is nudged again: ${JSON.stringify(r)}`);

// 4b. Openings are where seats first list ideas (dev room swarm-013200-opmd-room: both seats' lists were in their
// openings, so a chat-only nudge never fired). An opening with a list gets the same pointer.
const room2 = "idea-lists-openings";
const d = await seat("d"); const e2 = await seat("e");
await d("join_room", { room: room2, name: "D", agent: "test", expected_participants: 2 });
await e2("join_room", { room: room2, name: "E", agent: "test" });
r = await d("submit_opening", { room: room2, content: "Ideas: (1) null input returns 'null'. (2) letters NFKD cannot split are dropped. (3) no separator option." });
assert.match(r.hint ?? "", /3 items/, `an opening with a list is pointed at idea/*: ${JSON.stringify(r)}`);
r = await e2("submit_opening", { room: room2, content: "Build the transliteration fix; it is the only one that loses data." });
assert.doesNotMatch(r.hint ?? "", /items/, "an opening without a list is not");

// 5. Each nudge is in the room log, so a room can be measured afterwards.
const logged = (hub.replyMetricEvents.get(room) ?? []).filter((e) => (e.type as string) === "open_work").length;
assert.equal(logged, 3, `three nudges logged in the first room: ${logged}`);

console.log("idea-lists-regression: OK");
process.exit(0);
