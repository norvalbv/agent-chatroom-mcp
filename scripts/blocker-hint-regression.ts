/**
 * A proposal is asked whether something outside the room decides it, whatever its words (decision/blocker-detection,
 * inputs/owner-3). From 0d659f43 to bb5e6028 the hub pointed chat, openings and proposals at needs/ only when a word list
 * said they named a blocker. On held-out labels (esc-before-2, seat 2's blind bench/labels-swarm-075523-g6y5, n=20,
 * 1 yes) it flagged 1 message and that one was false, and an embedding check did no better. The seats had known their
 * blocker all along: lc0a #235 said "colocated-bot territory"; esc-before-1's final said a host "would be a needs/
 * decision" and filed none; esc-before-2's final rejected a VPS on its own model. So the chat and opening hints are gone,
 * and every proposal in a room with no open needs/* gets one question, worded so the owner decides what is worth paying
 * for. Logged as need_asked; run-metrics counts asks and the needs/* filed within 15 min of one.
 *
 * npx tsx scripts/blocker-hint-regression.ts */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { parseRoomLog, runMetrics } from "../src/run-metrics.js";
import { createSessionServer } from "../src/server.js";

Hub.DEFAULT_NUDGE_MS = 0;
const dataDir = mkdtempSync(join(tmpdir(), "blocker-hint-"));
const hub = new Hub({ dataDir });
async function seat(name: string) {
  const session = createSessionServer(hub);
  const client = new Client({ name, version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await session.server.connect(st); await client.connect(ct);
  return async (tool: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name: tool, arguments: args });
    const text = (r.content as { text: string }[])[0]?.text ?? "";
    assert.ok(!r.isError, `${name}.${tool}: ${text}`);
    return JSON.parse(text);
  };
}

// 1. Chat and openings are not judged by words any more: lc0a #235 itself gets no needs/ line back.
const room = "blocker-hint";
const a = await seat("a"); const b = await seat("b");
await a("join_room", { room, name: "A", agent: "test" });
await b("join_room", { room, name: "B", agent: "test" });
let r = await a("send_message", { room, content: "Both, and it's mostly the room's laptop. That's colocated-bot territory, not a laptop behind a gateway.", force: true });
assert.doesNotMatch(r.hint ?? "", /needs\//, `no word-list hint on chat: ${JSON.stringify(r)}`);
r = await b("submit_opening", { room, content: "No. Host is the cause: VPN default route, load 31, feed lag p99 4.6 s." });
assert.doesNotMatch(r.hint ?? "", /needs\//, `no word-list hint on an opening: ${JSON.stringify(r)}`);

// 2. A proposal is asked whatever it says, here esc-before-2's own rejection of a server, while no needs/* is open.
r = await a("propose", { room, text: "FINAL: no edge for a maker. A VPS or colocation isn't worth paying for, since the zero-latency replay still loses." });
assert.match(r.hint ?? "", /outside the room/, `the proposal is asked: ${JSON.stringify(r).slice(0, 300)}`);
assert.match(r.hint ?? "", /needs\/<name>/);
assert.match(r.hint ?? "", /owner decides/, "the owner, not the room, decides whether it is worth paying for");
await a("board_set", { room, key: "needs/london-host", text: "a host near the exchange, ~$10/mo\nblocks: claim/maker" });

// 3. With a needs/* open the room has already escalated: no question.
const room2 = "blocker-hint-filed";
const c = await seat("c");
await c("join_room", { room: room2, name: "C", agent: "test" });
await (await seat("d"))("join_room", { room: room2, name: "D", agent: "test" });
await c("board_set", { room: room2, key: "needs/budget", text: "+$20" });
r = await c("propose", { room: room2, text: "FINAL: the budget ran out; see needs/budget." });
assert.equal(r.hint, undefined, "no question once a needs/* is open");

const events = parseRoomLog(readFileSync(join(dataDir, `${room}.jsonl`), "utf8"));
assert.equal(events.filter((e) => e.type === "need_asked").length, 1, "one need_asked for the one proposal");
const metrics = runMetrics(events);
assert.equal(metrics.needs?.asked, 1);
assert.equal(metrics.needs?.askedThenFiled, 1, "needs/london-host followed the question: the conversion that shows it working");
console.log("blocker-hint regression OK");
process.exit(0);
