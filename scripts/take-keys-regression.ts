/**
 * Who has taken what, as data (swarm-003601-tky5, board evidence/taken-work-as-data and idea/take-keys). In three rooms
 * 68 of 94 hand-read take, hand-over and release messages were in chat only: 30 gave work to another seat (a claim/*
 * cannot be written for someone else), 29 were pieces smaller than an area (a claim costs a reviewer and two room
 * messages), 8 were turns on a shared resource. Seats learned an audit was already taken when the board refused their
 * finished write. take/<what> is the small take: one free line, no reviewer; text starting with @name offers it to
 * that seat, who accepts by writing the key or declines by clearing it; a write to a take someone else holds is refused
 * with the holder; room_status lists what each seat holds; every step is a "take" record in the room log.
 * Run: npx tsx scripts/take-keys-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";

const cases: [string, () => Promise<void> | void][] = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

let serial = 0;
function room(opts: { dataDir?: string; anonymous?: boolean } = {}) {
  const h = new Hub({ dataDir: opts.dataDir });
  const name = `take-${++serial}`;
  const [a, b, c] = ["alice", "bob", "carol"].map((n, i) => h.join(name, n, "test", i === 0 && opts.anonymous ? { anonymous: true } : {}, undefined, `sess-${n}`).participant);
  return { h, name, a, b, c };
}
const throws = (run: () => unknown, re: RegExp) => assert.throws(run, (e: Error) => re.test(e.message) || assert.fail(`unexpected message: ${e.message}`));
type Seat = { name: string; holds?: string[]; offered?: { key: string; by: string }[] };
const seat = (h: Hub, name: string, who: string) => (h.summary(h.getRoom(name)).participants as Seat[]).find((p) => p.name === who)!;
const said = (h: Hub, name: string, re: RegExp) => h.getRoom(name).messages.filter((m) => re.test(m.content));

test("a seat takes a piece smaller than an area: one line, no reviewer, listed under its name in room_status", () => {
  const { h, name, a, b } = room();
  const before = h.getRoom(name).messages.length;
  const e = h.setBoard(name, a.id, "take/audit/exp-Q8", "running the audit now")!;
  assert.equal(e.holder, "alice");
  assert.equal(e.reviewer, undefined, "a take assigns no reviewer");
  assert.equal(h.getRoom(name).messages.length - before, 1, "one board notice, nothing else");
  assert.match(h.getRoom(name).messages.at(-1)!.content, /took "take\/audit\/exp-Q8": running the audit now/);
  assert.deepEqual(seat(h, name, "alice").holds, ["take/audit/exp-Q8"]);
  assert.equal(seat(h, name, "bob").holds, undefined, "a seat holding nothing carries no field");
  h.setBoard(name, b.id, "take/final-table", "plain text, not JSON");
  assert.deepEqual(seat(h, name, "bob").holds, ["take/final-table"]);
});

test("holds lists the seat's live claims too, so who holds what is one field whichever prefix a seat picked", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "claim/jobs-5-8", JSON.stringify({ area: "jobs 5-8", owner: "alice", status: "open" }));
  h.setBoard(name, a.id, "take/J1", "doing J1 now");
  assert.deepEqual(seat(h, name, "alice").holds, ["claim/jobs-5-8", "take/J1"]);
  assert.equal(seat(h, name, "bob").holds, undefined);
  h.leave(name, a.id, "done here, nothing left undone");
  assert.deepEqual(seat(h, name, "alice").holds, ["claim/jobs-5-8", "take/J1"], "a departed seat still shows what it held: its successor may take it (stale_claims)");
});

test("a second seat is told who holds it before it does the work; overwrite does not get past", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "take/audit/exp-Q8", "running the audit now");
  throws(() => h.setBoard(name, b.id, "take/audit/exp-Q8", "I audit Q8"), /"take\/audit\/exp-Q8" is held by alice since .*: "running the audit now"/);
  throws(() => h.setBoard(name, b.id, "take/audit/exp-Q8", "I audit Q8", { overwrite: true }), /is held by alice/);
  throws(() => h.setBoard(name, b.id, "take/audit/exp-Q8", ""), /is held by alice/);
  assert.deepEqual(seat(h, name, "alice").holds, ["take/audit/exp-Q8"]);
});

test("a seat gives work to another: the entry is offered, the seat is told by name, and it accepts by writing the key", () => {
  const { h, name, a, b, c } = room();
  const e = h.setBoard(name, a.id, "take/Q11", "@bob not started, Q11 is yours")!;
  assert.deepEqual([e.holder, e.offeredBy], ["bob", "alice"]);
  const notice = said(h, name, /^@bob alice offers you "take\/Q11"/)[0];
  assert.ok(notice, "the seat it is offered to gets an @-notice");
  assert.equal(notice.kind, "chat", "chat kind so the @-mention wakes a held wait");
  assert.match(notice.content, /board_set\(key="take\/Q11"/, "the notice names the call that accepts it");
  assert.deepEqual(seat(h, name, "bob").offered, [{ key: "take/Q11", by: "alice" }]);
  assert.equal(seat(h, name, "bob").holds, undefined, "offered is not held");
  assert.equal(seat(h, name, "alice").holds, undefined);
  throws(() => h.setBoard(name, c.id, "take/Q11", "mine"), /is offered to bob by alice/);
  const taken = h.setBoard(name, b.id, "take/Q11", "started")!;
  assert.deepEqual([taken.holder, taken.offeredBy], ["bob", undefined]);
  assert.deepEqual(seat(h, name, "bob").holds, ["take/Q11"]);
  assert.equal(seat(h, name, "bob").offered, undefined);
  throws(() => h.setBoard(name, a.id, "take/Q11", "taking it back"), /is held by bob/);
});

test("an offer can be declined by the seat or withdrawn by the offerer, and the offerer hears a decline", () => {
  const { h, name, a, b, c } = room();
  h.setBoard(name, a.id, "take/Q11", "@bob yours");
  h.setBoard(name, b.id, "take/Q11", "");
  assert.equal(h.getRoom(name).board.has("take/Q11"), false);
  assert.ok(said(h, name, /^@alice bob declined "take\/Q11"/)[0], "the offerer is told");
  h.setBoard(name, a.id, "take/Q11", "@bob yours");
  h.setBoard(name, a.id, "take/Q11", "@carol yours instead");
  assert.deepEqual(seat(h, name, "carol").offered, [{ key: "take/Q11", by: "alice" }]);
  assert.equal(seat(h, name, "bob").offered, undefined);
  h.setBoard(name, a.id, "take/Q11", "");
  assert.equal(h.getRoom(name).board.has("take/Q11"), false);
  throws(() => h.setBoard(name, a.id, "take/Q12", "@nobody-here yours"), /no active seat named "nobody-here"/);
  h.setBoard(name, c.id, "take/Q12", "@carol I do it myself");
  assert.deepEqual(seat(h, name, "carol").holds, ["take/Q12"], "naming yourself is a plain take");
});

test("a holder hands over, releases, or leaves: the take moves or opens", () => {
  const { h, name, a, b, c } = room();
  h.setBoard(name, a.id, "take/benchlock", "5-task pilot");
  h.setBoard(name, a.id, "take/benchlock", "@bob done, your turn");
  assert.deepEqual(seat(h, name, "bob").offered, [{ key: "take/benchlock", by: "alice" }]);
  h.setBoard(name, b.id, "take/benchlock", "running");
  h.setBoard(name, b.id, "take/benchlock", "");
  assert.equal(h.getRoom(name).board.has("take/benchlock"), false, "the holder releases by clearing");
  h.setBoard(name, c.id, "take/benchlock", "mine now");
  h.leave(name, c.id, "done here, nothing left undone");
  const e = h.setBoard(name, a.id, "take/benchlock", "carol left; I take it")!;
  assert.equal(e.holder, "alice", "a take whose holder has left is open to anyone");
});

test("an anonymous room shows and accepts the labels, not the names", () => {
  const { h, name, a, b } = room({ anonymous: true });
  const label = (who: string) => h.shown(h.getRoom(name), h.getRoom(name).participants.get(who)!);
  h.setBoard(name, a.id, "take/Q1", `@${label(b.id).split(" ").at(-1)} yours`);
  assert.ok(said(h, name, new RegExp(`^@${label(b.id)} ${label(a.id)} offers you`))[0] ?? said(h, name, /offers you/)[0]);
  const s = (h.summary(h.getRoom(name)).participants as Seat[]).find((p) => p.offered);
  assert.deepEqual(s?.offered, [{ key: "take/Q1", by: label(a.id) }]);
  assert.equal(s?.name, label(b.id));
});

test("every step is a take record in the room log, refusals included", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "take-keys-"));
  const { h, name, a, b, c } = room({ dataDir });
  h.setBoard(name, a.id, "take/Q11", "@bob yours");
  throws(() => h.setBoard(name, c.id, "take/Q11", "mine"), /is offered to bob/);
  h.setBoard(name, b.id, "take/Q11", "started");
  h.setBoard(name, b.id, "take/Q11", "half done");
  h.setBoard(name, b.id, "take/Q11", "");
  h.setBoard(name, c.id, "take/Q11", "now mine");
  const log = readdirSync(dataDir).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readFileSync(join(dataDir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; action?: string; key?: string; by?: string; holder?: string }));
  const takes = log.filter((e) => e.type === "take");
  assert.deepEqual(takes.map((e) => [e.action, e.by, e.holder]), [
    ["offer", "alice", "bob"], ["refused", "carol", "bob"], ["accept", "bob", "bob"], ["update", "bob", "bob"], ["release", "bob", "bob"], ["take", "carol", "carol"],
  ]);
  assert.ok(takes.every((e) => e.key === "take/Q11"));
  // a restart reads the log back: the holder survives
  const again = new Hub({ dataDir });
  assert.equal(again.getRoom(name).board.get("take/Q11")?.holder, "carol");
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).message.split("\n")[0]}`);
  }
}
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nTAKE KEYS OK (${cases.length} cases)`);
process.exit(failed ? 1 : 0);
