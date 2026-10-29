/** scripts/opening-spread.ts over a fixture log, with fixed vectors in place of the embedder: only openings sealed
 * before the reveal count, a re-submission keeps its last text, verifier/chair/human seats are left out, seat-target
 * source is read from the log, and the spread numbers are exact on known geometry.
 *   npx tsx scripts/opening-spread-regression.ts */
import assert from "node:assert/strict";
import { effectiveRank, fitCut, framingsAt, mixOf, openingsOf, samplePairs, spreadOf } from "./opening-spread.ts";

const join = (id: string, name: string, agent: string, role?: string) => ({ type: "join", room: "r", p: { id, name, agent, ...(role ? { role } : {}) } });
const open = (pid: string, content: string) => ({ type: "opening", room: "r", pid, content });
const base = (room: string, createdAt: string, topic: string) => [
  { type: "room", room, createdAt, opts: { topic } },
  join("p1", "w1", "claude"), join("p2", "w2", "codex"), join("p3", "w3", "claude"),
  join("pv", "verifier", "claude", "verifier"), join("ph", "benji", "human"), join("pr", "late", "codex", "recruit"),
];
const events = [
  ...base("swarm-101010-abcd-room", "2026-10-20T10:00:00Z", "GOAL\n1. first item.\n2. second item.\n"),
  open("p1", "draft one"), open("p1", "seat one, final"), open("p2", "seat two"), open("p3", "seat three"),
  open("pv", "verifier prior"), open("ph", "human view"),
  { type: "openings_revealed", room: "r" },
  open("pr", "a recruit after the reveal"),
  { type: "state", room: "r", state: "concluded", conclusion: { text: "done" } },
];
const r = openingsOf(events, "swarm-101010-abcd-room");
assert.deepEqual(r.openings.map((o) => [o.pid, o.text]), [["p1", "seat one, final"], ["p2", "seat two"], ["p3", "seat three"]], JSON.stringify(r.openings));
assert.equal(r.concluded, true);
assert.equal(r.targets, "numbered", "a flat swarm room after e195b571 with a numbered brief");
assert.equal(openingsOf(events, "swarm-101010-abcd-room", true).openings.length, 4, "--all-roles adds the verifier, never the human");
const before = [...base("swarm-101010-abcd-room", "2026-10-01T10:00:00Z", "1. a.\n2. b.\n"), open("p1", "x"), { type: "openings_revealed" }];
assert.equal(openingsOf(before, "swarm-101010-abcd-room").targets, "none", "before seat targets existed");
const group = [...base("swarm-101010-abcd-leads", "2026-10-20T10:00:00Z", "1. a.\n2. b.\n"), open("p1", "x"), { type: "openings_revealed" }];
assert.equal(openingsOf(group, "swarm-101010-abcd-leads").targets, "none", "a group room is not flat");
const item = [...base("swarm-101010-abcd-room", "2026-10-20T10:00:00Z", "goal"), { type: "board", key: "item/x", entry: { text: "x" } }, open("p1", "x"), { type: "openings_revealed" }];
assert.equal(openingsOf(item, "swarm-101010-abcd-room").targets, "item");
assert.equal(openingsOf(before, "trial-before-gate").targets, "adhoc");
const groupItems = [...base("swarm-101010-abcd-whiskas", "2026-10-20T10:00:00Z", "goal"), { type: "board", key: "item/x", entry: { text: "x" } }, open("p1", "x"), { type: "openings_revealed" }];
assert.equal(openingsOf(groupItems, "swarm-101010-abcd-whiskas").targets, "none", "a group room's item/* entries are not dealt to seats");
assert.equal(mixOf(["claude", "codex", "claude"]), "mixed(claude+codex)");
assert.equal(mixOf(["codex", "codex"]), "codex");

// geometry: one direction -> effective rank 1; orthonormal rows -> n
const e = (i: number, d = 4) => Array.from({ length: d }, (_, k) => (k === i ? 1 : 0));
const cosOf = (vs: number[][]) => vs.map((a) => vs.map((b) => a.reduce((s, x, k) => s + x * b[k]!, 0) / Math.sqrt(a.reduce((s, x) => s + x * x, 0) * b.reduce((s, x) => s + x * x, 0))));
assert.ok(Math.abs(effectiveRank(cosOf([e(0), e(0), e(0)])) - 1) < 1e-6, "three copies have effective rank 1");
assert.ok(Math.abs(effectiveRank(cosOf([e(0), e(1), e(2)])) - 3) < 1e-6, "three orthogonal openings have effective rank 3");
const near = [[1, 0.1, 0, 0], [1, 0, 0.1, 0], [0, 0, 0, 1]];
assert.equal(framingsAt(cosOf(near), 0.9), 2, "two near-copies and one apart are two framings");
assert.equal(framingsAt(cosOf(near), 0.999), 3);
const s = spreadOf(r, near, 0.9);
assert.equal(s.seats, 3); assert.equal(s.framings, 2); assert.equal(s.one_framing, false); assert.equal(s.mix, "mixed(claude+codex)");
assert.equal(s.min_cos, 0);
assert.ok(s.eff_rank > 2.2 && s.eff_rank < 2.3, `singular values ~1.41, 1, 0.1 give 2.27: ${s.eff_rank}`);

// the cut: separable labels give AUROC 1 and a cut at the lowest same pair; mixed/unknown are left out
const fit = fitCut([{ cos: 0.9, label: "same" }, { cos: 0.85, label: "same" }, { cos: 0.6, label: "different" }, { cos: 0.7, label: "different" }, { cos: 0.95, label: "mixed" }, { cos: 0.1, label: "unknown" }]);
assert.deepEqual([fit.n_same, fit.n_different, fit.auroc, fit.cut, fit.youden_j], [2, 2, 1, 0.85, 1], JSON.stringify(fit));
const tied = fitCut([{ cos: 0.8, label: "same" }, { cos: 0.8, label: "different" }]);
assert.equal(tied.auroc, 0.5, "a tie counts half");

// the blind sheet: deterministic, one pair per room, two distinct seats, no cosine in it
const rooms = ["a", "b", "c", "d"].map((n) => ({ ...r, room: n }));
const sheet = samplePairs(rooms, 3, 7);
assert.deepEqual(sheet, samplePairs(rooms, 3, 7));
assert.equal(new Set(sheet.map((p) => p.room)).size, 3);
assert.ok(sheet.every((p) => p.a !== p.b && !("cos" in p)));

console.log("opening-spread-regression: OK");
