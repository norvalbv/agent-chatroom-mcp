/**
 * What happens to a breakout (server-chair note 6, swarm-164210-9f66: "Benji had to ask what would happen to them";
 * decision/breakout-fate, evidence/breakout-fate: 36 breakouts in 332 room logs).
 * - A conclusion the parent can no longer take (parent closed, or past its late window) went nowhere with no event and
 *   no line (hub.ts carryConclusion returned early): it is now said in the breakout and logged, and every carry attempt
 *   is a breakout_carry event (delivered | late | dropped).
 * - Closing a parent left its breakouts open and untold: in 3 of 3 stopped runs (dois, hgmm, kvkj) the chair closed the
 *   parent and all 15 children by hand within the same second. A parent's close now closes its open breakouts,
 *   recursively, each with a reason naming the parent and a parent_closed event; a conclusion still does not.
 * - The archive-dead sweep does not take a parent whose breakout still has seats in it (that close would now cascade).
 * - room_status and GET /rooms give a breakout one breakout_fate line: where its conclusion goes and until when.
 * - The launcher found breakouts by the run's name prefix only (swarm.ts:877): kcj5's verified, unprefixed breakout
 *   swarm-005617-verdict-telemetry is absent from its result.json. runRooms follows the parent link as well.
 * Run: npx tsx --test scripts/breakout-fate-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Hub } from "../src/hub.js";
import type { Room } from "../src/hub/types.js";

const opts = { requireChallenge: false, expectedParticipants: 2 };
const events = (dir: string, room: string) => readFileSync(join(dir, `${room}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
type Fate = { parent: string; parent_state: string; line: string; carried?: { key: string; late?: boolean }; not_carried?: string; late_until?: string };
const fate = (hub: Hub, r: Room) => (hub.summary(r) as { breakout_fate?: Fate }).breakout_fate;

/** a parent and one breakout, two seats each (Alice sits in both) */
function family(t: { after: (fn: () => void) => void }, dataDir?: string) {
  const hub = new Hub(dataDir ? { dataDir } : {});
  const a = hub.join("bf-parent", "Alice", "test", opts, undefined, "session-a").participant;
  const b = hub.join("bf-parent", "Bob", "test", {}, undefined, "session-b").participant;
  const ca = hub.join("bf-child", "Alice", "test", { ...opts, parent: "bf-parent" }, undefined, "session-a").participant;
  const cc = hub.join("bf-child", "Carol", "test", {}, undefined, "session-c").participant;
  const parent = hub.getRoom("bf-parent"), child = hub.getRoom("bf-child");
  t.after(() => { for (const r of hub.rooms.values()) { clearTimeout(r.nudgeTimer); clearTimeout(r.openingsTimer); } });
  const concludeParent = () => {
    const pr = hub.propose("bf-parent", a.id, "The leads room adopts the table as it stands.");
    hub.vote("bf-parent", b.id, pr.id, "agree", undefined, undefined, "adopts the table as it stands");
    assert.equal(parent.state, "concluded");
  };
  const concludeChild = () => {
    const cp = hub.propose("bf-child", ca.id, "Capacity is 17 diffs per run, measured on the internal set.");
    hub.vote("bf-child", cc.id, cp.id, "agree", undefined, undefined, "Capacity is 17 diffs per run");
    assert.equal(child.state, "concluded");
  };
  return { hub, parent, child, concludeParent, concludeChild };
}

test("a breakout conclusion past the parent's late window is said in the breakout and logged, not dropped silently", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "breakout-fate-"));
  const saved = Hub.LATE_WRITE_MS;
  t.after(() => { Hub.LATE_WRITE_MS = saved; });
  const { child, parent, concludeParent, concludeChild } = family(t, dir);
  concludeParent();
  Hub.LATE_WRITE_MS = 0;
  concludeChild();
  assert.equal(parent.board.get("inbox/bf-child/conclusion"), undefined, "nothing lands after the window");
  const said = child.messages.filter((m) => m.kind === "system").map((m) => m.content).find((c) => /not copied to bf-parent/.test(c));
  assert.ok(said, `the breakout is told its conclusion went nowhere: ${child.messages.at(-1)!.content}`);
  assert.match(said!, /late window/);
  assert.match(said!, /stays in this room only/);
  const carry = events(dir, "bf-child").filter((e) => e.type === "breakout_carry");
  assert.deepEqual(carry.map((e) => [e.parent, e.outcome, e.reason]), [["bf-parent", "dropped", "past_window"]]);
});

test("every carry is logged with its outcome: delivered while the parent is open, late after it concluded", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "breakout-fate-"));
  const one = family(t, dir);
  one.concludeChild();
  assert.ok(one.parent.board.get("inbox/bf-child/conclusion"));
  assert.deepEqual(events(dir, "bf-child").filter((e) => e.type === "breakout_carry").map((e) => [e.parent, e.outcome, e.key]),
    [["bf-parent", "delivered", "inbox/bf-child/conclusion"]]);
  const dir2 = mkdtempSync(join(tmpdir(), "breakout-fate-"));
  const two = family(t, dir2);
  two.concludeParent();
  two.concludeChild();
  const late = events(dir2, "bf-child").filter((e) => e.type === "breakout_carry");
  assert.deepEqual(late.map((e) => [e.outcome, e.key, typeof e.after_s]), [["late", "inbox/bf-child/conclusion", "number"]]);
});

test("closing a parent closes its open breakouts, recursively, says why in each and logs parent_closed; a concluded one is left as it is", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "breakout-fate-"));
  const { hub, parent, child } = family(t, dir);
  hub.join("bf-grandchild", "Carol", "test", { ...opts, parent: "bf-child" }, undefined, "session-c");
  const da = hub.join("bf-done", "Alice", "test", { ...opts, parent: "bf-parent" }, undefined, "session-a").participant;
  const dd = hub.join("bf-done", "Dan", "test", {}, undefined, "session-d").participant;
  const dp = hub.propose("bf-done", da.id, "The cheap path wins on every measured case.");
  hub.vote("bf-done", dd.id, dp.id, "agree", undefined, undefined, "cheap path wins on every");
  const done = hub.getRoom("bf-done"), grand = hub.getRoom("bf-grandchild");
  assert.equal(done.state, "concluded");
  hub.closeRoom("bf-parent", "benji", "owner stopped the run");
  assert.equal(parent.state, "closed");
  assert.equal(child.state, "closed", "the open breakout closes with its parent");
  assert.equal(grand.state, "closed", "and its own breakout with it");
  assert.equal(done.state, "concluded", "a concluded breakout keeps its conclusion");
  assert.match(child.messages.filter((m) => /Room closed by/.test(m.content)).at(-1)!.content, /Room closed by benji: its parent bf-parent was closed \(owner stopped the run\)/);
  assert.match(child.messages.at(-1)!.content, /Open breakout closed with it: bf-grandchild/);
  assert.match(grand.messages.filter((m) => /Room closed by/.test(m.content)).at(-1)!.content, /its parent bf-child was closed/);
  assert.ok(parent.messages.some((m) => /Open breakouts? closed with it: bf-child\./.test(m.content)), "the parent names what closed with it");
  assert.deepEqual(events(dir, "bf-child").filter((e) => e.type === "parent_closed").map((e) => [e.parent, e.by]), [["bf-parent", "benji"]]);
  assert.deepEqual(events(dir, "bf-grandchild").filter((e) => e.type === "parent_closed").map((e) => e.parent), ["bf-child"]);
  assert.equal(events(dir, "bf-done").filter((e) => e.type === "parent_closed").length, 0);
});

test("the archive-dead sweep leaves a parent whose breakout still has seats in it", (t) => {
  const { hub, parent, child } = family(t);
  for (const p of [...parent.participants.values()]) hub.leave("bf-parent", p.id);
  parent.createdAt = child.createdAt = new Date(Date.now() - 11 * 60_000).toISOString();
  assert.deepEqual(hub.archiveDead("benji"), [], "the parent is where the breakout's conclusion goes: not dead while the breakout works");
  assert.throws(() => hub.archiveRoom("bf-parent", "benji"), /open breakout with seats \(bf-child\); close it first/, "archiving it by hand is refused too, rather than closing the breakout with it");
  assert.equal(parent.state, "open");
  assert.equal(child.state, "open");
  for (const p of [...child.participants.values()]) hub.leave("bf-child", p.id);
  assert.deepEqual(hub.archiveDead("benji").sort(), ["bf-child", "bf-parent"]);
});

test("room_status gives a breakout one fate line: where its conclusion goes and until when", (t) => {
  const saved = Hub.LATE_WRITE_MS;
  t.after(() => { Hub.LATE_WRITE_MS = saved; });
  const { hub, parent, child, concludeParent, concludeChild } = family(t);
  assert.equal(fate(hub, parent), undefined, "a room with no parent has no fate line");
  const open = fate(hub, child)!;
  assert.equal(open.parent, "bf-parent");
  assert.equal(open.parent_state, "open");
  assert.match(open.line, /its conclusion is copied to bf-parent as inbox\/bf-child\/conclusion/);
  concludeParent();
  const fixed = fate(hub, child)!;
  assert.equal(fixed.parent_state, "concluded");
  assert.ok(fixed.late_until && Date.parse(fixed.late_until) > Date.now());
  assert.match(fixed.line, /bf-parent concluded at .*its answer is fixed.*marked late, until /);
  Hub.LATE_WRITE_MS = 0;
  assert.match(fate(hub, child)!.line, /late window closed.*stays in this room only/);
  Hub.LATE_WRITE_MS = saved;
  concludeChild();
  const carried = fate(hub, child)!;
  assert.deepEqual(carried.carried && [carried.carried.key, carried.carried.late], ["inbox/bf-child/conclusion", true]);
  assert.match(carried.line, /Concluded; its conclusion was copied to bf-parent as inbox\/bf-child\/conclusion at .*marked late/);
  const listed = hub.listRooms(true).find((r) => r.name === "bf-child") as { breakout_fate?: Fate };
  assert.equal(listed.breakout_fate?.line, carried.line, "GET /rooms carries the same line for the dashboard");
});

test("a breakout that concluded after the window says it was not carried, and why", (t) => {
  const saved = Hub.LATE_WRITE_MS;
  t.after(() => { Hub.LATE_WRITE_MS = saved; });
  const { hub, child, concludeParent, concludeChild } = family(t);
  concludeParent();
  Hub.LATE_WRITE_MS = 0;
  concludeChild();
  const f = fate(hub, child)!;
  assert.equal(f.not_carried, "past_window");
  assert.match(f.line, /Concluded; its conclusion was not copied to bf-parent: bf-parent concluded at .+ and its late window closed at .+ It is in this room only/);
});

test("the carry key is the hub's: a breakout seat cannot post over it, and an entry someone else wrote is not read as the hub's copy (review/09371908 F1)", (t) => {
  const { hub, parent, child, concludeChild } = family(t);
  const carol = [...child.participants.values()].find((p) => p.name === "Carol")!;
  assert.throws(() => hub.postToRoom("bf-child", carol.id, "bf-parent", "conclusion", "my own summary"), /inbox\/bf-child\/conclusion is where the hub copies this room's conclusion.*another key/);
  hub.postToRoom("bf-child", carol.id, "bf-parent", "summary", "my own summary");
  concludeChild();
  const key = "inbox/bf-child/conclusion";
  assert.equal(parent.board.get(key)!.by, "system");
  // someone else's text on the key (only setBoardAs can still write it; 0 of 20 such entries in the records,
  // review/fb9db2b6 point 4): the parent is open, so "not on this hub" would be false
  parent.board.set(key, { ...parent.board.get(key)!, by: "Carol" });
  const f = fate(hub, child)!;
  assert.equal(f.not_carried, undefined);
  assert.doesNotMatch(f.line, /not on this hub/);
  assert.match(f.line, /Concluded; inbox\/bf-child\/conclusion on bf-parent was last written by Carol, not by the hub/);
  // and once the parent is closed: the hub did copy it, so "not copied: closed without a conclusion" would be false too
  // (review/fb9db2b6 N1)
  hub.closeRoom("bf-parent", "chair", "stopped");
  const g = fate(hub, child)!;
  assert.equal(g.not_carried, undefined, "whether the copy was made is in breakout_carry, not on the overwritten key");
  assert.doesNotMatch(g.line, /not copied/);
  assert.match(g.line, /Concluded; inbox\/bf-child\/conclusion on bf-parent was last written by Carol, not by the hub/);
});

test("the launcher's room list follows the parent link, not only the run's name prefix (kcj5's verdict-telemetry)", async () => {
  const { runRooms } = await import("../src/launch/run-rooms.js");
  const all = [
    { name: "swarm-005617-kcj5-room" },
    { name: "swarm-005617-kcj5-telemetry", parent: "swarm-005617-kcj5-room" },
    { name: "swarm-005617-verdict-telemetry", parent: "swarm-005617-kcj5-room" },
    { name: "verdict-sub", parent: "swarm-005617-verdict-telemetry" },
    { name: "someone-elses-room" },
    { name: "swarm-999999-zzzz-room" },
    { name: "swarm-999999-zzzz-x", parent: "swarm-999999-zzzz-room" },
  ];
  const lines: string[] = [];
  assert.deepEqual(runRooms(all, "swarm-005617-kcj5", ["swarm-005617-kcj5-room"], (l) => lines.push(l)).sort(),
    ["swarm-005617-kcj5-telemetry", "swarm-005617-verdict-telemetry", "verdict-sub"]);
  assert.deepEqual(lines, ["breakouts found by parent link, not by name: swarm-005617-verdict-telemetry, verdict-sub"], "the launcher logs what the link found");
  const swarm = readFileSync(resolve(import.meta.dirname, "../src/swarm.ts"), "utf8");
  assert.match(swarm, /groupRooms\.push\(\.\.\.runRooms\(.+, SWARM_ID, \[leadsRoom, \.\.\.groupRooms\], log\)\)/, "swarm.ts gathers rooms with runRooms");
});

test("the dashboard shows the parent, the fate line, a parent's breakouts, and groups an unprefixed breakout with its parent's run", async () => {
  const { UI_HTML } = await import("../src/ui.js");
  const block = (UI_HTML.match(/\/\*fate:start\*\/([\s\S]*?)\/\*fate:end\*\//) ?? ["", ""])[1];
  const runOf = (name: string) => /^(swarm-[0-9]{6}(?:-[a-z0-9]{4})?)-/.exec(name)?.[1] ?? null;
  const ui = new Function("runOf", `${block}; return { roomRun, fateChips, fateLine, closeWords };`)(runOf);
  const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const rooms = [
    { name: "swarm-005617-kcj5-room", breakouts: [{ room: "swarm-005617-verdict-telemetry", state: "open", members: ["6-1-sol-6"] }, { room: "swarm-005617-kcj5-trigger", state: "concluded", members: [] }] },
    { name: "swarm-005617-verdict-telemetry", parent: "swarm-005617-kcj5-room", breakout_fate: { line: "When this room concludes, its conclusion is copied to swarm-005617-kcj5-room as inbox/x/conclusion." } },
    { name: "deep", parent: "swarm-005617-verdict-telemetry" },
    { name: "loose" },
  ];
  const byName = Object.fromEntries(rooms.map((r) => [r.name, r]));
  assert.equal(ui.roomRun(rooms[1], byName), "swarm-005617", "an unprefixed breakout sits under its parent's run");
  assert.equal(ui.roomRun(rooms[2], byName), "swarm-005617", "and so does its own breakout");
  assert.equal(ui.roomRun(rooms[3], byName), null);
  const child = ui.fateChips(rooms[1], esc);
  assert.match(child, /data-goto="swarm-005617-kcj5-room" title="When this room concludes, its conclusion is copied to swarm-005617-kcj5-room as inbox\/x\/conclusion\.">↳ breakout of swarm-005617-kcj5-room/);
  const parent = ui.fateChips(rooms[0], esc);
  assert.match(parent, /data-goto="swarm-005617-verdict-telemetry"[^>]*>⤷ swarm-005617-verdict-telemetry · open/);
  assert.match(parent, /⤷ swarm-005617-kcj5-trigger · concluded/);
  assert.equal(ui.fateChips(rooms[3], esc), "");
  assert.equal(ui.fateLine(rooms[1], esc), `<div class="fate" id="fate">${rooms[1].breakout_fate!.line}</div>`);
  assert.equal(ui.fateLine(rooms[3], esc), "");
  assert.match(ui.closeWords(rooms[0]), /Its open breakout swarm-005617-verdict-telemetry closes with it\./);
  assert.doesNotMatch(ui.closeWords(rooms[3]), /breakout/);
  assert.match(UI_HTML, /chips \+ fateChips\(r, esc\) \+/, "the header renders the chips");
  assert.match(UI_HTML, /esc\(r\.topic \|\| '\(no topic\)'\) \+ '<\/div>' \+ fateLine\(r, esc\)/, "and the fate line under the topic");
  assert.match(UI_HTML, /\$\('#head'\)\.addEventListener\('click', [^\n]*closest\('\[data-goto\]'\)[^\n]*select\(b\.dataset\.goto\)/, "a chip selects the room it names");
  assert.match(UI_HTML, /roomRun\(r, byName\) \|\| 'other'/, "the rail groups by roomRun");
  assert.match(UI_HTML, /window\.confirm\(closeWords\(r\)\)/, "the close confirmation names the breakouts that close with it");
});
