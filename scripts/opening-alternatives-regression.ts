/** Alternatives named in a sealed opening become idea/* entries at the reveal (decision/opening-alternatives).
 * In 198 of 200 concluded rooms the first build claim came before any alternative was on the board, and the hint that
 * asks a seat to move a listed idea to idea/<slug> was followed by one 23 times in 244 (evidence/brainstorm-replay-200).
 * js47's one measured positive lead lived in prose, was queued behind infrastructure and never ran
 * (evidence/brainstorm-narrowing-js47). The opening is the one moment every seat writes before reading the others
 * (arXiv:2604.18005: diversity collapses through interaction), so the hub records alternatives there itself.
 *
 * submit_opening takes up to 3 `alternatives`; on reveal each becomes idea/<slug>, authored by the seat that named it,
 * never taking over another entry's key, exact duplicates merged, seeded once. The opening and openings_revealed events
 * carry them, so a replay counts them (scripts/brainstorm-breadth.ts).
 *
 * npx tsx scripts/opening-alternatives-regression.ts */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";

Hub.DEFAULT_NUDGE_MS = 0;
const dataDir = mkdtempSync(join(tmpdir(), "opening-alts-"));
const hub = new Hub({ dataDir });
async function seat(name: string) {
  const session = createSessionServer(hub);
  const client = new Client({ name, version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await session.server.connect(st); await client.connect(ct);
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name: tool, arguments: args });
    const text = (r.content as { text: string }[])[0]?.text ?? "";
    return { error: !!r.isError, text, json: (() => { try { return JSON.parse(text); } catch { return {}; } })() };
  };
  return async (tool: string, args: Record<string, unknown>) => {
    const r = await call(tool, args);
    assert.ok(!r.error, `${name}.${tool}: ${r.text}`);
    return r.json;
  };
}
async function rawSeat(name: string) {
  const session = createSessionServer(hub);
  const client = new Client({ name, version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await session.server.connect(st); await client.connect(ct);
  return async (tool: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name: tool, arguments: args });
    return { error: !!r.isError, text: (r.content as { text: string }[])[0]?.text ?? "" };
  };
}

try {
  const room = "opening-alts";
  const a = await seat("a"); const b = await seat("b"); const c = await seat("c");
  await a("join_room", { room, name: "A", agent: "test", expected_participants: 3 });
  await b("join_room", { room, name: "B", agent: "test" });
  await c("join_room", { room, name: "C", agent: "test" });

  // 1. Out of bounds is refused, with the reason.
  const x = await rawSeat("x");
  await x("join_room", { room: "opening-alts-bounds", name: "X", agent: "test", expected_participants: 2 });
  let bad = await x("submit_opening", { room: "opening-alts-bounds", content: "Copy the leader.", alternatives: ["one", "two", "three", "four"] });
  assert.ok(bad.error && /at most 3/.test(bad.text), `four alternatives are refused: ${bad.text}`);
  bad = await x("submit_opening", { room: "opening-alts-bounds", content: "Copy the leader.", alternatives: ["y".repeat(201)] });
  assert.ok(bad.error && /200/.test(bad.text), `a 201-char alternative is refused: ${bad.text}`);

  // 2. A peer's entry already holds the slug key: it is never taken over.
  await c("board_set", { room, key: "idea/momentum-tilt-30-s-risers", text: "C's own earlier idea, not from an opening." });

  await a("submit_opening", { room, content: "Copy the top-volume wallet's maker ladder.", alternatives: [
    "Momentum tilt on 30 s risers; check: replay maker fills split by 30 s move on the recorded tape.",
    "Rebate-tier income, not edge; check: after-fee P&L with and without rebates on the leader's 30-day fills.",
  ] });
  await b("submit_opening", { room, content: "Replay the demo bot's fills as ground truth first.", alternatives: [
    "rebate-tier income, not edge;  check: after-fee P&L with and without rebates on the leader's 30-day fills.",
  ] });
  const before = [...hub.getRoom(room).board.keys()].filter((k) => k.startsWith("idea/"));
  assert.deepEqual(before, ["idea/momentum-tilt-30-s-risers"], "nothing is seeded before the reveal (openings stay sealed)");
  await c("submit_opening", { room, content: "Build the engine first." });

  // 3. On reveal: one idea/* per distinct alternative, authored by the seat that named it.
  const r = hub.getRoom(room);
  const ideas = [...r.board.entries()].filter(([k]) => k.startsWith("idea/"));
  assert.equal(ideas.length, 3, `C's entry plus two seeded (the duplicate merged): ${ideas.map(([k]) => k).join(", ")}`);
  assert.equal(r.board.get("idea/momentum-tilt-30-s-risers")!.text, "C's own earlier idea, not from an opening.", "C's entry is untouched");
  const momentum = ideas.find(([k, e]) => k !== "idea/momentum-tilt-30-s-risers" && /Momentum tilt/.test(e.text));
  assert.ok(momentum, "A's momentum alternative is seeded under its own key");
  assert.equal(momentum![0], "idea/momentum-tilt-30-s-risers-a", `the colliding slug gets the seat suffix: ${momentum![0]}`);
  assert.equal(momentum![1].by, "A", "authored by the seat that named it");
  assert.match(momentum![1].text, /sealed opening/, "says where it came from");
  const rebate = ideas.find(([, e]) => /Rebate-tier/i.test(e.text));
  assert.ok(rebate, "the rebate alternative is seeded");
  assert.equal(rebate![1].by, "A", "the first seat to name a duplicate is its author");
  assert.match(rebate![1].text, /\bA\b.*\bB\b/, `the merged duplicate names both seats: ${rebate![1].text}`);

  // 4. The reveal says where they went, in one line.
  const line = r.messages.find((m) => m.kind === "system" && /idea\//.test(m.content) && /sealed openings/.test(m.content));
  assert.ok(line, `one system line lists the seeded ideas: ${r.messages.map((m) => m.content).join(" | ")}`);
  assert.match(line!.content, /idea\/momentum-tilt-30-s-risers-a/);

  // 5. Telemetry: the opening event carries the alternatives, openings_revealed carries what was seeded.
  const log = readFileSync(join(dataDir, `${room}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const opened = log.filter((e) => e.type === "opening");
  assert.equal(opened.find((e) => e.pid === r.participants.values().next().value!.id)?.alternatives?.length, 2, "A's opening event has its 2 alternatives");
  const revealed = log.find((e) => e.type === "openings_revealed");
  assert.deepEqual(revealed?.ideas_seeded?.length, 2, `openings_revealed lists the 2 seeded keys: ${JSON.stringify(revealed)}`);

  // 6. Seeded once: a hub restored from the log has the same ideas and seeds nothing more.
  const restored = new Hub({ dataDir });
  const again = [...restored.getRoom(room).board.entries()].filter(([k]) => k.startsWith("idea/")).map(([k, e]) => `${k}:${e.by}`).sort();
  assert.deepEqual(again, ideas.map(([k, e]) => `${k}:${e.by}`).sort(), "the restored board holds the same ideas, no more");
  const log2 = readFileSync(join(dataDir, `${room}.jsonl`), "utf8").trim().split("\n").filter((l) => l.includes('"openings_revealed"'));
  assert.equal(log2.length, 1, "no second reveal after a restore");

  // 7. An opening without alternatives behaves as before: no idea, no line.
  const room2 = "opening-alts-none";
  const d = await seat("d"); const e = await seat("e");
  await d("join_room", { room: room2, name: "D", agent: "test", expected_participants: 2 });
  await e("join_room", { room: room2, name: "E", agent: "test" });
  await d("submit_opening", { room: room2, content: "Spaces." });
  await e("submit_opening", { room: room2, content: "Tabs." });
  const r2 = hub.getRoom(room2);
  assert.equal([...r2.board.keys()].filter((k) => k.startsWith("idea/")).length, 0, "no alternatives, no ideas");
  assert.ok(!r2.messages.some((m) => /sealed openings/.test(m.content)), "and no line");

  // 8. A seat that resubmits its sealed opening without alternatives withdraws them, also across a restore
  // (review of 95bab74d by 6-astra-4: replay only ever added alternatives, so a withdrawn one came back).
  const room3 = "opening-alts-withdrawn";
  const f = await seat("f"); const g = await seat("g");
  await f("join_room", { room: room3, name: "F", agent: "test", expected_participants: 2 });
  const gj = await g("join_room", { room: room3, name: "G", agent: "test" });
  await f("submit_opening", { room: room3, content: "First thought.", alternatives: ["Withdrawn idea; check: none"] });
  await f("submit_opening", { room: room3, content: "Second thought, no alternatives." });
  const restored3 = new Hub({ dataDir });
  const g3 = restored3.join(room3, "G", "test", {}, gj.participant_id).participant;
  restored3.submitOpening(room3, g3.id, "G opens.");
  assert.equal([...restored3.getRoom(room3).board.keys()].filter((k) => k.startsWith("idea/")).length, 0, "the withdrawn alternative is not seeded after a restore");

  // 9. A reveal that finds its own earlier seeded entry (a crash between the idea's write and openings_revealed)
  // reuses it instead of writing a -<seat> duplicate.
  const room4 = "opening-alts-recover";
  const h = await seat("h"); const i = await seat("i");
  await h("join_room", { room: room4, name: "H", agent: "test", expected_participants: 2 });
  await i("join_room", { room: room4, name: "I", agent: "test" });
  const alt = "Queue position at a level's birth; check: fill share in the first batch";
  await h("submit_opening", { room: room4, content: "H's answer.", alternatives: [alt] });
  await h("board_set", { room: room4, key: "idea/queue-position-level-s-birth", text: `${alt}\n\nFrom H's sealed opening, written before reading the others.` });
  await i("submit_opening", { room: room4, content: "I's answer." });
  const r4 = [...hub.getRoom(room4).board.keys()].filter((k) => k.startsWith("idea/"));
  assert.deepEqual(r4, ["idea/queue-position-level-s-birth"], `no duplicate of a seed already written: ${r4.join(", ")}`);

  console.log("opening-alternatives-regression: OK");
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(0);
