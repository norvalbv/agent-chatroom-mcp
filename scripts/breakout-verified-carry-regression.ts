/**
 * A breakout's conclusion reaches its parent with what was verified in it (server chair note 4, swarm-164210-9f66,
 * evidence/breakout-verification). All five 9f66 breakouts concluded with a non-author fail-to-pass verify entry, and
 * four of them said which cited commits nobody checked. The note the parent got (inbox/<child>/conclusion, written by
 * carryConclusion) carried the tally and the text but none of that. So the parent's verifier, which had no other way
 * to see it, reran bk2, bk4 and bk5 from its own data: all three came back byte-identical, at $8.03 against
 * $3.55-6.12 for each other seat. Its one catch was the parent's own copy dropping a bk2 caveat.
 * The note now leads with the same lines the breakout's conclusion notice has: who verified, what kind, base to
 * commit, what the reviewer did not show, and which cited commits nobody checked. A breakout that did not require
 * verification says so. Nothing else in carryConclusion changes; breakout-fate owns its guard and its event.
 * Run: npx tsx --test scripts/breakout-verified-carry-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub } from "../src/hub.js";

const PARENT = "swarm-000004-bvc-room";
const CHILD = "swarm-000004-bvc-bk2";
const TEXT = "bk2: NO busy-evening filter is adopted (F1 t 1.76 held out); F1's skipped 91% made +2.13c (t 4.7).";
const QUOTE = "NO busy-evening filter is adopted";
const head = (proposal: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({ proposal, command: "python3 grade.py --held-out", cwd: "/repo", base_commit: "af5450e", base_exit_code: 1, commit: "febdf3e", exit_code: 0, output_tail: "F1 t 1.76", kind: "own_check", ...over });

function rooms(requireVerification: boolean, dataDir?: string) {
  const hub = new Hub({ dataDir });
  const opts = { requireChallenge: false, nudgeAfterMs: 0, quorum: "majority" as const };
  hub.join(PARENT, "A", "test", opts, undefined, "s1");
  hub.join(PARENT, "B", "test", {}, undefined, "s2");
  const a = hub.join(CHILD, "A", "test", { parent: PARENT, requireChallenge: false, quorum: "majority", requireVerification }, undefined, "s1").participant;
  const b = hub.join(CHILD, "B", "test", {}, undefined, "s2").participant;
  if (requireVerification) hub.setBoard(CHILD, a.id, "verify/own-run", "the author's own run of grade.py");
  const pr = hub.propose(CHILD, a.id, TEXT);
  const conclude = () => {
    for (const id of [a.id, b.id]) hub.vote(CHILD, id, pr.id, "agree", undefined, undefined, QUOTE);
    assert.equal(hub.getRoom(CHILD).state, "concluded");
    const entry = hub.getRoom(PARENT).board.get(`inbox/${CHILD}/conclusion`);
    assert.ok(entry, "carried to the parent");
    for (const r of [PARENT, CHILD]) clearTimeout(hub.getRoom(r).nudgeTimer), clearTimeout(hub.getRoom(r).openingsTimer);
    return entry!.text;
  };
  return { hub, a, b, pr, conclude };
}

test("the parent's note names who verified the breakout, the kind and base to commit, before the text", () => {
  const { hub, b, pr, conclude } = rooms(true);
  hub.setBoard(CHILD, b.id, "verify/held-out", head(pr.id));
  const text = conclude();
  const lines = text.split("\n");
  assert.match(lines[0], new RegExp(`^Breakout ${CHILD} concluded on ${pr.id} v1 .*whole text: room_status room="${CHILD}"`), "the pointer still leads");
  assert.equal(lines[1], "Verified by B (verify/held-out), kind own_check: the check failed at af5450e and passes at febdf3e.");
  assert.ok(text.indexOf("Verified by") < text.indexOf(TEXT), "read before the text, so a cut cannot drop it");
});

test("what the breakout's reviewer did not show, and cited commits nobody checked, reach the parent too", () => {
  const { hub, a, b, conclude } = rooms(true);
  const pr = hub.getRoom(CHILD).proposals.values().next().value!;
  hub.amend(CHILD, a.id, pr.id, "(t 4.7).", "(t 4.7). Graded at febdf3e and 0914e5e.");
  hub.setBoard(CHILD, b.id, "verify/held-out", head(pr.id, { unverified: ["the rec25 recording, not rerun"] }));
  const text = conclude();
  assert.match(text, /\nVerified PARTIAL, not shown by the reviewer: verify\/held-out \(B\): the rec25 recording, not rerun/);
  assert.match(text, /\nCited but checked by no verify entry: 0914e5e\./);
});

test("a breakout that did not require verification says so in the parent's note", () => {
  const { conclude } = rooms(false);
  const lines = conclude().split("\n");
  assert.match(lines[1], /^Not verified by the hub: this breakout did not require a verify\/\* entry\.$/);
  assert.equal(lines[2], TEXT);
});

test("a text past the board cap keeps the verification line; the cut falls on the text", () => {
  const { hub, a, b, conclude } = rooms(true);
  const pr = hub.getRoom(CHILD).proposals.values().next().value!;
  hub.amend(CHILD, a.id, pr.id, "(t 4.7).", `(t 4.7). ${"detail ".repeat(1400)}DECISIVE SUFFIX`);
  hub.setBoard(CHILD, b.id, "verify/held-out", head(pr.id));
  const text = conclude();
  assert.ok(text.length <= 8000, `${text.length} chars`);
  assert.equal(text.split("\n")[1], "Verified by B (verify/held-out), kind own_check: the check failed at af5450e and passes at febdf3e.");
  assert.match(text, /\[cut at the board cap: \d+ chars in all/);
});

test("telemetry: breakout-carry reads, per carried note, whether the breakout's verification reached the parent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "breakout-verified-carry-"));
  try {
    const { hub, b, pr, conclude } = rooms(true, dir);
    hub.setBoard(CHILD, b.id, "verify/held-out", head(pr.id));
    conclude();
    const { carryRows } = await import("./breakout-carry.js");
    const rows = await carryRows([join(dir, `${PARENT}.jsonl`), join(dir, `${CHILD}.jsonl`)]);
    assert.deepEqual(rows, [{ parent: PARENT, breakout: CHILD, breakout_verified: "B, own_check, af5450e->febdf3e", note_says: "verified", lost: false }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("telemetry reads the note's head, not a line in the breakout's text that starts \"Verified by\" (review/c2933768 N3)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "breakout-verified-carry-"));
  try {
    const { hub, a, conclude } = rooms(false, dir);
    const pr = hub.getRoom(CHILD).proposals.values().next().value!;
    hub.amend(CHILD, a.id, pr.id, "(t 4.7).", "(t 4.7).\nVerified by the grader on the held-out half.");
    conclude();
    const { carryRows } = await import("./breakout-carry.js");
    const rows = await carryRows([join(dir, `${PARENT}.jsonl`), join(dir, `${CHILD}.jsonl`)]);
    assert.deepEqual(rows.map((r) => r.note_says), ["not required"], "line 2 says the breakout did not require verification");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
