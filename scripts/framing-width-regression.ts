/** scripts/framing-width.ts reads a room's framings from its log the way decision/width-rule registers (item/width-and-collapse):
 * openings stated at the reveal, workers only unless --all-seats, claims never framings, a proposal's re-log at the close
 * ignored, a vote holding its proposal's text, an idea alive until settled or cleared, a leaver's framing dropped; and it
 * dates a collapse against the first checkable evidence. Fixture logs, no embedder.
 *   npx tsx scripts/framing-width-regression.ts */
import assert from "node:assert/strict";
import { cluster, extract, framingKey, pairAgreement, width } from "./framing-width.ts";

const T = (min: number) => new Date(Date.UTC(2026, 9, 29, 12, 0, 0) + min * 60000).toISOString();
const join = (id: string, name: string, role?: string) => ({ type: "join", room: "r", p: { id, name, agent: role === "human" ? "human" : "claude", ...(role && role !== "human" ? { role } : {}), joinedAt: T(0) } });
const board = (min: number, key: string, by: string, text: string) => ({ type: "board", room: "r", key, entry: { text, by, updatedAt: T(min) } });
const msg = (min: number) => ({ type: "message", room: "r", msg: { kind: "system", content: "x", ts: T(min) } });
const opening = (pid: string, content: string) => ({ type: "opening", room: "r", pid, content });

const events: Record<string, any>[] = [
  { type: "room", room: "r", opts: { topic: "Which cache policy should we ship?" } },
  join("p1", "w1"), join("p2", "w2"), join("p3", "w3"), join("pv", "verifier"), join("pc", "chair", "chair"),
  msg(0.5),
  opening("p1", "LRU: evict least recently used."), opening("p2", "LFU: evict least frequently used."),
  opening("p3", "LRU, with a size cap."), opening("pv", "I will check every number."),
  { type: "openings_revealed", room: "r", ideas_seeded: ["idea/arc"] },
  msg(1),
  board(1, "idea/arc", "w2", "ARC adapts between recency and frequency."),
  board(2, "claim/lru", "w1", "Building LRU."),
  board(3, "decision/chair-budget", "chair", "Spend at most $5."),
  board(4, "draft/w2", "w2", "Recency wins on this trace: LRU."),
  board(6, "evidence/trace-replay", "w1", "Replayed trace: LRU hit rate 0.81 vs LFU 0.74 (cmd: replay.ts)."),
  board(7, "idea/arc", "w2", "dropped: no adaptive trace in the corpus."),
  { type: "proposal", room: "r", proposal: { id: "prop_1", by: { id: "p1", name: "w1" }, text: "Ship LRU with a size cap.", createdAt: T(8) } },
  { type: "amend", room: "r", proposalId: "prop_1", text: "Ship LRU with a size cap of 1 GB.", version: 2, updatedAt: T(9) },
  { type: "vote", room: "r", proposalId: "prop_1", pid: "p2", entry: { vote: "agree", ts: T(9.5) } },
  { type: "vote", room: "r", proposalId: "prop_1", pid: "pv", entry: { vote: "agree", ts: T(9.6) } },
  { type: "leave", room: "r", p: { id: "p3", name: "w3" }, ts: T(9.7) },
  { type: "proposal", room: "r", proposal: { id: "prop_1", by: { id: "p1", name: "w1" }, text: "Ship LRU with a size cap of 1 GB.", createdAt: T(8) } },
  { type: "state", room: "r", state: "concluded", conclusion: { proposalId: "prop_1", decidedAt: T(10) } },
];

const x = extract(events, "r");
assert.equal(x.t0, T(0.5), "openings carry no ts: they are stated at the reveal, the last ts before openings_revealed");
assert.deepEqual(x.stmts.filter((s) => s.source === "opening").map((s) => s.seat), ["p1", "p2", "p3"], "the verifier's opening is not a framing by default");
assert.equal(extract(events, "r", { allSeats: true }).stmts.filter((s) => s.source === "opening").length, 4, "--all-seats keeps it");
assert.ok(!x.stmts.some((s) => s.key === "claim/lru"), "a claim is a work area, not a framing");
assert.ok(!x.stmts.some((s) => s.key === "decision/chair-budget"), "the chair is not a seat");
assert.equal(x.stmts.filter((s) => s.source === "proposal").length, 1, "the proposal's re-log at the close is not a second statement");
const vote = x.stmts.find((s) => s.source === "vote" && s.seat === "p2")!;
assert.equal(x.stmts[vote.adopts!].source, "amend", "an agree vote holds the proposal's current version");
assert.equal(x.first_evidence, T(6), "first checkable evidence is the first evidence/* entry");
assert.equal(x.settled.length, 1, "a dropped: idea is settled");

// Hand labels: LRU (A) and LFU (B) compete at the reveal; ARC (C) lives only on the board until dropped. w2 moves to LRU
// in its draft at 4 min, before the evidence at 6 min: a collapse before evidence.
const lab = (i: number) => { const s = x.stmts[i]; const t = x.stmts[s.adopts ?? i]; return t.key === "idea/arc" ? "C" : /LFU:/.test(t.text) ? "B" : "A"; };
const w = width(x, lab);
assert.equal(w.held_at_reveal, 2, `LRU and LFU are held at the reveal: ${JSON.stringify(w)}`);
assert.equal(w.board_at_reveal, 2, "the ARC idea is written after the reveal");
assert.equal(w.curve[0].held, 2);
assert.equal(w.minutes_to_one, 3.5, "w2's draft at 4 min (3.5 after the reveal) leaves one framing");
assert.equal(w.collapse_before_evidence, true, "3.5 min is before the evidence at 5.5");
assert.equal(w.never_wide, false);

// The same room where w2 only moves after the evidence: collapse after evidence.
const late = events.map((e) => (e.type === "board" && e.key === "draft/w2" ? board(8.5, "draft/w2", "w2", "Recency wins on this trace: LRU.") : e));
const wl = width(extract(late, "r"), (i) => { const xl = extract(late, "r"); const s = xl.stmts[i]; const t = xl.stmts[s.adopts ?? i]; return /LFU:/.test(t.text) ? "B" : "A"; });
assert.equal(wl.collapse_before_evidence, false, `w2 moved after the evidence: ${JSON.stringify(wl)}`);

// A room that never had two framings: no collapse to date, and the comparison is not a positive.
const one = width(x, () => "A");
assert.equal(one.never_wide, true);
assert.equal(one.minutes_to_one, 0);
assert.equal(one.collapse_before_evidence, null, "never wide: nothing collapsed, so no before/after evidence");

// A leaver's framing is dropped: if w2 (LFU) left at 2 min without restating, the room is one framing from then on.
const leaver = [...events.filter((e) => !(e.type === "board" && e.key === "draft/w2")), { type: "leave", room: "r", p: { id: "p2", name: "w2" }, ts: T(2) }]
;
const wv = width(extract(leaver, "r"), (i) => { const xv = extract(leaver, "r"); const t = xv.stmts[xv.stmts[i].adopts ?? i]; return /LFU:/.test(t.text) ? "B" : "A"; });
assert.equal(wv.minutes_to_one, 1.5, `w2 leaving at 2 min ends LFU: ${JSON.stringify(wv)}`);

// v3 key set: framings also sit on ad-hoc keys (attack/result/width-and-collapse: 5zui's "fable-1-dissent"); work, evidence
// and admin keys never do. v2's allow-list missed them.
assert.ok(framingKey("fable-1-dissent") && framingKey("position") && framingKey("candidates/weather") && framingKey("draft/x"));
assert.ok(!framingKey("claim/x") && !framingKey("rerun/x") && !framingKey("evidence/x") && !framingKey("idea/x") && !framingKey("ledger"));
assert.ok(!framingKey("fable-1-dissent", "allow") && framingKey("draft/x", "allow"));
const dissent = extract([...events.slice(0, 9), board(1.5, "w1-dissent", "w1", "LFU after all.")], "r");
assert.ok(dissent.stmts.some((s) => s.key === "w1-dissent"), "an ad-hoc dissent key is a framing statement");

// Older logs set no role: the chair is the room's named chair (opts.chair), as cf8223aa does for opening-spread
// (review/5f7fd4a9 §5). Its board writes are steers, not a seat's framing; a worker merely named like a chair stays.
const roleless = [{ type: "room", room: "r", opts: { topic: "Which cache policy?", chair: "boss" } }, ...events.slice(1, 4),
  { type: "join", room: "r", p: { id: "pb", name: "boss", agent: "claude", joinedAt: T(0) } },
  { type: "join", room: "r", p: { id: "pk", name: "boss-2", agent: "claude", joinedAt: T(0) } },
  ...events.slice(6, 9), board(1.5, "draft/boss", "boss", "LFU, final answer."), board(1.6, "draft/boss-2", "boss-2", "LRU.")];
const xr = extract(roleless, "r");
assert.ok(!xr.stmts.some((s) => s.key === "draft/boss"), "a roleless seat named as the room's chair is not a framing seat");
assert.ok(xr.stmts.some((s) => s.key === "draft/boss-2"), "a worker whose name merely starts like the chair's stays");

// Clustering: two tight groups split above their between-group similarity and merge below it.
const vecs = [[1, 0, 0], [0.99, 0.1, 0], [0, 1, 0], [0.1, 0.99, 0]];
assert.deepEqual(new Set(cluster(vecs, 0.9)).size, 2);
assert.deepEqual(new Set(cluster(vecs, 0.05)).size, 1);
const pa = pairAgreement(["A", "A", "B", "B"], ["x", "x", "y", "y"]);
assert.equal(pa.f1, 1); assert.equal(pa.rand, 1);
assert.equal(pairAgreement(["A", "A", "B"], ["x", "x", "x"]).rand, 1 / 3, "merging everything gets only the same-framing pair right");

console.log("framing-width-regression: OK");
