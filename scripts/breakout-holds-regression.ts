/**
 * What a break-out room has taken, seen from its parent (swarm-003601-tky5, friction/sub-room-work-invisible): a seat in
 * the parent built a count of cross-group reads for about 20 minutes while a recruit in the break-out had already built
 * and verified the same thing; the parent saw the child only through the notes the child chose to post. Now the
 * parent's room_status lists each break-out's live claim/* and take/* keys with their holders, and the claim-overlap
 * notice looks one hop across the parent/break-out link, naming the room. Never between two break-outs of one parent:
 * groups with opposing briefs are siblings and must not see each other's work.
 * Run: npx tsx scripts/breakout-holds-regression.ts
 */
import assert from "node:assert/strict";
import { Hub } from "../src/hub.js";
import { statusView } from "../src/hub/status-view.js";

const cases: [string, () => Promise<void> | void][] = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

const PARENT = "swarm-000002-hold-room", CHILD = "swarm-000002-hold-telemetry", SIBLING = "swarm-000002-hold-break";
function rooms() {
  const h = new Hub();
  const [a, b, c] = ["A", "B", "C"].map((n) => h.join(PARENT, n, "test", {}, undefined, `s-${n}`).participant);
  const r = h.join(CHILD, "R", "test", { parent: PARENT, topic: "telemetry" }, undefined, "s-B").participant; // B's connection opens it
  const x = h.join(CHILD, "X", "test", {}, undefined, "s-X").participant;
  return { h, a, b, c, r, x };
}
const claim = (area: string, owner: string, note: string) => JSON.stringify({ area, owner, status: "open", note });
const READS = "Count every read a seat makes of another group's room over HTTP or its jsonl, shown per seat in room_status as outside reads, with a regression script.";
const READS2 = "Outside reads: count each seat's reads of another group room (HTTP address or the room jsonl) and show the count per seat in room_status; regression script.";
type Breakout = { room: string; holds?: string[] };
const breakouts = (h: Hub, room: string) => ((h.summary(h.getRoom(room)) as { breakouts?: Breakout[] }).breakouts ?? []);

test("the parent's room_status lists each break-out's live claims and takes with their holders", () => {
  const { h, r, x } = rooms();
  assert.deepEqual(breakouts(h, PARENT).map((b) => b.holds), [undefined], "nothing held: no field");
  h.setBoard(CHILD, r.id, "claim/outside-reads", claim("outside-reads", "R", READS));
  h.setBoard(CHILD, x.id, "take/audit/outside-reads", "auditing R's count now");
  assert.deepEqual(breakouts(h, PARENT)[0]!.holds, ["claim/outside-reads (R)", "take/audit/outside-reads (X)"]);
  const seatView = statusView(h.summary(h.getRoom(PARENT)) as Parameters<typeof statusView>[0]) as { breakouts?: Breakout[] };
  assert.deepEqual(seatView.breakouts?.[0]?.holds, ["claim/outside-reads (R)", "take/audit/outside-reads (X)"], "a seat's own room_status carries it");
  h.setBoard(CHILD, x.id, "take/audit/outside-reads", "");
  assert.deepEqual(breakouts(h, PARENT)[0]!.holds, ["claim/outside-reads (R)"], "a released take drops out");
});

test("a parent seat claiming what a break-out already holds is told, with the room named", () => {
  const { h, a, r } = rooms();
  h.setBoard(CHILD, r.id, "claim/outside-reads", claim("outside-reads", "R", READS));
  const e = h.setBoard(PARENT, a.id, "claim/cross-group-reads", claim("cross-group-reads", "A", READS2));
  assert.ok(e, "advisory: the claim is written");
  const notice = h.getRoom(PARENT).messages.find((m) => m.content.includes("overlaps"));
  assert.ok(notice, "the parent seat gets the overlap notice");
  assert.match(notice.content, new RegExp(`@A your "claim/cross-group-reads" overlaps R's "claim/outside-reads" in ${CHILD}`));
  assert.deepEqual(h.claimOverlaps(PARENT, a.id, "claim/cross-group-reads").map((o) => [o.key, o.room]), [["claim/outside-reads", CHILD]], "and in its board_set response");
});

test("a break-out seat claiming what the parent already holds is told too", () => {
  const { h, a, r } = rooms();
  h.setBoard(PARENT, a.id, "claim/cross-group-reads", claim("cross-group-reads", "A", READS2));
  h.setBoard(CHILD, r.id, "claim/outside-reads", claim("outside-reads", "R", READS));
  const notice = h.getRoom(CHILD).messages.find((m) => m.content.includes("overlaps"));
  assert.ok(notice);
  assert.match(notice.content, new RegExp(`overlaps A's "claim/cross-group-reads" in ${PARENT}`));
});

test("two break-outs of one parent never see each other (opposing groups), and one connection is not its own overlap", () => {
  const { h, a, b, r } = rooms();
  const y = h.join(SIBLING, "Y", "test", { parent: PARENT, topic: "break it" }, undefined, "s-A").participant;
  h.setBoard(CHILD, r.id, "claim/outside-reads", claim("outside-reads", "R", READS));
  h.setBoard(SIBLING, y.id, "claim/cross-group-reads", claim("cross-group-reads", "Y", READS2));
  assert.equal(h.getRoom(SIBLING).messages.filter((m) => m.content.includes("overlaps")).length, 0, "siblings are two hops apart");
  assert.deepEqual(breakouts(h, CHILD), [], "a break-out lists no breakouts of its parent");
  // B opened CHILD on its own connection (R is s-B): B's parent claim is the same agent, not a collision with R's;
  // the parent does see both of its break-outs, so Y's claim in SIBLING is named
  h.setBoard(PARENT, b.id, "claim/reads-again", claim("reads-again", "B", READS2));
  const toB = h.getRoom(PARENT).messages.filter((m) => m.content.startsWith("@B your"));
  assert.equal(toB.length, 1);
  assert.doesNotMatch(toB[0]!.content, /R's "claim\/outside-reads"/);
  assert.match(toB[0]!.content, new RegExp(`Y's "claim/cross-group-reads" in ${SIBLING}`));
  void a;
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
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nBREAKOUT HOLDS OK (${cases.length} cases)`);
process.exit(failed ? 1 : 0);
