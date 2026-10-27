/**
 * The outside-limit question is asked when a room narrows, not only when it concludes (decision/bar-check-at-start,
 * evidence/why-no). swarm-210319-js47's done-when (~100 fills a round from our wallet) could not be met under the run's
 * own limits: the lane's 25-30 placements a minute a seat, $40-60 a round, ~340 rounds to show break-even against
 * ~40-120 in the night. All of it was on the board at minute 0. The hub asked "does anything outside the room decide
 * this?" only at proposal time (proposalNeedHint), and the limits came out late: volume's needs/placement-rate at minute
 * 277 (the owner said yes 5 min later, inputs/owner-12), needs/birth-batch-lane and needs/maker-rebate-tier at 387.5,
 * within 0.1 min of that proposal-time ask (evidence/need-timing-replay). So the same question, worded for the start,
 * goes once per room to whoever writes its first claim/*, as an owed ask; "unknown, will check" is a fine answer
 * (attack by 6-astra-4: a first claim can come before the resources are read). Logged as need_asked {where:"first-claim"};
 * run-metrics counts these asks and the needs/* filed within 15 min of one apart from the proposal-time asks.
 *
 * npx tsx scripts/start-limit-ask-regression.ts */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { parseDecisionRecord } from "../src/launch/decision-record.js";
import { parseRoomLog, runMetrics } from "../src/run-metrics.js";
import { createSessionServer } from "../src/server.js";

Hub.DEFAULT_NUDGE_MS = 0;
const dataDir = mkdtempSync(join(tmpdir(), "start-limit-ask-"));
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
    try { return JSON.parse(text); } catch { return text; } // leave_room answers in prose
  };
}
const asks = (room: string) => hub.getRoom(room).messages.filter((m) => m.tag === "limits");

// 1. A human's claim is not asked: the question is for the agents doing the work.
const room = "start-limit-ask";
const a = await seat("a"); const b = await seat("b"); const h = await seat("h");
await a("join_room", { room, name: "A", agent: "test" });
await b("join_room", { room, name: "B", agent: "test" });
await h("join_room", { room, name: "Benji", agent: "human" });
await h("board_set", { room, key: "claim/owner-notes", text: JSON.stringify({ area: "owner-notes", owner: "Benji" }) });
assert.equal(asks(room).length, 0, "a human's claim gets no ask");

// 2. The first agent claim is asked once, as an owed ask to its author, worded for the start and open to "unknown".
await a("board_set", { room, key: "claim/volume-runner", text: JSON.stringify({ area: "volume-runner", owner: "A", note: "copy the busiest wallet's order flow live" }) });
let got = asks(room);
assert.equal(got.length, 1, `one ask at the first agent claim: ${JSON.stringify(hub.getRoom(room).messages.slice(-3).map((m) => m.content))}`);
const ask = got[0]!;
assert.equal(ask.kind, "chat", "chat kind, so a held wait wakes on the @-mention");
assert.match(ask.content, /^@A /, "addressed to the claimer");
assert.match(ask.content, /claim\/volume-runner/, "names the claim that narrowed the room");
assert.match(ask.content, /limits it was given/, "asks whether the target fits the room's own limits");
assert.match(ask.content, /best (?:known )?example/i, "asks whether the best known example reaches it");
assert.match(ask.content, /needs\/<limit>/, "points at needs/*");
assert.match(ask.content, /owner decides/, "the owner, not the room, decides what is worth changing");
assert.match(ask.content, /[Uu]nknown is a fine answer/, "does not reward an invented blocker");
const rA = hub.getRoom(room); const pA = [...rA.participants.values()].find((q) => q.name === "A")!;
assert.equal(hub.attentionFocus(rA, pA)?.id, ask.id, "before it is delivered, the start ask leads A's queue");
let w = await a("wait_for_messages", { room, timeout_ms: 0 });
assert.ok((w.messages ?? []).some((x: string) => x.includes("@A before this room narrows") && x.includes("Reply to this message")), `the ask reaches A, addressed: ${JSON.stringify(w.messages)}`);

// 2b. Delivered once, it retires like a hub notice: kept owed, it came back on every wait, so an idle seat's waits never
// drained and it took the focus from the idle leave offer (audit/f65acfac: idle-open-work, unclaimed-ideas, idea-owner,
// idle-leave). A's next waits drain, and a later peer ask is A's focus.
for (let i = 0; i < 2; i++) {
  w = await a("wait_for_messages", { room, timeout_ms: 0 });
  assert.ok(!w.messages?.length && !w.remaining, `A's wait drains after the ask was delivered: ${JSON.stringify(w.messages)}`);
}
assert.equal(hub.attentionFocus(rA, pA), undefined, "nothing pinned once delivered");
const peer = await b("send_message", { room, content: "@A which wallet are you copying?", force: true });
assert.equal(hub.attentionFocus(rA, pA)?.id, peer.id, "a later peer ask is A's focus");
await a("send_message", { room, reply_to: peer.id, content: "the busiest one", force: true });
assert.equal(hub.attentionFocus(rA, pA), undefined, "and once answered nothing is owed");

// 3. Later claims, by anyone, are not asked again.
await b("board_set", { room, key: "claim/beat-runner", text: JSON.stringify({ area: "beat-runner", owner: "B" }) });
await a("board_set", { room, key: "claim/engine", text: JSON.stringify({ area: "engine", owner: "A" }) });
assert.equal(asks(room).length, 1, "asked once per room");

// 4. The claimer answers by filing the limit; the proposal-time ask is unchanged and logged apart.
await a("send_message", { room, force: true, reply_to: ask.id, content: "25/min a seat at 5-sh clips caps one seat near 45 fills: filed needs/placement-rate." });
await a("board_set", { room, key: "needs/placement-rate", text: "raise the lane's 25/min cap to 50/min\nblocks: claim/volume-runner" });
const final = { room, text: "FINAL: NOT MET under the 25/min cap; the busiest wallet runs 62 fills a round." };
// the first propose is refused once for B's claim without findings (CLAIMS WITHOUT FINDINGS); the second goes ahead
const r = await a("propose", final).catch(() => a("propose", final));
assert.match(r.hint ?? "", /outside the room/, "the proposal is still asked");

const events = parseRoomLog(readFileSync(join(dataDir, `${room}.jsonl`), "utf8"));
const asked = events.filter((e) => e.type === "need_asked");
assert.deepEqual(asked.map((e) => e.where), ["first-claim", "proposal"], `one start ask then one proposal ask: ${JSON.stringify(asked)}`);
assert.equal(asked[0]!.key, "claim/volume-runner");
assert.equal(typeof asked[0]!.minutes_since_open, "number");
const m = runMetrics(events);
assert.equal(m.needs?.asked, 2);
assert.equal(m.needs?.askedAtStart, 1, "the start ask is counted apart");
assert.equal(m.needs?.askedAtStartThenFiled, 1, "needs/placement-rate followed the start ask: the conversion that shows it working");
assert.equal(m.needs?.askedAtStartAnswered, 1, "A replied to it");
assert.equal(m.needs?.asksOfOwners, 0, "not counted as a blocked-claim owner's ask (tag limits, not need)");

// 5. A restarted hub does not ask again, even after every agent claim was cleared (review by 6-1-sol-5): the room's own
// messages carry the ask, not a module-level set.
for (const k of ["claim/volume-runner", "claim/engine"]) await a("board_set", { room, key: k, text: "" });
await b("board_set", { room, key: "claim/beat-runner", text: "" });
const hub2 = new Hub({ dataDir });
const s2 = createSessionServer(hub2);
const c2 = new Client({ name: "a2", version: "1" });
const [ct2, st2] = InMemoryTransport.createLinkedPair();
await s2.server.connect(st2); await c2.connect(ct2);
const call2 = async (tool: string, args: Record<string, unknown>) => JSON.parse(((await c2.callTool({ name: tool, arguments: args })).content as { text: string }[])[0]!.text);
await call2("join_room", { room, name: "C", agent: "test" });
await call2("board_set", { room, key: "claim/queue", text: JSON.stringify({ area: "queue", owner: "C" }) });
assert.equal(hub2.getRoom(room).messages.filter((x) => x.tag === "limits").length, 1, "no second start ask after a restart");

// 6. The verifier's not-met final names what stopped it and the yes-if line right after "NOT VERIFIED:", which stays the
// first token, and the launcher still files its record (verifier #127).
const prompt = readFileSync(new URL("../prompts/verifier.md", import.meta.url), "utf8");
assert.match(prompt, /"NOT VERIFIED: <what stopped it: which limit, too few rounds, failed, or untested>/, "the verifier leads a not-met with its cause");
assert.match(prompt, /yes-if: <the best existing example and what must change>/, "and with what would make it pass");
const rec = parseDecisionRecord("NOT VERIFIED: stopped by a limit the room was given, the lane's 25/min a seat; yes-if: 1000monkeys runs 62 fills a round at +0.79c, front of queue.\n\nDECISION RECORD\n\nTarget 1: x\nSlug: start-limit-ask\n- Context: y\n");
assert.deepEqual(rec?.targets.map((t) => t.slug), ["start-limit-ask"], "a not-met final with its cause still parses");

// 7. A second hub with its own data dir and a room of the same name gets its own ask: nothing leaks across hubs.
const hub3 = new Hub({ dataDir: mkdtempSync(join(tmpdir(), "start-limit-ask-3-")) });
const s3 = createSessionServer(hub3);
const c3 = new Client({ name: "a3", version: "1" });
const [ct3, st3] = InMemoryTransport.createLinkedPair();
await s3.server.connect(st3); await c3.connect(ct3);
const call3 = async (tool: string, args: Record<string, unknown>) => JSON.parse(((await c3.callTool({ name: tool, arguments: args })).content as { text: string }[])[0]!.text);
await call3("join_room", { room, name: "D", agent: "test" });
await call3("board_set", { room, key: "claim/other", text: JSON.stringify({ area: "other", owner: "D" }) });
assert.equal(hub3.getRoom(room).messages.filter((x) => x.tag === "limits").length, 1, "the same room name on another hub is asked on its own");

// 8. An ask the seat never read does not hold its leave (audit/a87996d3, handoff-regression C): a seat that claims, hands
// off and leaves without reading leaves at the first call.
const e = await seat("e");
await e("join_room", { room: "start-limit-leave", name: "E", agent: "test" });
await e("board_set", { room: "start-limit-leave", key: "claim/long-brief", text: JSON.stringify({ area: "long-brief", owner: "E" }) });
assert.equal(hub.getRoom("start-limit-leave").messages.filter((x) => x.tag === "limits").length, 1, "E's first claim was asked");
await e("board_set", { room: "start-limit-leave", key: "handoff/long-brief", text: "done: nothing; where: here; undone: all" });
const left = await e("leave_room", { room: "start-limit-leave", reason: "context full; see handoff/long-brief" });
assert.ok(!/Before you leave/.test(JSON.stringify(left)), `the unread limits ask does not refuse the leave: ${JSON.stringify(left).slice(0, 300)}`);
assert.equal([...hub.getRoom("start-limit-leave").participants.values()].find((q) => q.name === "E")?.active, false, "E has left");

console.log("start-limit-ask regression OK");
process.exit(0);
