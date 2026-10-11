/** Proactivity (swarm-000525-jcz8, evidence/proactivity): a seat whose wait returns nothing and that owes nothing was
 * told "No new messages yet. Call wait_for_messages again." even while the hub held work for it. Across 90 past rooms
 * that line fronted 54 of 460 seat-hours of pure polling, 86% of the long runs before any proposal was open
 * (scripts/measure/idle-waits*.py).
 *
 * The idle wait now names the open work the hub can already see for that seat: a review it was assigned and has not
 * written, its own claim with nothing behind it, a departed owner's claim it may take over, an open help/* entry.
 * A seat with nothing open keeps the old line, and anything owed (an ask, a vote) still comes first.
 *
 * npx tsx scripts/idle-open-work-regression.ts */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";

Hub.DEFAULT_NUDGE_MS = 0;
Hub.STALE_CLAIM_MS = 0;
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
  /** Drain whatever is queued, then return the next (empty) wait: the one an idle seat keeps getting. */
  const idle = async (room: string) => {
    for (let i = 0; i < 5; i++) {
      const w = JSON.parse((await call("wait_for_messages", { room, timeout_ms: 0 })).text);
      if (!w.messages?.length && !w.remaining) return w as { hint?: string; open_work?: { kind: string; key: string }[] };
    }
    throw new Error("wait never drained");
  };
  return { call, idle };
}
const ok = async (p: Promise<{ error: boolean; text: string }>, what: string) => { const r = await p; assert.ok(!r.error, `${what}: ${r.text}`); return r; };
const OLD = "No new messages yet. Call wait_for_messages again.";

const room = "idle-open-work";
const a = await seat("a"); const b = await seat("b"); const c = await seat("c");
await ok(a.call("join_room", { room, name: "A", agent: "test" }), "A joins");
await ok(b.call("join_room", { room, name: "B", agent: "test" }), "B joins");
await ok(c.call("join_room", { room, name: "C", agent: "test" }), "C joins");

// 0. Nothing on the board: nothing to name, the old line stays.
let w = await b.idle(room);
assert.equal(w.hint, OLD, "an idle seat with no open work keeps the plain line");
assert.equal(w.open_work, undefined, "no open_work field when there is none");

// 1. A claims an area and writes nothing else: A's own idle wait says the claim has nothing behind it.
await ok(a.call("board_set", { room, key: "claim/parser", text: '{"owner":"A","area":"parser"}' }), "A claims");
// Not on the first idle wait, and not while A is heartbeating local tool calls (a builder peeking between steps).
assert.equal((await a.idle(room)).hint, OLD, "one empty wait is not idleness");
await new Promise((r) => setTimeout(r, 5));
hub.heartbeat(room, [...hub.getRoom(room).participants.values()].find((x) => x.name === "A")!.id, { tool: "Bash", detail: "npm test" });
assert.equal((await a.idle(room)).hint, OLD, "a seat running local tools between waits is not told its claim is empty");
await new Promise((r) => setTimeout(r, 5));
w = await a.idle(room);
assert.match(w.hint ?? "", /claim\/parser/, `A, idle twice running, is told its claim has nothing on the board yet: ${w.hint}`);
assert.deepEqual(w.open_work?.map((x) => x.kind), ["own_claim_empty"]);

// The hub picked a reviewer for claim/parser. Until A posts work there is nothing to review.
const entry = hub.getRoom(room).board.get("claim/parser")!;
const reviewer = entry.reviewer === "B" ? b : c;
const other = entry.reviewer === "B" ? c : b;
w = await reviewer.idle(room);
assert.equal(w.hint, OLD, "a reviewer is not sent to review a claim with no work behind it");

// 2. A posts findings: A's claim is no longer empty, and the assigned reviewer's idle wait names the review.
await ok(a.call("board_set", { room, key: "evidence/parser", text: "Parser drops the last token on CRLF input; fix on branch a/parser @ abc1234." }), "A posts evidence");
w = await a.idle(room);
assert.equal(w.hint, OLD, "A has work on the board and nothing else open");
w = await reviewer.idle(room);
assert.match(w.hint ?? "", /claim\/parser/, `the reviewer's idle wait names the claim: ${w.hint}`);
assert.match(w.hint ?? "", /\bA\b/, "and its owner");
assert.match(w.hint ?? "", /verify\/parser/, "and the entry to write");
assert.deepEqual(w.open_work, [{ kind: "review_owed", key: "claim/parser", owner: "A" }]);
// An unchanged list is not resent: the next idle waits carry one short line and no open_work, however many follow.
const full = w.hint!.length;
for (let i = 0; i < 3; i++) {
  w = await reviewer.idle(room);
  assert.match(w.hint ?? "", /still open \(first: claim\/parser\)/, `an unchanged list is a short reminder: ${w.hint}`);
  assert.equal(w.open_work, undefined, "and the list itself is not resent");
  assert.ok(w.hint!.length < full / 2, "at under half the length");
}
assert.equal((await other.idle(room)).hint, OLD, "the seat that was not assigned the review is not sent to it");
// A verifier seat is shown unreviewed work whoever was assigned it.
const v = await seat("v");
await ok(v.call("join_room", { room, name: "V", agent: "test", role: "verifier" }), "V joins");
w = await v.idle(room);
assert.deepEqual(w.open_work, [{ kind: "unreviewed", key: "claim/parser", owner: "A" }], `verifier sees unreviewed work: ${JSON.stringify(w.open_work)}`);

// 3. Anything owed still comes first: an ask outranks open work.
await ok(a.call("send_message", { room, content: `@${entry.reviewer} which input did you try?`, force: true }), "A asks the reviewer");
w = JSON.parse((await reviewer.call("wait_for_messages", { room, timeout_ms: 0 })).text);
assert.match(w.hint ?? "", /addressed you directly/, "the ask leads");
assert.doesNotMatch(w.hint ?? "", /Open work/, "open work does not ride on an owed ask");
await ok(reviewer.call("pass", { room }), "reviewer declines the ask");

// 4. The reviewer writes its verify entry: the review is no longer open.
await ok(reviewer.call("board_set", { room, key: "verify/parser", text: "Ran the CRLF case at abc1234: passes; fails at the parent." }), "reviewer verifies");
w = await reviewer.idle(room);
assert.equal(w.hint, OLD, `a written review is not listed again: ${w.hint}`);
assert.equal((await v.idle(room)).hint, OLD, "nor shown to the verifier once someone has reviewed it");

// 4b. A review that lives in chat or under review/* counts too: seats put reviews in all three places, and asking
// for one that is already there is noise. C claims, B or the hub's pick reviews it in chat only.
await ok(other.call("board_set", { room, key: "claim/lexer", text: '{"owner":"lexer seat","area":"lexer"}' }), "second claim");
await ok(other.call("board_set", { room, key: "evidence/lexer", text: "Tokenizer handles tabs; branch c/lex @ def5678." }), "second evidence");
const lexRev = hub.getRoom(room).board.get("claim/lexer")!.reviewer!;
const lexSeat = { A: a, B: b, C: c, V: v }[lexRev]!;
w = await lexSeat.idle(room);
assert.ok(w.open_work?.some((x) => x.kind === "review_owed" && x.key === "claim/lexer"), `lexer review is owed by ${lexRev}: ${JSON.stringify(w.open_work)}`);
await ok(lexSeat.call("send_message", { room, content: "Reviewed the lexer piece: reran its tests and fed it tabs myself, holds.", force: true }), "review in chat");
w = await lexSeat.idle(room);
assert.ok(!w.open_work?.some((x) => x.key === "claim/lexer") && !/claim\/lexer/.test(w.hint ?? ""), `a review posted in chat is not asked for again: ${w.hint}`);

// 4c. Precision, from replaying 116 past long idle runs (scripts/measure/open-work-replay.py): about half of what the
// first rules named was finished work. A review by a seat other than the assigned reviewer settles the review, and a
// claim whose own status says it is finished is not open for anyone.
await ok(other.call("board_set", { room, key: "claim/printer", text: '{"owner":"printer seat","area":"printer","status":"in progress"}' }), "third claim");
await ok(other.call("board_set", { room, key: "evidence/printer", text: "Pretty-printer keeps comments; branch c/print @ 0a1b2c3." }), "third evidence");
const prRev = hub.getRoom(room).board.get("claim/printer")!.reviewer!;
const seats = { A: a, B: b, C: c, V: v } as Record<string, typeof a>;
const prSeat = seats[prRev]!;
const bystander = Object.entries(seats).find(([n, s]) => n !== prRev && s !== other)![1];
w = await prSeat.idle(room);
assert.ok(w.open_work?.some((x) => x.kind === "review_owed" && x.key === "claim/printer"), `printer review owed by ${prRev}: ${JSON.stringify(w.open_work)}`);
await ok(bystander.call("board_set", { room, key: "verify/printer", text: "Ran the printer on three files with comments at 0a1b2c3: output identical." }), "a non-assigned seat reviews it");
w = await prSeat.idle(room);
assert.ok(!w.open_work?.some((x) => x.key === "claim/printer") && !/claim\/printer/.test(w.hint ?? ""), `a review by another seat settles it for the assigned reviewer: ${w.hint}`);
await ok(other.call("board_set", { room, key: "claim/emitter", text: '{"owner":"emitter seat","area":"emitter","status":"merged by verifier as 989ce35"}' }), "a finished claim");
for (const [n, s] of Object.entries(seats)) {
  w = await s.idle(room);
  assert.ok(!w.open_work?.some((x) => x.key === "claim/emitter") && !/claim\/emitter/.test(w.hint ?? ""), `a claim marked merged is named to nobody (${n}): ${w.hint}`);
}

// 5. An open help/* entry is named to everyone but its author.
await ok(other.call("board_set", { room, key: "help/fixtures", text: "Need a second seat to build CRLF fixtures for the parser tests." }), "help posted");
w = await reviewer.idle(room);
assert.deepEqual(w.open_work?.map((x) => `${x.kind}:${x.key}`), ["help_wanted:help/fixtures"]);
assert.match(w.hint ?? "", /help\/fixtures/);
assert.equal((await other.idle(room)).hint, OLD, "the author of a help entry is not sent to its own request");
await ok(other.call("board_set", { room, key: "help/fixtures", text: "" }), "help cleared");

// 6. A leaves holding its claim: once the stale window has passed, an idle seat is told it may take the claim over.
await a.call("leave_room", { room, reason: "context limit; parser fix is on a/parser, tests undone" });
await a.call("leave_room", { room, reason: "context limit; parser fix is on a/parser, tests undone" });
assert.equal([...hub.getRoom(room).participants.values()].find((x) => x.name === "A")!.active, false, "A left");
w = await other.idle(room);
assert.deepEqual(w.open_work?.map((x) => `${x.kind}:${x.key}`), ["claim_orphaned:claim/parser"], `orphaned claim named: ${JSON.stringify(w)}`);
assert.match(w.hint ?? "", /claim\/parser/);
assert.match(w.hint ?? "", /left/);

// 7. The list is capped at three items, and says how many more there are.
for (const k of ["one", "two", "three", "four"]) await ok(reviewer.call("board_set", { room, key: `help/${k}`, text: `need a hand with ${k}` }), `help/${k}`);
w = await other.idle(room);
assert.equal(w.open_work?.length, 5, "the structured list is complete");
assert.equal((w.hint!.match(/\(\d\)/g) ?? []).length, 3, `the hint carries three items: ${w.hint}`);
assert.match(w.hint!, /2 more/, "and counts the rest");

// 8. Each change in what a seat was shown is written to the room log once, so a room can be measured afterwards.
const logged = (hub.replyMetricEvents.get(room) ?? []).filter((e) => (e.type as string) === "open_work").length;
assert.ok(logged >= 5 && logged <= 8, `open_work is logged on change, not on every wait: ${logged}`);

// 9. A departed owner whose area is finished is not offered as a takeover: it wrote result/<area> and no handoff/<area>.
// In swarm-003601-tky5 the usage limit stopped three seats whose work was all merged, and every idle wait then named
// up to twelve "left holding claim/...: you may take it over now" items that were not work (friction/orphaned-finished-claims).
const d = await seat("D");
await ok(d.call("join_room", { room, name: "D" }), "D joins");
await ok(d.call("board_set", { room, key: "claim/linker", text: '{"owner":"D","area":"linker"}' }), "D claims");
await ok(d.call("board_set", { room, key: "result/linker", text: "Linker built on d/linker at 1234abc; test linker-regression fails at parent, passes at head." }), "D posts its result");
await ok(d.call("board_set", { room, key: "claim/archiver", text: '{"owner":"D","area":"archiver"}' }), "D claims a second area");
await ok(d.call("board_set", { room, key: "result/packing", text: "RESULT for claim/archiver: packing built at 5678def." }), "D's result for it has another name but names the claim");
const e2 = await seat("E");
await ok(e2.call("join_room", { room, name: "E" }), "E joins");
await ok(e2.call("board_set", { room, key: "claim/loader", text: '{"owner":"E","area":"loader"}' }), "E claims");
await ok(e2.call("board_set", { room, key: "result/loader", text: "Loader half done on e/loader." }), "E posts a result");
await ok(e2.call("board_set", { room, key: "handoff/loader", text: "Undone: the Windows path case; branch e/loader." }), "E writes a handoff");
for (const s of [d, e2]) for (let i = 0; i < 2; i++) await s.call("leave_room", { room, reason: "stopped by the account's usage limit; my result is on the board" });
w = await other.idle(room);
const offered = (w.open_work ?? []).filter((x) => x.kind === "claim_orphaned").map((x) => x.key);
assert.ok(!offered.includes("claim/linker"), `a finished area (result, no handoff) is not offered as a takeover: ${JSON.stringify(offered)}`);
assert.ok(!offered.includes("claim/archiver"), `a result that names the claim counts too: ${JSON.stringify(offered)}`);
assert.ok(offered.includes("claim/loader"), `an area with a handoff is still offered, so a successor reads it: ${JSON.stringify(offered)}`);
assert.ok(offered.includes("claim/parser"), "and a claim with nothing behind it still is");

console.log("idle-open-work-regression: OK");
process.exit(0);
