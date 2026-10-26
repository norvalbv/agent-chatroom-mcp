/**
 * Unowned work with no free seat is put to someone who can add a hand (swarm-005940-77tu, decision/hands-for-unowned-ideas;
 * owner asks 1 and 8: bottlenecks that never broke out, and when to recruit).
 *
 * open-work.ts has named this case since swarm-003601-tky5 (idea_no_free_seat), but only on an idle wait, only to the
 * idea's author while that author held a claim of its own, and with the line ending "if you are mid-task, carry on and
 * ignore this". Across 332 room logs (MAIN/data and the research server's copy) it fired 9 times in 6 rooms and a
 * recruit followed within 30 minutes 0 times; 73 of 81 idea/* entries were never claimed (evidence/bottlenecks-9f66).
 *
 * Now the hub's sweep asks once, when the condition has held: an idea/<slug> nobody has claimed for HANDS_AFTER_MS while
 * every worker holds a live claim. The ask @-names the idea's author, is tagged "hands", and is owed: it is the author's
 * focused ask until a reply or pass, and a busy seat is shown it mid-turn (steer) like any peer ask. hands_asked and
 * hands_resolved (recruited / claimed / dropped / built) are logged, and run-metrics reports them.
 *
 * npx tsx scripts/hands-ask-regression.ts */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";
import { steerPending } from "../src/hub/steer.js";
import { parseRoomLog, runMetrics } from "../src/run-metrics.js";

const cases: [string, () => void][] = [];
const test = (name: string, run: () => void) => cases.push([name, run]);

const DAY = 24 * 3600_000;
const OLD = () => new Date(Date.now() - 11 * 60_000).toISOString();
let serial = 0;
function room(opts: { chair?: boolean } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "hands-"));
  const h = new Hub({ dataDir });
  const name = `hands-${++serial}`;
  const a = h.join(name, "alice", "claude", {}, undefined, "sess-alice").participant;
  const b = h.join(name, "bob", "claude", {}, undefined, "sess-bob").participant;
  h.join(name, "verifier", "claude", {}, undefined, "sess-ver", "verifier");
  const chair = opts.chair ? h.join(name, "chair-claude", "claude", {}, undefined, "sess-chair", "chair").participant : undefined;
  const r = h.getRoom(name);
  const events = () => readFileSync(join(dataDir, `${name}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  /** both workers busy, and alice's idea written 11 minutes ago */
  const busyWithIdea = (author = a.id) => {
    h.setBoard(name, a.id, "claim/alpha", JSON.stringify({ area: "alpha" }));
    h.setBoard(name, b.id, "claim/beta", JSON.stringify({ area: "beta" }));
    h.setBoard(name, author, "idea/gamma", "the third item: what it is, the evidence, how to build it");
    r.board.get("idea/gamma")!.updatedAt = OLD();
  };
  const hands = () => r.messages.filter((m) => m.tag === ("hands" as never));
  return { h, name, r, a, b, chair, events, dataDir, busyWithIdea, hands };
}

test("an idea unclaimed for 10 min while every worker holds a claim gets one owed ask to its author", () => {
  const { h, r, a, busyWithIdea, hands, events } = room();
  busyWithIdea();
  h.sweepIdle(DAY);
  assert.equal(hands().length, 1, "the sweep asks: before, this case was named only on an idle wait, 9 times in 332 logs, 0 recruits");
  const m = hands()[0];
  assert.equal(m.kind, "chat");
  assert.deepEqual(m.mentions, [a.id], "the idea's author is asked");
  assert.match(m.content, /idea\/gamma/);
  assert.match(m.content, /request_agent\(area="gamma"/, "the recruit call is spelled out");
  assert.match(m.content, /dropped:/, "dropping it is a named answer too");
  assert.doesNotMatch(m.content, /ignore this/i, "the author is busy by construction: the ask must not excuse it");
  assert.match(m.content, /all 2 workers hold a claim/);
  assert.equal(h.attentionFocus(r, a)?.id, m.id, "owed: it is the author's focused ask");
  h.readAs(r, a, 0, 200);
  assert.equal(h.attentionFocus(r, a)?.id, m.id, "still owed once delivered (a plain hub notice retires on delivery)");
  const asked = events().filter((e) => e.type === "hands_asked");
  assert.equal(asked.length, 1);
  assert.equal(asked[0].key, "idea/gamma");
  assert.equal(asked[0].author, "alice");
  assert.equal(asked[0].workers, 2);
  assert.ok(asked[0].idea_age_min >= 10);
});

test("a busy author is shown the ask mid-turn: it is steered like a peer ask", () => {
  const { h, r, a, busyWithIdea, hands } = room();
  busyWithIdea();
  h.sweepIdle(DAY);
  assert.ok(steerPending(h, r, a).some((m) => m.id === hands()[0].id), "the author holds a claim, so it is mid-task when asked");
});

test("asked once: a second sweep does not repeat it, and neither does a restarted hub", () => {
  const { h, busyWithIdea, hands, dataDir, name } = room();
  busyWithIdea();
  h.sweepIdle(DAY);
  h.sweepIdle(DAY);
  assert.equal(hands().length, 1);
  const h2 = new Hub({ dataDir });
  h2.sweepIdle(DAY);
  assert.equal(h2.getRoom(name).messages.filter((m) => m.tag === ("hands" as never)).length, 1, "the ask is read back from the room's messages");
});

test("no ask while a worker is free, or before the idea is 10 minutes old", () => {
  const { h, name, r, a, b, hands } = room();
  h.setBoard(name, a.id, "claim/alpha", JSON.stringify({ area: "alpha" }));
  h.setBoard(name, a.id, "idea/gamma", "the third item");
  r.board.get("idea/gamma")!.updatedAt = OLD();
  h.sweepIdle(DAY);
  assert.equal(hands().length, 0, "bob holds no claim: the idle-wait hint offers him the idea");
  h.setBoard(name, b.id, "claim/beta", JSON.stringify({ area: "beta" }));
  r.board.get("idea/gamma")!.updatedAt = new Date().toISOString();
  h.sweepIdle(DAY);
  assert.equal(hands().length, 0, "a fresh idea gets the grace window first");
});

test("an idea already claimed, or settled in its own text, is not asked about", () => {
  const { h, name, r, a, b, hands } = room();
  h.setBoard(name, a.id, "claim/alpha", JSON.stringify({ area: "alpha" }));
  h.setBoard(name, b.id, "claim/gamma", JSON.stringify({ area: "gamma" }));
  h.setBoard(name, a.id, "idea/gamma", "the third item");
  h.setBoard(name, a.id, "idea/delta", "dropped: superseded by gamma");
  r.board.get("idea/gamma")!.updatedAt = OLD();
  r.board.get("idea/delta")!.updatedAt = OLD();
  h.sweepIdle(DAY);
  assert.equal(hands().length, 0);
});

test("resolution is logged once: recruited when request_agent claimed the area, dropped when the author says so", () => {
  const { h, name, r, a, busyWithIdea, events } = room();
  busyWithIdea();
  h.sweepIdle(DAY);
  h.setBoardAs(name, "alice", "claim/gamma", JSON.stringify({ area: "gamma", owner: "alice", team: ["alice", "recruit-1"], status: "open", note: "claimed at recruitment" }));
  h.sweepIdle(DAY);
  h.sweepIdle(DAY);
  const done = events().filter((e) => e.type === "hands_resolved");
  assert.equal(done.length, 1);
  assert.equal(done[0].key, "idea/gamma");
  assert.equal(done[0].how, "recruited");
  assert.equal(typeof done[0].after_min, "number");

  const two = room();
  two.busyWithIdea();
  two.h.sweepIdle(DAY);
  two.h.setBoard(two.name, two.a.id, "idea/gamma", "dropped: the alpha result already answers it");
  two.h.sweepIdle(DAY);
  assert.equal(two.events().filter((e) => e.type === "hands_resolved")[0]?.how, "dropped");
  void r; void a;
});

test("an author who has left is not asked; the chair is, when there is one", () => {
  const { h, name, r, a, b, chair, hands, events } = room({ chair: true });
  const c = h.join(name, "carol", "claude", {}, undefined, "sess-carol").participant;
  h.setBoard(name, c.id, "idea/gamma", "carol's item");
  h.leave(name, c.id, "done with my part");
  h.setBoard(name, a.id, "claim/alpha", JSON.stringify({ area: "alpha" }));
  h.setBoard(name, b.id, "claim/beta", JSON.stringify({ area: "beta" }));
  r.board.get("idea/gamma")!.updatedAt = OLD();
  h.sweepIdle(DAY);
  assert.equal(hands().length, 1);
  assert.deepEqual(hands()[0].mentions, [chair!.id], "carol left; the chair decides for the room");
  assert.equal(events().filter((e) => e.type === "hands_asked")[0].author, "carol");
});

test("a recruit holds the claim written for it at recruitment: it is on the team, not the writer", () => {
  const { h, name, r, a, hands } = room();
  h.join(name, "rec-1", "claude", {}, undefined, "sess-rec", "recruit");
  h.setBoard(name, a.id, "claim/alpha", JSON.stringify({ area: "alpha" }));
  h.setBoardAs(name, "alice", "claim/beta", JSON.stringify({ area: "beta", owner: "alice", team: ["alice", "bob", "rec-1"], status: "open", note: "claimed at recruitment" }));
  h.setBoard(name, a.id, "idea/gamma", "the third item");
  r.board.get("idea/gamma")!.updatedAt = OLD();
  h.sweepIdle(DAY);
  assert.equal(hands().length, 1, "this room's shape (swarm-005940-77tu): every recruit's claim is written by its recruiter");
  assert.match(hands()[0].content, /all 3 workers hold a claim/);
});

test("a lone worker that wrote the idea and holds a claim is asked: there is no self-skip", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "hands-"));
  const h = new Hub({ dataDir });
  const w = h.join("solo", "worker-1", "claude", {}, undefined, "sess-w").participant;
  h.join("solo", "verifier", "claude", {}, undefined, "sess-v", "verifier");
  h.setBoard("solo", w.id, "claim/a", JSON.stringify({ area: "a" }));
  h.setBoard("solo", w.id, "idea/d", "item D");
  const r = h.getRoom("solo");
  r.board.get("idea/d")!.updatedAt = OLD();
  h.sweepIdle(DAY);
  const asked = r.messages.filter((m) => m.tag === ("hands" as never));
  assert.equal(asked.length, 1, "chair-claude #339: the 2-seat probe rests on this");
  assert.equal(h.attentionFocus(r, w)?.id, asked[0].id);
  assert.match(asked[0].content, /the only worker holds a claim/);
});

test("a recruitment claim whose note the chair extended still reads as recruited; the ask names claiming what you already build", () => {
  const { h, name, busyWithIdea, hands, events } = room();
  busyWithIdea();
  h.sweepIdle(DAY);
  assert.match(hands()[0].content, /claim\/gamma if you are building it already/, "review/203a9a94 (c): 2 of 10 replayed ideas were being built without a claim");
  h.setBoardAs(name, "alice", "claim/gamma", JSON.stringify({ area: "gamma", owner: "alice", team: ["alice", "recruit-1"], status: "open", note: "claimed at recruitment; recruit-1 does the work, alice reviews" }));
  h.sweepIdle(DAY);
  assert.equal(events().filter((e) => e.type === "hands_resolved")[0]?.how, "recruited", "review/203a9a94 (b): claim/room-size here carries such a note");
});

test("an item/* nobody holds gets the same ask; a claim naming it, not only claim/<slug>, resolves it", () => {
  const { h, name, r, a, b, chair, hands, events } = room({ chair: true });
  h.setBoard(name, a.id, "claim/alpha", JSON.stringify({ area: "alpha" }));
  h.setBoard(name, b.id, "claim/beta", JSON.stringify({ area: "beta" }));
  h.setBoard(name, chair!.id, "item/gamma", "the brief's third problem");
  r.board.get("item/gamma")!.updatedAt = OLD();
  h.sweepIdle(DAY);
  assert.equal(hands().length, 1, "decision/coverage-tracking (a): a brief problem with no free seat was named only to free seats (open_work item_unowned)");
  assert.match(hands()[0].content, /item\/gamma has had no owner for \d+ min/);
  assert.match(hands()[0].content, /request_agent\(area="gamma"/);
  assert.deepEqual(hands()[0].mentions, [chair!.id], "the chair wrote the item");
  h.setBoard(name, b.id, "claim/beta", JSON.stringify({ area: "beta", note: "also item/gamma, same file" }));
  h.sweepIdle(DAY);
  const done = events().filter((e) => e.type === "hands_resolved");
  assert.equal(done.length, 1, "the ledger's owners decide, as in room_status.coverage");
  assert.equal(done[0].key, "item/gamma");
  assert.equal(done[0].how, "claimed");
  assert.equal(done[0].by, "bob");
});

test("an item the launcher seeded, in a room with no chair, is put to the worker holding the fewest claims", () => {
  const { h, name, r, a, b, hands, events, dataDir } = room();
  h.setBoard(name, a.id, "claim/alpha", JSON.stringify({ area: "alpha" }));
  h.setBoard(name, a.id, "claim/alpha-2", JSON.stringify({ area: "alpha-2" }));
  h.setBoard(name, b.id, "claim/beta", JSON.stringify({ area: "beta" }));
  h.seedResources(name, [{ key: "item/gamma", text: "the brief's third problem" }]);
  r.board.get("item/gamma")!.updatedAt = OLD();
  h.sweepIdle(DAY);
  assert.equal(events().filter((e) => e.type === "hands_unasked").length, 0, "an idea here is logged unasked; a required problem needs someone to answer for it");
  assert.equal(hands().length, 1);
  assert.deepEqual(hands()[0].mentions, [b.id], "bob holds 1 claim, alice 2");
  assert.match(hands()[0].content, /launcher wrote it and is not in this room, so it is yours to settle/);
  h.setBoardAs(name, "launcher", "item/gamma", "dropped: the beta result covers it");
  h.sweepIdle(DAY);
  assert.equal(events().filter((e) => e.type === "hands_resolved")[0]?.how, "dropped");
  const m = runMetrics(parseRoomLog(readFileSync(join(dataDir, `${name}.jsonl`), "utf8")));
  assert.equal(m.hands?.items, 1, "run-metrics tells brief items from ideas");
});

test("several items with nobody to answer for them are spread over the workers, not all put to the earliest joiner", () => {
  const { h, name, r, a, b, hands } = room();
  h.setBoard(name, a.id, "claim/alpha", JSON.stringify({ area: "alpha" }));
  h.setBoard(name, b.id, "claim/beta", JSON.stringify({ area: "beta" }));
  h.seedResources(name, ["p1", "p2", "p3", "p4"].map((s) => ({ key: `item/${s}`, text: `problem ${s}` })));
  for (const s of ["p1", "p2", "p3", "p4"]) r.board.get(`item/${s}`)!.updatedAt = OLD();
  h.sweepIdle(DAY);
  assert.deepEqual(hands().map((m) => m.mentions?.[0]), [a.id, b.id, a.id, b.id], "review/af7ae3e9 F1: one sweep gave alice all 4");
});

test("run-metrics reports asks and how they were resolved", () => {
  const { h, name, busyWithIdea, dataDir } = room();
  busyWithIdea();
  h.sweepIdle(DAY);
  h.setBoardAs(name, "alice", "claim/gamma", JSON.stringify({ area: "gamma", owner: "alice", team: ["alice", "recruit-1"], status: "open", note: "claimed at recruitment" }));
  h.sweepIdle(DAY);
  const m = runMetrics(parseRoomLog(readFileSync(join(dataDir, `${name}.jsonl`), "utf8")));
  assert.equal(m.hands?.asked, 1);
  assert.equal(m.hands?.resolved.recruited, 1);
});

let failed = 0;
for (const [name, run] of cases) {
  try { run(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`not ok - ${name}\n  ${(e as Error).message.split("\n")[0]}`); }
}
if (failed) { console.log(`${failed} of ${cases.length} failed`); process.exit(1); }
console.log(`hands-ask regression OK (${cases.length} cases)`);
