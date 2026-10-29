/** Exact body handoffs, rather than cursor movement, are receipt evidence. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";
import { steerAckAs, steerPeek } from "../src/hub/steer.js";
import { deliveryCoverage } from "../src/measurements/delivery-receipts.js";

const roots: string[] = [];
let serial = 0;
async function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "delivery-receipts-")); roots.push(dataDir);
  const h = new Hub({ dataDir }), room = `receipt-${++serial}`;
  const sessions = [createSessionServer(h), createSessionServer(h), createSessionServer(h)];
  const call = async (seat: number, tool: string, args: Record<string, unknown> = {}) => {
    const result = await (sessions[seat]!.server as any)._registeredTools[tool].handler({ room, ...args }, {});
    const text = result.content[0].text;
    let data: any; try { data = JSON.parse(text); } catch { data = text; }
    return { result, data, text };
  };
  const a = (await call(0, "join_room", { name: "alice", agent: "test" })).data.participant_id;
  const b = (await call(1, "join_room", { name: "bob", agent: "test" })).data.participant_id;
  const c = (await call(2, "join_room", { name: "carol", agent: "test" })).data.participant_id;
  const events = () => readFileSync(join(dataDir, `${room}.jsonl`), "utf8").trim().split("\n").map(x => JSON.parse(x));
  const receipts = (pid = b, via?: string) => events().filter(e => e.type === "delivery_receipt" && e.participant === pid && (!via || e.via === via));
  await call(1, "wait_for_messages", { timeout_ms: 0 });
  return { h, room, call, a, b, c, events, receipts };
}
const seqs = (receipts: any[]) => receipts.flatMap(e => e.seq_ranges.flatMap(([a, b]: number[]) => Array.from({ length: b! - a! + 1 }, (_, i) => a! + i)));
const lines = (data: any) => (Array.isArray(data) ? data : data.messages ?? []).map((x: string) => Number(/^#(\d+)/.exec(x)?.[1])).filter(Number.isFinite);
const cases: [string, () => Promise<void>][] = [];
const test = (name: string, run: () => Promise<void>) => cases.push([name, run]);

test("wait records exact final bodies, route, timestamp and actor", async () => {
  const f = await fixture();
  await f.call(0, "send_message", { content: "a public checkable message", force: true });
  const before = f.receipts().length;
  const w = await f.call(1, "wait_for_messages", { timeout_ms: 0 });
  const added = f.receipts().slice(before);
  assert.ok(added.length, "a wait body needs a delivery_receipt");
  assert.deepEqual(seqs(added), lines(w.data).sort((a: number, b: number) => a - b));
  assert.equal(added[0].via, "wait"); assert.equal(added[0].boundary, "hub_handoff");
  assert.equal(added[0].seat, "bob"); assert.ok(Number.isFinite(Date.parse(added[0].ts)));
});
test("quiet bystander stubs do not receipt the body, explicit reads do", async () => {
  const f = await fixture();
  const sent = await f.call(0, "send_message", { content: "@carol private work question", quiet: true, force: true });
  await f.call(1, "wait_for_messages", { timeout_ms: 0 });
  assert.ok(!seqs(f.receipts()).includes(sent.data.seq));
  const r = await f.call(1, "read_messages", { since_seq: 0, limit: 500 });
  assert.match(r.text, /private work question/);
  assert.ok(seqs(f.receipts(f.b, "read")).includes(sent.data.seq), "explicit quiet-log read is a body receipt");
});
test("steer peeks are not receipts, ack is, wait stubs are not", async () => {
  const f = await fixture();
  const sent = await f.call(0, "send_message", { content: "@bob check boundary", force: true });
  const before = f.receipts().length;
  assert.ok(steerPeek(f.h, f.room, f.b).some(m => m.id === sent.data.id));
  assert.equal(f.receipts().length, before);
  assert.equal(steerAckAs(f.h, f.room, f.b, [sent.data.id]), 1);
  assert.ok(seqs(f.receipts(f.b, "steer")).includes(sent.data.seq), "ack records the exact body");
  assert.equal(f.receipts(f.b, "steer").at(-1).boundary, "consumer_ack");
  const w = await f.call(1, "wait_for_messages", { timeout_ms: 0 });
  assert.match(w.text, /shown to you mid-turn/);
  assert.ok(!seqs(f.receipts(f.b, "wait")).includes(sent.data.seq), "stub is not another body handoff");
});
test("universal carry receipts exact asks without consuming earlier chatter", async () => {
  const f = await fixture();
  const plain = await f.call(0, "send_message", { content: "unaddressed chatter", force: true });
  const ask = await f.call(0, "send_message", { content: "@bob progress?", force: true });
  await f.call(1, "board_get", {});
  assert.ok(seqs(f.receipts(f.b, "carry")).includes(ask.data.seq));
  assert.ok(!seqs(f.receipts(f.b, "carry")).includes(plain.data.seq));
});
test("both unread and reply-owed refusals receipt their actual payload", async () => {
  const f = await fixture();
  const ask = await f.call(0, "send_message", { content: "@bob please answer", force: true });
  const unread = await f.call(1, "send_message", { content: "unrelated response" });
  assert.ok(unread.result.isError); assert.match(unread.text, /arrived while/);
  assert.ok(seqs(f.receipts(f.b, "refusal")).includes(ask.data.seq));
  const before = f.receipts(f.b, "refusal").length;
  const owed = await f.call(1, "send_message", { content: "another unrelated response" });
  assert.ok(owed.result.isError); assert.match(owed.text, /still owe/);
  assert.ok(seqs(f.receipts(f.b, "refusal").slice(before)).includes(ask.data.seq));
});
test("forced send and pass cursor movement are not message receipts", async () => {
  const f = await fixture();
  await f.call(0, "send_message", { content: "unseen body", force: true });
  const before = f.receipts().length;
  await f.call(1, "send_message", { content: "forced sender cursor jump", force: true });
  await f.call(1, "pass");
  assert.equal(f.receipts().length, before);
});
test("join receipts the exact recent tail, not all earlier history", async () => {
  const f = await fixture();
  for (let i = 0; i < 40; i++) await f.call(0, "send_message", { content: `history ${i}`, force: true });
  const session = createSessionServer(f.h);
  const out = await (session.server as any)._registeredTools.join_room.handler({ room: f.room, name: "newcomer", agent: "test" }, {});
  const data = JSON.parse(out.content[0].text);
  assert.deepEqual(seqs(f.receipts(data.participant_id, "join")), lines(data.recent_messages));
  assert.equal(seqs(f.receipts(data.participant_id, "join")).length, 30);
});
test("internal wait settlement precedes receipt until final response handoff", async () => {
  const f = await fixture();
  const sent = await f.call(0, "send_message", { content: "held chatter", force: true });
  let release!: () => void, reached!: () => void;
  const pause = new Promise<void>(r => { release = r; });
  const settled = new Promise<void>(r => { reached = r; });
  const original = f.h.wait.bind(f.h);
  f.h.wait = async (...args) => { const ms = await original(...args); reached(); await pause; return ms; };
  const waiting = f.call(1, "wait_for_messages", { timeout_ms: 0 });
  await settled;
  assert.ok(f.h.getRoom(f.room).participants.get(f.b)!.lastSeenSeq >= sent.data.seq);
  assert.ok(!seqs(f.receipts()).includes(sent.data.seq), "internal settlement is not a handoff");
  release(); await waiting;
  assert.ok(seqs(f.receipts(f.b, "wait")).includes(sent.data.seq), "final result is a handoff");
});
test("sparse delivery splits after 64 ranges without adding gaps or losing bodies", async () => {
  const f = await fixture();
  for (let i = 0; i < 140; i++) {
    await f.call(0, "send_message", { content: `@carol quiet ${i}`, quiet: true, force: true });
    await f.call(0, "send_message", { content: `public ${i}`, quiet: false, force: true });
  }
  const before = f.receipts().length;
  const w = await f.call(1, "wait_for_messages", { timeout_ms: 0 });
  const added = f.receipts().slice(before);
  assert.ok(added.length >= 3, "140 sparse ranges require at least three bounded records");
  assert.deepEqual(seqs(added), lines(w.data).sort((a: number, b: number) => a - b));
  for (const e of added) {
    assert.ok(e.seq_ranges.length <= 64);
    assert.equal(e.count, seqs([e]).length);
    assert.ok(Buffer.byteLength(JSON.stringify(e)) < 3000);
  }
});
test("serialization failure never claims a successful body handoff", async () => {
  const f = await fixture();
  const sent = await f.call(0, "send_message", { content: "not returned successfully", force: true });
  const circular: any = {}; circular.self = circular;
  f.h.quietActivity = () => circular;
  const w = await f.call(1, "wait_for_messages", { timeout_ms: 0 });
  assert.ok(w.result.isError); assert.match(w.text, /circular/i);
  assert.ok(!seqs(f.receipts(f.b, "wait")).includes(sent.data.seq));
});
test("fresh challenger filtered history and proposal envelopes are not body receipts", async () => {
  const f = await fixture();
  const pr = f.h.propose(f.room, f.a, "a checkable proposal body");
  f.h.awaitScrutiny(f.room, pr.id, "bob", 60_000);
  const hidden = await f.call(0, "send_message", { content: "hidden fresh-challenger history", force: true });
  const before = f.receipts().length;
  const w = await f.call(1, "wait_for_messages", { timeout_ms: 0 });
  assert.doesNotMatch(w.text, /hidden fresh-challenger history/);
  assert.ok(!seqs(f.receipts().slice(before)).includes(hidden.data.seq));
});
test("reference oracle requires a receipt earlier than the reply and never exposes participant ids", async () => {
  const f = await fixture();
  const ask = await f.call(0, "send_message", { content: "@bob say whether the hypothesis holds", force: true });
  await f.call(1, "wait_for_messages", { timeout_ms: 0 });
  await f.call(1, "send_message", { content: `For #${ask.data.seq}: yes`, reply_to: ask.data.id, force: true });
  const measured = deliveryCoverage(f.events());
  assert.equal(measured.n, 1); assert.equal(measured.covered, 1); assert.equal(measured.coverage, 1);
  assert.ok(measured.receipt_bytes_per_message! > 0);
  assert.ok(!JSON.stringify(measured).includes(f.b), "public output has seat label, never the participant id");
  const old = deliveryCoverage(f.events().filter(e => e.type !== "delivery_receipt"));
  assert.equal(old.n, 1); assert.equal(old.covered, 0); assert.match(old.unknown_reason!, /no explicit/);
  const late = f.events().filter(e => e.type !== "delivery_receipt").concat(f.receipts());
  assert.equal(deliveryCoverage(late).covered, 0, "a later receipt does not cover a prior response");
});
test("reference coverage includes replied hub asks and human messages as separate channels", async () => {
  const f = await fixture(), room = f.h.getRoom(f.room);
  const hubAsk = f.h.post(room, "chat", undefined, "@bob inspect the evidence fixture", { tag: "hands" });
  await f.call(1, "wait_for_messages", { timeout_ms: 0 });
  await f.call(1, "send_message", { content: `For #${hubAsk.seq}: inspected`, reply_to: hubAsk.id, force: true });
  const human = f.h.join(f.room, "benji", "human").participant;
  const humanAsk = f.h.send(f.room, human.id, "@bob confirm the fixture result", undefined, true);
  await f.call(1, "wait_for_messages", { timeout_ms: 0 });
  await f.call(1, "send_message", { content: `For #${humanAsk.seq}: confirmed`, reply_to: humanAsk.id, force: true });
  const result = deliveryCoverage(f.events()) as any;
  assert.equal(result.n, 2, "coverage denominator includes every explicit incoming-message reference");
  assert.equal(result.covered, 2);
  assert.deepEqual(result.channels.hub, { n: 1, covered: 1, unknown: 0 });
  assert.deepEqual(result.channels.human, { n: 1, covered: 1, unknown: 0 });
});
test("autogenerated outbound board notices are not a seat quoting or answering a message", async () => {
  const f = await fixture();
  await f.call(0, "board_set", { key: "evidence/long-shared-key", text: "first result" });
  await f.call(1, "board_set", { key: "evidence/long-shared-key", text: "second result", append: true });
  assert.equal(deliveryCoverage(f.events()).n, 0, "two generated notices quoting the same board key are not an authored response");
});

let failed = 0;
try {
  for (const [name, run] of cases) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.error(`FAIL ${name}: ${e instanceof Error ? e.stack : e}`); }
  }
} finally { for (const root of roots) rmSync(root, { recursive: true, force: true }); }
console.log(`DELIVERY RECEIPTS: ${cases.length - failed}/${cases.length} passed`);
process.exitCode = failed ? 1 : 0;
