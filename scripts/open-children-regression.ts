/**
 * Open breakouts at a parent's close (evidence-pack items 1 and 7, swarm-180216-182a, claim/open-children-at-close).
 * swarm-123021-1nwp-leads concluded at 14:34, 92 min before its internal group did (16:06); internal kept waiting on
 * a run with an ETA of 17:00, was never told, and its final board write was refused. The group rooms had no parent, so
 * the hub could not know they belonged to the leads room. Now: a parent's last call also waits (within its window) for
 * its open breakouts and names them; each breakout still open when the parent concludes is told at once; and a room
 * created through the launcher's create endpoint can name its parent. Red on main: the parent concludes as soon as
 * everyone has voted, and the breakout hears nothing.
 * Run: npx tsx scripts/open-children-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub } from "../src/hub.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TEXT = "The leads room adopts the internal group's capacity figure as the answer.";
const QUOTE = "adopts the internal group";

function setup(parent: string, lastCallMs: number, dataDir?: string) {
  Hub.LAST_CALL_MS = lastCallMs;
  const hub = new Hub({ dataDir });
  const opts = { requireChallenge: false, nudgeAfterMs: 0, quorum: "majority" as const };
  const a = hub.join(parent, "A", "test", opts, undefined, "s1").participant;
  const b = hub.join(parent, "B", "test", {}, undefined, "s2").participant;
  const child = `${parent}-internal`;
  const ca = hub.join(child, "A", "test", { ...opts, parent }, undefined, "s1").participant;
  const cc = hub.join(child, "C", "test", {}, undefined, "s3").participant;
  const pr = hub.propose(parent, a.id, TEXT);
  return { hub, a, b, child, ca, cc, pr, room: hub.getRoom(parent), childRoom: hub.getRoom(child) };
}

test("everyone in the parent voted, but a breakout is still open: last call names it and waits", () => {
  const { hub, b, child, ca, cc, pr, room, childRoom } = setup("oc-wait", 60_000);
  hub.vote(room.name, b.id, pr.id, "agree", "ok", undefined, QUOTE);
  assert.equal(room.state, "open", "the parent must not conclude while its breakout is still working");
  const notice = room.messages.find((m) => /LAST CALL/.test(m.content));
  assert.ok(notice, "a last call opens");
  assert.match(notice!.content, new RegExp(`breakout ${child}`), "the notice names the open breakout");
  assert.ok(childRoom.messages.some((m) => m.kind === "system" && /is in LAST CALL/.test(m.content) && m.content.includes(room.name)), "the breakout is told its parent is in last call");
  // the breakout concludes: its conclusion is carried up and the parent's last call ends at once
  const cp = hub.propose(child, ca.id, "Capacity is 17 diffs per run, measured on the internal set.");
  hub.vote(child, cc.id, cp.id, "agree", "ok", undefined, "Capacity is 17 diffs per run");
  assert.equal(childRoom.state, "concluded");
  assert.ok(room.board.has(`inbox/${child}/conclusion`), "the breakout's answer reached the parent before it closed");
  assert.equal(room.state, "concluded", "nothing left to wait for once the breakout concluded");
  assert.equal(room.conclusion!.closing!.ended, "all_voted");
  assert.equal(room.conclusion!.closing!.children_open, undefined);
});

test("a parent that concludes over an open breakout tells it at once, and records it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "open-children-"));
  const { hub, b, child, pr, room, childRoom } = setup("oc-tell", 200, dir);
  hub.vote(room.name, b.id, pr.id, "agree", "ok", undefined, QUOTE);
  await sleep(320);
  assert.equal(room.state, "concluded", "the window ran out: the parent concludes on its votes");
  assert.deepEqual(room.conclusion!.closing!.children_open, [child]);
  assert.equal(room.conclusion!.closing!.ended, "window");
  const told = childRoom.messages.find((m) => m.kind === "system" && m.content.includes(`${room.name}, this room's parent, concluded`));
  assert.ok(told, "the open breakout is told its parent's answer is fixed");
  assert.match(told!.content, new RegExp(pr.id));
  const ev = readFileSync(join(dir, `${child}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.type === "parent_concluded");
  assert.ok(ev, "a parent_concluded event is logged in the breakout's own log");
  assert.equal(ev.parent, room.name);
  assert.equal(ev.proposalId, pr.id);
  Hub.LAST_CALL_MS = 0;
});

test("createRoom with a parent links a launcher-made group room to its leads room", () => {
  Hub.LAST_CALL_MS = 0;
  const hub = new Hub();
  hub.createRoom("oc-leads", { quorum: "majority" });
  const g = hub.createRoom("oc-leads-build", { parent: "oc-leads" });
  assert.equal(g.parent, "oc-leads");
  assert.deepEqual(hub.breakouts(hub.getRoom("oc-leads")).map((x) => x.room), ["oc-leads-build"]);
  assert.throws(() => hub.createRoom("oc-orphan", { parent: "no-such-room" }), /does not exist/);
});
