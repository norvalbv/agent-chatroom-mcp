/**
 * A sealed draft round is opened knowingly, and can be taken back (evidence-pack item 13, chat-and-friction 14;
 * claim/sealed-draft-misfire). Any draft/* write opens a room-wide sealed round (settled axis
 * settle-disputes-by-spec-not-count, which stands). In 8 rooms since 2026-10-10 that opened one, 3 revealed at the
 * 10-minute deadline with exactly ONE drafter (5y46 draft/final, 22gz draft/decision, fnko draft/decision): a working
 * draft of the room's answer sat hidden from every other seat for 10 minutes, and the seat that wrote it was told only
 * "wrote a sealed draft". board_set's own text invited it ("a working draft"; key example 'draft'). Now the seat whose
 * write opens a round is told its entry is hidden, from whom and until when, and where a working draft goes; clearing
 * the only draft cancels the round; the room is told what a round asks of the others; the reveal is logged with how
 * many had drafted. Red on main: the reply has no `sealed`, clearing does not cancel, the events carry no counts.
 * Run: npx tsx scripts/sealed-draft-misfire-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";

Hub.DEFAULT_NUDGE_MS = 0;
const dataDir = mkdtempSync(join(tmpdir(), "sealed-draft-misfire-"));
const hub = new Hub({ dataDir });
async function seat(name: string) {
  const session = createSessionServer(hub);
  const client = new Client({ name, version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await session.server.connect(st); await client.connect(ct);
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name: tool, arguments: args });
    return { error: !!r.isError, text: (r.content as { text: string }[])[0]?.text ?? "" };
  };
  return { call, client };
}
const events = (room: string) => readFileSync(join(dataDir, `${room}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- 1. The seat that opens a round is told what it did ----------
const room = "sdm-room";
const a = await seat("a"); const b = await seat("b"); const c = await seat("c");
for (const [s, n] of [[a, "A"], [b, "B"], [c, "C"]] as const) await s.call("join_room", { room, name: n, agent: "test" });
let r = await a.call("board_set", { room, key: "draft/decision", text: "DECISION (working draft): remove the gate; keep the flag one release." });
assert.ok(!r.error, r.text);
const reply = JSON.parse(r.text) as { sealed?: { opened_round: boolean; hidden_from: string[]; until: string }; hint?: string };
assert.ok(reply.sealed, "the writer's reply says the entry is sealed");
assert.equal(reply.sealed!.opened_round, true, "and that this write opened the round");
assert.deepEqual([...reply.sealed!.hidden_from].sort(), ["B", "C"], "and who cannot read it");
assert.ok(Date.parse(reply.sealed!.until) > Date.now(), "and until when");
assert.match(reply.hint ?? "", /working draft/, "the hint says a working draft belongs elsewhere");
assert.match(reply.hint ?? "", /wip\//, "and names a key that is not sealed");
assert.match(reply.hint ?? "", /clear/i, "and that clearing it takes the round back");
const seen = (await b.call("read_messages", { room, since_seq: 0 })).text;
assert.match(seen, /opened a sealed draft round/, "the room is told a round opened");
assert.match(seen, /own attempt/, "and what it asks of the others");
assert.ok(!seen.includes("remove the gate"), "without the draft's text");
assert.ok(!seen.includes("draft/decision"), "or its key");

// ---------- 2. Clearing the only draft cancels the round ----------
r = await a.call("board_set", { room, key: "draft/decision", text: "" });
assert.ok(!r.error, r.text);
assert.equal(hub.getRoom(room).draftsOpenedAt, undefined, "no round is running");
assert.match((await b.call("read_messages", { room, since_seq: 0 })).text, /sealed draft round .*cancelled/, "the room is told it was cancelled");
r = await a.call("board_set", { room, key: "wip/decision", text: "DECISION (working draft): remove the gate; keep the flag one release." });
assert.ok(!r.error && !JSON.parse(r.text).sealed, "a wip/ entry is not sealed");
assert.match((await b.call("board_get", { room, key: "wip/decision" })).text, /remove the gate/, "and B reads it at once");
// a later draft opens a fresh round with its own deadline
r = await b.call("board_set", { room, key: "draft/B", text: "B's independent attempt" });
assert.equal(JSON.parse(r.text).sealed.opened_round, true, "a new round can open after a cancelled one");
r = await c.call("board_set", { room, key: "draft/C", text: "C's independent attempt" });
assert.equal(JSON.parse(r.text).sealed.opened_round, false, "the second drafter joins the round, it does not open one");
assert.ok(events(room).some((e) => e.type === "drafts_cancelled"), "the cancellation is logged");

// ---------- 3. A reveal says how it ended and how many had drafted ----------
Hub.DRAFT_REVEAL_MS = 250;
const room2 = "sdm-deadline";
const d = await seat("d"); const e = await seat("e"); const f = await seat("f");
for (const [s, n] of [[d, "D"], [e, "E"], [f, "F"]] as const) await s.call("join_room", { room: room2, name: n, agent: "test" });
await d.call("board_set", { room: room2, key: "draft/final", text: "the room's answer, meant for everyone" });
await sleep(450);
const rev = events(room2).find((x) => x.type === "drafts_revealed");
assert.ok(rev, "the reveal is logged");
assert.equal(rev.by, "deadline");
assert.equal(rev.drafted, 1, "one seat had drafted: the shape of a misfire");
assert.equal(rev.drafters, 3);
assert.ok(rev.seconds >= 0.2);

// ---------- 4. The tool text stops inviting it ----------
const tool = (await a.client.listTools()).tools.find((t) => t.name === "board_set")!;
const keyDesc = (tool.inputSchema.properties as Record<string, { description?: string }>).key.description ?? "";
assert.ok(!/e\.g\. 'evidence', 'open questions', 'draft'/.test(keyDesc), "'draft' is no longer offered as an ordinary key");
assert.match(keyDesc, /draft\/<[^>]+> \(/, "draft/ is listed with the reserved prefixes");
assert.match(keyDesc, /wip\//, "and a working draft has a named home");
console.log("sealed-draft-misfire-regression OK");
process.exit(0);
