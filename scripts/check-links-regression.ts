/**
 * A checking entry is linked to the entry it checks, by the hub and by the runs table alike (evidence-pack item 4 and
 * caution 3, telemetry gap G3). Research rooms check results, not commits, and they name the check after the result in
 * whatever vocabulary the room invents: rerun/T-B3-2-by-break-claude-2 for result/T-B3-2-unconditional-entrants,
 * audit/Q4-partA and valid/Q4-strip for exp/Q4, attack/result/<slug>. The hub linked none of them, and the runs table's
 * "reviewed" column knew only result/<slug> + <prefix>/<slug>: 1 of 56 results in swarm-100951-0btz, where a hand count
 * with a looser match found 15. Of 169 audit/rerun/critique/valid entries in the records since 2026-10-10, the key
 * alone resolves 89 and the entry's text names a board key for 56 more. One resolver (src/hub/checks.ts) now serves
 * the hub (a `check` event and the entry's checks) and the runs table.
 * Run: npx tsx --test scripts/check-links-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hub } from "../src/hub.js";
import { checksOf } from "../src/hub/checks.js";
import { runRow } from "../src/run-timeline.js";

const BOARD: [string, { by: string }][] = [
  ["result/T-B3-2-unconditional-entrants", { by: "break-1" }],
  ["result/T-B3-1-entrants-by-first-deposit", { by: "break-1" }],
  ["result/negrisk-sum-arb", { by: "opus-1" }],
  ["exp/Q4", { by: "seat-a" }], ["exp/H2", { by: "seat-a" }], ["exp/H2-ordering", { by: "seat-a" }],
  ["claim/bench", { by: "seat-a" }], ["take/bench", { by: "seat-a" }], ["rerun/older", { by: "seat-z" }],
];
const of = (key: string, by: string, text = "") => checksOf(key, by, text, BOARD).map((l) => `${l.of} (${l.how})`);

test("the key shapes rooms really used resolve to the entry they check", () => {
  assert.deepEqual(of("attack/result/negrisk-sum-arb", "opus-3"), ["result/negrisk-sum-arb (key)"]);
  assert.deepEqual(of("rerun/negrisk-sum-arb-opus3", "opus-3"), ["result/negrisk-sum-arb (segment)"]);
  assert.deepEqual(of("audit/result-negrisk-sum-arb", "opus-3", "also compared with exp/Q4"), ["result/negrisk-sum-arb (key)"], "the key with its slash as a dash; the stronger rule wins over a key merely named in the text");
  assert.deepEqual(of("rerun/T-B3-2-by-break-claude-2", "break-claude-2"), ["result/T-B3-2-unconditional-entrants (segment)"]);
  assert.deepEqual(of("audit/Q4-partA", "seat-b"), ["exp/Q4 (segment)"]);
  assert.deepEqual(of("valid/Q4-strip", "seat-b"), ["exp/Q4 (segment)"]);
  assert.deepEqual(of("audit/H2-ordering-sample20", "seat-b"), ["exp/H2-ordering (segment)"], "the longest matching entry, not exp/H2 as well");
  assert.deepEqual(checksOf("audit/Q4-partA", "seat-b", "", [["prereg/Q4", { by: "seat-a" }], ["exp/Q4", { by: "seat-a" }]]).map((l) => l.of), ["prereg/Q4", "exp/Q4"], "plan and result share an id: linked to both, not to a guess");
  assert.deepEqual(checksOf("audit/Q4-partA", "seat-b", "second audit of exp/Q4 Part B; prereg unchanged", [["prereg/Q4", { by: "seat-a" }], ["exp/Q4", { by: "seat-a" }]]).map((l) => l.of), ["exp/Q4"], "the check's own text says which of the entries sharing the id it is about");
  assert.deepEqual(checksOf("audit/H4", "seat-b", "audit of evidence/H4-interop, zero-LLM part", [["benchqueue/H4", { by: "seat-a" }], ["evidence/H4-interop", { by: "seat-a" }]]).map((l) => l.of), ["evidence/H4-interop"], "the text names the entry the key fits less closely: the text decides");
  const pair: [string, { by: string }][] = [["exp/Q1", { by: "seat-a" }], ["exp/Q11", { by: "seat-a" }], ["result/audited-carry", { by: "seat-a" }]];
  assert.deepEqual(checksOf("audit/final", "seat-b", "exp/Q11's taxonomy: I confirmed the file. seat-c broke it (attack/result/audited-carry).", pair).map((l) => l.of), ["exp/Q11"], "a key is named only as a whole key: not exp/Q1 inside exp/Q11, not result/x inside attack/result/x");
  assert.deepEqual(of("critique/round-2", "seat-b", "I reran exp/Q4 and result/negrisk-sum-arb; the second does not hold."), ["exp/Q4 (text)", "result/negrisk-sum-arb (text)"]);
});

test("what is not a check: your own entry, coordination keys, other checks, a non-checking prefix, nothing named", () => {
  assert.deepEqual(of("rerun/negrisk-sum-arb-again", "opus-1"), [], "rerunning your own result is not a check by another seat");
  assert.deepEqual(of("audit/bench", "seat-b", "claim/bench and take/bench look stale"), [], "claims and takes are not results");
  assert.deepEqual(of("critique/older", "seat-b"), [], "a check of a check is not linked");
  assert.deepEqual(of("evidence/Q4-notes", "seat-b", "about exp/Q4"), [], "evidence/ is not a checking prefix");
  assert.deepEqual(of("audit/unrelated", "seat-b", "nothing here names an entry"), []);
  const head = JSON.stringify({ proposal: "pending", command: "x", cwd: "/w", base_commit: "0123abc", base_exit_code: 1, commit: "a1b2c3d4", exit_code: 0, output_tail: "ok" });
  assert.deepEqual(of("review/a1b2c3d4", "seat-b", `${head}\nalso read exp/Q4`), [], "a headed review is a review of its commit (the review event), not of a board entry");
});

test("the hub logs the link when the check is written and keeps it on the entry", (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "check-links-"));
  const hub = new Hub({ dataDir });
  const a = hub.join("cl", "Alice", "claude", { nudgeAfterMs: 0 }, undefined, "s-a").participant;
  const b = hub.join("cl", "Bob", "claude", {}, undefined, "s-b").participant;
  const room = hub.getRoom("cl");
  t.after(() => { clearTimeout(room.nudgeTimer); clearTimeout(room.openingsTimer); });
  hub.setBoard("cl", a.id, "exp/Q4", "Q4: the strip arm beats control by 3.1 points on the held-out tasks");
  hub.setBoard("cl", b.id, "audit/Q4-partA", "reran the strip arm on 20 tasks: 2.8 points, same direction");
  hub.setBoard("cl", b.id, "evidence/notes", "unrelated notes");
  assert.deepEqual(room.board.get("audit/Q4-partA")!.checks, ["exp/Q4"]);
  assert.equal(room.board.get("evidence/notes")!.checks, undefined);
  const events = readFileSync(join(dataDir, "cl.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type === "check");
  assert.deepEqual(events.map((e) => [e.key, e.by, e.of, e.how]), [["audit/Q4-partA", "Bob", ["exp/Q4"], "segment"]]);
  assert.deepEqual((hub.summary(room, true).board as Record<string, { checks?: string[] }>)["audit/Q4-partA"].checks, ["exp/Q4"], "the dashboard's board carries it");
});

test("the runs table's reviewed column uses the same resolver", () => {
  const at = (s: number) => new Date(Date.parse("2026-10-11T18:00:00Z") + s * 1000).toISOString();
  const board = (key: string, by: string, s: number, text = "x".repeat(60)) => ({ type: "board", room: "r", key, entry: { text, by, updatedAt: at(s) } });
  const log = [
    { type: "room", room: "r", opts: { topic: "t" }, createdAt: at(0) },
    board("result/T-B3-2-unconditional-entrants", "break-1", 10),
    board("result/negrisk-sum-arb", "break-1", 20),
    board("result/never-checked", "break-1", 30),
    board("rerun/T-B3-2-by-break-claude-2", "break-claude-2", 600), // 0 of 3 under the old <prefix>/<slug> rule
    board("attack/result/negrisk-sum-arb", "break-claude-2", 660),
  ];
  const row = runRow(log as never);
  assert.deepEqual([row.results, row.reviewed, row.entriesChecked], [3, 2, 2]);
});
