/** Rival framings at the reveal (decision/reveal-rivals, item/reveal-lever-pair; src/hub/openings/rivals.ts).
 * RSI-7: the concluded framing was at the reveal in 19 of 20 rooms; its alternatives arm seeded 27 alternatives and
 * 26 were refuted by their own author at p <= 0.07, none tested. With rivalsConfig.on each opener is handed one
 * framing it did not write, the one least like its opening, as an owed ask; a peer's opening chosen as a rival is
 * seeded as idea/<slug>. Telemetry, flag or not: framing {claimed|attacked|tested|dropped|...}, rival_assigned and
 * rival_answered; all of it survives a restore.
 *
 * npx tsx scripts/reveal-rivals-regression.ts */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";
import { framingsOf, rivalsConfig } from "../src/hub/openings/rivals.js";

Hub.DEFAULT_NUDGE_MS = 0;
const dataDir = mkdtempSync(join(tmpdir(), "reveal-rivals-"));
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
    try { return JSON.parse(text); } catch { return {}; }
  };
}
const events = (room: string) => readFileSync(join(dataDir, `${room}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const claim = (area: string, owner: string) => JSON.stringify({ area, owner, team: [owner], status: "open" });
const ofType = (room: string, type: string) => events(room).filter((e) => e.type === type);

try {
  // 1. Flag on: three openers, two near-identical openings and one apart; A and B name alternatives, C names none.
  rivalsConfig.on = true;
  const room = "rivals-on";
  const a = await seat("a"); const b = await seat("b"); const c = await seat("c");
  await a("join_room", { room, name: "A", agent: "test", expected_participants: 3 });
  await b("join_room", { room, name: "B", agent: "test" });
  await c("join_room", { room, name: "C", agent: "test" });
  await a("submit_opening", { room, content: "Generate exact decimal digits of the double with BigInt for e, f and g, rounding half to even.", alternatives: [
    "Pick the %g exponent from Math.log10 of the value; check: %.17g of 1e-07 against the exact expansion.",
  ] });
  await b("submit_opening", { room, content: "Generate exact decimal digits with BigInt for e, f and g conversions, half to even rounding.", alternatives: [
    "Diff against the system printf over a grid of formats and values; check: any mismatch on a 10k grid.",
  ] });
  await c("submit_opening", { room, content: "Write the flag and width parser first, table driven, then add conversions one by one." });
  const r = hub.getRoom(room);

  const assigned = ofType(room, "rival_assigned");
  assert.equal(assigned.length, 3, `every opener gets one rival: ${JSON.stringify(assigned)}`);
  const rivalOf = new Map(assigned.map((e) => [e.seat, e]));
  for (const e of assigned) {
    const entry = r.board.get(e.key);
    assert.ok(entry?.text.trim(), `${e.seat}'s rival ${e.key} is on the board`);
    assert.notEqual(entry!.by, e.seat, `${e.seat} is never handed a framing it wrote (${e.key} by ${entry!.by})`);
    assert.equal(e.method, "jaccard");
    assert.ok(e.overlap >= 0 && e.overlap <= 1, "overlap is a fraction");
  }
  assert.equal(new Set(assigned.map((e) => e.key)).size, 3, `three candidates or more: no two seats share a rival (${assigned.map((e) => e.key).join(", ")})`);
  // A's nearest peer is B's near-identical opening; its rival must be something further away than that
  assert.notEqual(rivalOf.get("A").source === "opening" && rivalOf.get("A").from === "B", true, "A is not handed B's near-copy of its own opening");

  // 2. A peer's opening chosen as a rival is seeded once as idea/<slug>, authored by the seat that wrote it.
  const fromOpening = assigned.filter((e) => e.source === "opening");
  for (const e of fromOpening) {
    assert.equal(r.board.get(e.key)!.by, e.from, "an opening rival is authored by its writer");
    assert.match(r.board.get(e.key)!.text, /sealed opening \(its main answer\)/, "and says it was a main answer");
  }
  const seeded = ofType(room, "framings_seeded");
  assert.equal(seeded.length, 1, "one framings_seeded event");
  assert.equal(seeded[0].rivals, true);
  for (const e of assigned) assert.ok(seeded[0].keys.includes(e.key), `${e.key} is listed as a seeded framing`);

  // 3. Each seat's ask is addressed to it, tagged rival, names the key and is owed after delivery (like hands).
  for (const [name, call] of [["A", a], ["B", b], ["C", c]] as const) {
    const p = [...r.participants.values()].find((q) => q.name === name)!;
    const ask = r.messages.find((m) => m.id === rivalOf.get(name).ask)!;
    assert.equal(ask.tag, "rival");
    assert.ok(ask.mentions?.includes(p.id), `${name}'s ask @-names it`);
    assert.ok(ask.content.includes(rivalOf.get(name).key), "the ask names the rival key");
    await call("wait_for_messages", { room, timeout_ms: 0 });
    assert.equal(hub.attentionFocus(r, p)?.id, ask.id, `${name}'s rival ask stays its focused ask after delivery`);
  }

  // 4. A replies to its ask: rival_answered via reply, and the ask is settled. B passes: via pass.
  const askA = rivalOf.get("A").ask;
  await a("send_message", { room, content: "Input %.17g of 1e-07: exact expansion is 9.99...95e-08, Math.log10 gives -7, so the rival is wrong there.", reply_to: askA, force: true });
  const pA = [...r.participants.values()].find((q) => q.name === "A")!;
  assert.notEqual(hub.attentionFocus(r, pA)?.id, askA, "the reply settles A's ask");
  await b("pass", { room });
  const answered = ofType(room, "rival_answered");
  assert.deepEqual(answered.map((e) => `${e.seat}:${e.via}`).sort(), ["A:reply", "B:pass"], `one answer each: ${JSON.stringify(answered)}`);
  assert.equal(answered.find((e) => e.seat === "A").held_claim, false, "A answered before any claim");
  // a second reply to the same ask is not a second answer
  await a("send_message", { room, content: "Adding: 1e-300 also differs.", reply_to: askA, force: true });
  assert.equal(ofType(room, "rival_answered").length, 2, "logged once per ask");

  // 5. framing events: a claim on a seeded framing, an attack on one, a disposition change, a clear.
  const keyA = rivalOf.get("A").key, keyC = rivalOf.get("C").key;
  await a("board_set", { room, key: `attack/${keyA}`, text: `"${r.board.get(keyA)!.text.split("\n")[0].slice(0, 30)}" fails on %.17g of 1e-07.` });
  await c("board_set", { room, key: `claim/${keyC.slice(5)}`, text: claim(keyC.slice(5), "C") });
  const altB = ofType(room, "openings_revealed")[0].ideas_seeded.find((k: string) => r.board.get(k)!.by === "B");
  const textB = r.board.get(altB)!.text;
  await b("board_set", { room, key: altB, text: `tested: 10k grid vs printf, 1 mismatch\n${textB}` });
  await b("board_set", { room, key: altB, text: `tested: 10k grid vs printf, 0 mismatches after the fix\n${textB}` }); // same word: no new event
  await b("board_set", { room, key: altB, text: `done: kept as the room's check\n${textB}` });
  await b("board_set", { room, key: "claim/unrelated-thing", text: claim("unrelated-thing", "B") });
  const framing = ofType(room, "framing");
  const seen = framing.map((e) => `${e.action}:${e.key}:${e.by}:${e.by_assigned}`);
  assert.ok(seen.includes(`attacked:${keyA}:A:true`), `A's attack on its own rival is logged as by the assigned seat: ${seen.join(" | ")}`);
  assert.ok(seen.includes(`claimed:${keyC}:C:true`), `C's claim on its rival: ${seen.join(" | ")}`);
  assert.equal(framing.filter((e) => e.key === altB && e.action === "tested").length, 1, "a repeated disposition word logs once");
  assert.ok(framing.some((e) => e.key === altB && e.action === "done"), "a changed disposition logs again");
  assert.ok(!framing.some((e) => e.key === "idea/unrelated-thing"), "keys that were not seeded log nothing");
  for (const e of framing) assert.ok(typeof e.minutes_since_reveal === "number" && e.author, "every framing event has its age and author");

  // 6. A restored hub keeps the framings and the rivals: a later claim still logs, by_assigned still known.
  const restored = new Hub({ dataDir });
  const rr = restored.getRoom(room);
  assert.deepEqual(framingsOf(rr)?.rivals.map((x) => `${x.seat}:${x.key}`).sort(), assigned.map((e) => `${e.seat}:${e.key}`).sort(), "rivals restored");
  const bId = restored.join(room, "B", "test", {}, [...rr.participants.values()].find((q) => q.name === "B")!.id).participant.id;
  const keyB = rivalOf.get("B").key;
  restored.setBoard(room, bId, `claim/${keyB.slice(5)}`, claim(keyB.slice(5), "B"));
  const late = ofType(room, "framing").find((e) => e.key === keyB && e.action === "claimed");
  assert.ok(late?.by_assigned, `a claim after a restore is logged with its assignment: ${JSON.stringify(late)}`);

  // 7. Flag off: no rival asks or rival-seeded openings, but the seeded alternatives still get framing events.
  rivalsConfig.on = false;
  const room2 = "rivals-off";
  const d = await seat("d"); const e2 = await seat("e");
  await d("join_room", { room: room2, name: "D", agent: "test", expected_participants: 2 });
  await e2("join_room", { room: room2, name: "E", agent: "test" });
  await d("submit_opening", { room: room2, content: "Spaces.", alternatives: ["Tabs after all; check: the linter config"] });
  await e2("submit_opening", { room: room2, content: "Tabs." });
  const r2 = hub.getRoom(room2);
  assert.equal(ofType(room2, "rival_assigned").length, 0, "no rivals with the flag off");
  assert.ok(!r2.messages.some((m) => m.tag === "rival"), "no rival asks");
  assert.equal([...r2.board.keys()].filter((k) => k.startsWith("idea/")).length, 1, "only the alternative is seeded");
  assert.equal(ofType(room2, "framings_seeded")[0]?.rivals, false);
  const idea = [...r2.board.keys()].find((k) => k.startsWith("idea/"))!;
  await e2("board_set", { room: room2, key: `attack/${idea}.E`, text: `"Tabs after all" is what E said; nothing new.` });
  await d("board_set", { room: room2, key: idea, text: "" });
  assert.deepEqual(ofType(room2, "framing").map((x) => `${x.action}:${x.by}:${x.by_assigned}`), ["attacked:E:false", "cleared:D:false"], "attack (with a suffix) and clear are logged without a flag");

  console.log("reveal-rivals-regression: OK");
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(0);
