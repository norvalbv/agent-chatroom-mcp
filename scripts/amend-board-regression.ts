/**
 * amend edits a board entry in place (evidence-pack item 3 "Misuse: seats call amend as if it edited a board entry";
 * claim/amend-board-entry). Of 61 refused amends in 15 rooms since 2026-10-10, 30 came when no proposal had ever been
 * made in the room, and 27 of those 30 were followed within 90 s by the same seat's board_set of the whole entry
 * (ledger, position, results, prereg/*: median 2,705 chars, 81,657 chars resent in all; /tmp/c1/amend2.mjs). The seats
 * were asking for a find/replace on a board entry and the hub had none. Now amend, given a board key instead of a
 * proposal id, edits that entry through the board's own rules and posts the diff; an id that is neither says both.
 * Red on main: "No proposal ..." for a board key.
 * Run: npx tsx scripts/amend-board-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub, HubError } from "../src/hub.js";

const LEDGER = "LEDGER\nT-B1-4 fill factor 0.62, rerun pending\nT-B1-5 wide book: reward not paid\n" + "row filler line that makes the entry long enough to matter\n".repeat(30);

function setup(dataDir?: string) {
  const hub = new Hub({ dataDir });
  const a = hub.join("ab-room", "A", "test", { nudgeAfterMs: 0 }, undefined, "s1").participant;
  const b = hub.join("ab-room", "B", "test", {}, undefined, "s2").participant;
  hub.setBoard("ab-room", a.id, "ledger", LEDGER);
  return { hub, a, b, room: hub.getRoom("ab-room") };
}
type WithBoardAmend = Hub & { amendBoard?: (room: string, pid: string, key: string, find: string, replace: string, replaceAll?: boolean) => { key: string; chars: number; diff: string } };

test("amend with a board key replaces one passage of that entry and posts the diff, not the entry", () => {
  const { hub, a, room } = setup();
  const h = hub as WithBoardAmend;
  assert.equal(typeof h.amendBoard, "function", "the hub can amend a board entry");
  const before = room.messages.length;
  const out = h.amendBoard!("ab-room", a.id, "ledger", "fill factor 0.62, rerun pending", "fill factor 0.58 after rerun");
  assert.equal(out.key, "ledger");
  const text = room.board.get("ledger")!.text;
  assert.ok(text.includes("T-B1-4 fill factor 0.58 after rerun\n"), "the passage is replaced in place");
  assert.ok(text.includes("T-B1-5 wide book: reward not paid"), "the rest of the entry is untouched");
  assert.equal(text.length, LEDGER.length - "fill factor 0.62, rerun pending".length + "fill factor 0.58 after rerun".length);
  assert.match(out.diff, /"fill factor 0\.62, rerun pending" → "fill factor 0\.58 after rerun"/);
  const said = room.messages.slice(before).map((m) => m.content).join("\n");
  assert.match(said, /ledger/, "the room gets a board notice naming the key");
  assert.ok(said.length < 600, "and never the whole entry");
});

test("empty find appends, replace_all swaps, and the board's rules still apply", () => {
  const { hub, a, b, room } = setup();
  const h = hub as WithBoardAmend;
  h.amendBoard!("ab-room", a.id, "ledger", "", "T-B1-6 entrants 45d: 3 of 3");
  assert.ok(room.board.get("ledger")!.text.endsWith("\nT-B1-6 entrants 45d: 3 of 3"));
  h.amendBoard!("ab-room", a.id, "ledger", "", "LEDGER v2\nall rows moved to ledger-2", true);
  assert.equal(room.board.get("ledger")!.text, "LEDGER v2\nall rows moved to ledger-2");
  // someone else's entry: the same ownership rule as board_set, typed
  assert.throws(() => h.amendBoard!("ab-room", b.id, "ledger", "LEDGER v2", "LEDGER v3"), (e: unknown) => e instanceof HubError && e.code === "ownership");
  // a find that is absent or ambiguous is refused with the amend-find code and the closest passage
  assert.throws(() => h.amendBoard!("ab-room", a.id, "ledger", "no such passage here", "x"), (e: unknown) => e instanceof HubError && e.code === "amend-find" && /closest passage/.test(e.message));
  hub.setBoard("ab-room", a.id, "twice", "same words here and the same words here");
  assert.throws(() => h.amendBoard!("ab-room", a.id, "twice", "same words here", "x"), (e: unknown) => e instanceof HubError && e.code === "amend-find");
  // the size cap is the board's
  assert.throws(() => h.amendBoard!("ab-room", a.id, "ledger", "", "x".repeat(9000)), (e: unknown) => e instanceof HubError && e.code === "size");
});

test("an id that is neither a proposal nor a board key says what amend edits, and the edit is logged", () => {
  const dir = mkdtempSync(join(tmpdir(), "amend-board-"));
  const { hub, a } = setup(dir);
  const h = hub as WithBoardAmend;
  assert.throws(() => hub.amend("ab-room", a.id, "results", "a", "b"), (e: unknown) => e instanceof HubError && e.code === "not-found" && /board entry/.test(e.message) && /ledger/.test(e.message),
    "the refusal names the board keys the seat may have meant");
  h.amendBoard!("ab-room", a.id, "ledger", "rerun pending", "rerun done");
  const ev = readFileSync(join(dir, "ab-room.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.type === "board_edit");
  assert.ok(ev, "a board_edit event is logged");
  assert.equal(ev.key, "ledger");
  assert.equal(ev.sent_chars, "rerun pending".length + "rerun done".length, "what the seat had to send");
  assert.ok(ev.entry_chars > 1500, "against what a whole-entry board_set would have resent");
});

test("a replacement is taken literally: $$, $& and $1 are stored as written, in an entry and in a proposal", () => {
  // review/ba71f1ef finding (claude-opus-5-5-2): String.replace reads $-sequences in a replacement string
  const { hub, a, b, room } = setup();
  const h = hub as WithBoardAmend;
  hub.setBoard("ab-room", a.id, "cmds", "run: PENDING1\ncost: PENDING2 per call");
  h.amendBoard!("ab-room", a.id, "cmds", "PENDING1", "kill $$ && echo $& and $1");
  h.amendBoard!("ab-room", a.id, "cmds", "PENDING2", "$0.064");
  assert.equal(room.board.get("cmds")!.text, "run: kill $$ && echo $& and $1\ncost: $0.064 per call");
  void b;
  const fresh = new Hub(); // a room with no board entries, so propose is not held once for unexamined findings
  const p1 = fresh.join("ab-prop", "A", "test", { nudgeAfterMs: 0 }, undefined, "s1").participant;
  fresh.join("ab-prop", "B", "test", {}, undefined, "s2");
  const pr = fresh.propose("ab-prop", p1.id, "Grouped runs paid PRICE per model request in the records.");
  fresh.amend("ab-prop", p1.id, pr.id, "PRICE", "$0.064 (not $$ or $&)");
  assert.equal(pr.text, "Grouped runs paid $0.064 (not $$ or $&) per model request in the records.");
});
