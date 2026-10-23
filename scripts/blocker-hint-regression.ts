/**
 * A blocker named in chat and never filed (swarm-073112-zcd7, inputs/owner-1: "how a room notices one by itself"). In the
 * live-money room swarm-185621-lc0a a seat wrote at #235 (19:54) that the crypto maker's problem is "mostly the room's
 * laptop ... colocated-bot territory, not a laptop behind a gateway"; no needs/* followed, trading went on and the
 * owner found the need himself in another session at 20:24. A chat message that names something outside the room (the
 * machine, the network path, a region rule) in blocking words now gets one line back in the send result: if it blocks
 * work, file needs/<name> with a blocks: line. Once per seat until it files a needs/* entry; never for quiet or human
 * messages; logged as blocker_nudged. Scanned over the Polymarket room logs: lc0a 2 true of 2 hits (#235, #238) after
 * the server-timestamp exclusion (decision/needs-escalation).
 *
 * npx tsx scripts/blocker-hint-regression.ts */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { blockerTerm } from "../src/hub/needs/needs.js";
import { parseRoomLog, runMetrics } from "../src/run-metrics.js";
import { createSessionServer } from "../src/server.js";

// 1. What counts: the lc0a messages that named the blocker, and the false hits the first scan found.
const LC0A_235 = "Both, and it's mostly the room's laptop. A maker here needs feed plus cancel inside ~0.1-0.2s of the Binance event. That's colocated-bot territory, not a laptop behind a gateway.";
const LC0A_238 = "Agreed: from this laptop we are too slow to cancel before the takers arrive.";
assert.ok(blockerTerm(LC0A_235), "lc0a #235 is a blocker");
assert.ok(blockerTerm(LC0A_238), "lc0a #238 is a blocker");
assert.ok(blockerTerm("The VPN path has 5% loss at 196 ms RTT, so one TCP flow can't keep up with the book."), "mrw4-crypto #180");
for (const fp of [
  "I fixed timing.py to the server timestamp: the wallet filled 0.8 s after the book move, so ARocky33 is pure first-block speed.",
  "for the same trade, data-api block timestamp minus the CLOB print's server ts; I can't read rec/ since your restart.",
  "R9b makes fills use the server clock, so recorder backlog cannot create phantom fills.",
  "I swapped the order of the two tests; can't see why that matters.",
]) assert.equal(blockerTerm(fp), undefined, `not a blocker: ${fp.slice(0, 60)}`);

// 2. Through the tool, as a seat sees it.
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
const room = "blocker-hint";
const a = await seat("a"); const b = await seat("b");
await a("join_room", { room, name: "A", agent: "test" });
await b("join_room", { room, name: "B", agent: "test" });

let r = await a("send_message", { room, content: LC0A_235, force: true });
assert.match(r.hint ?? "", /needs\/<name>/, `the send result points at needs/: ${JSON.stringify(r)}`);
assert.match(r.hint ?? "", /laptop/, "it names the term it saw, so the seat can judge a false hit");
r = await a("send_message", { room, content: LC0A_238, force: true });
assert.doesNotMatch(r.hint ?? "", /needs\/<name>/, "once until the seat files a needs/* entry");
await a("board_set", { room, key: "needs/colocated-host", text: "a host near the exchange\nblocks: claim/crypto-maker" });
r = await a("send_message", { room, content: "And the VPN exit is in a restricted region, so we cannot trade from here at all.", force: true });
assert.match(r.hint ?? "", /needs\/<name>/, "after a filing, a new blocker is pointed out again");
r = await b("send_message", { room, content: `@A ${LC0A_238}`, quiet: true, force: true });
assert.doesNotMatch(r.hint ?? "", /needs\/<name>/, "a quiet working exchange is not nudged");

const events = parseRoomLog(readFileSync(join(dataDir, `${room}.jsonl`), "utf8"));
const nudges = events.filter((e) => e.type === "blocker_nudged");
assert.equal(nudges.length, 2);
assert.equal(nudges[0].term.toLowerCase(), "laptop");
assert.equal(runMetrics(events).needs?.nudged, 2, "run-metrics counts nudges beside filings");
console.log("blocker-hint regression OK");
process.exit(0);
