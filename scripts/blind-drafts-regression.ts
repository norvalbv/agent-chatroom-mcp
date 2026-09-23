/** draft/* entries are sealed: readable only by their author until every drafter (voter other than the verifier)
 * has written one, then readable by all, announced in one system line. Why: on bench-printf-format a room of three
 * shared one implementation (one writer, two spot-checkers) and failed the same single case a lone seat fails
 * (tasks/bench-printf-format/ADMISSION.md); independent attempts only disagree, and so expose a common slip, if
 * nobody sees another's attempt first. Sealed means: absent from board_get (manifest and key read), from
 * wait_for_messages board manifests, from room_status; a peer's overwrite attempt is refused without echoing text.
 * npx tsx scripts/blind-drafts-regression.ts */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";

Hub.DEFAULT_NUDGE_MS = 0;
const dataDir = mkdtempSync(join(tmpdir(), "blind-drafts-"));
const hub = new Hub({ dataDir });
async function seat(name: string, h: Hub = hub) {
  const session = createSessionServer(h);
  const client = new Client({ name, version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await session.server.connect(st); await client.connect(ct);
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name: tool, arguments: args });
    return { error: !!r.isError, text: (r.content as { text: string }[])[0]?.text ?? "" };
  };
  return { call };
}

const room = "blind-drafts-test";
const a = await seat("a"); const b = await seat("b"); const v = await seat("v"); const out = await seat("outsider");
await a.call("join_room", { room, name: "A", agent: "test" });
await b.call("join_room", { room, name: "B", agent: "test" });
await v.call("join_room", { room, name: "V", agent: "test", role: "verifier" });

const SECRET = "use toExponential(16) for %.17g";
let r = await a.call("board_set", { room, key: "draft/A", text: SECRET });
assert.ok(!r.error, "A drafted: " + r.text);

// the chat notice for a sealed draft names neither key nor size, only who still owes one
const notice = hub.getRoom(room).messages.filter((m) => m.kind === "board").at(-1)!;
assert.ok(!notice.content.includes("draft/A") && !notice.content.includes(String(SECRET.length)) && /sealed draft \(0 of 2|1 of 2 drafters.*B has one/.test(notice.content), "sealed notice: " + notice.content);

// A sees its own draft; B, the verifier and a non-member do not, by any read path
r = await a.call("board_get", { room, key: "draft/A" });
assert.ok(!r.error && r.text.includes(SECRET), "author reads own draft: " + r.text);
for (const [who, s] of [["B", b], ["V", v], ["outsider", out]] as const) {
  r = await s.call("board_get", { room });
  assert.ok(!r.text.includes("draft/A"), `${who} manifest hides sealed draft: ${r.text}`);
  r = await s.call("board_get", { room, key: "draft/A" });
  assert.ok(r.error && !r.text.includes(SECRET) && !/Keys:.*draft\/A/.test(r.text), `${who} key read refused: ${r.text}`);
  r = await s.call("room_status", { room });
  assert.ok(!r.text.includes("\"draft/A\""), `${who} room_status hides sealed draft`);
}
r = await b.call("wait_for_messages", { room, timeout_ms: 0, follow: [""] });
assert.ok(!r.text.includes("\"draft/A\""), "B's wait manifest hides sealed draft: " + r.text);
r = await a.call("wait_for_messages", { room, timeout_ms: 0, follow: [""] });
assert.ok(r.text.includes("draft/A"), "A's wait manifest lists own draft");

// a peer cannot overwrite (or learn the text of) a sealed draft, even with overwrite=true
r = await b.call("board_set", { room, key: "draft/A", text: "mine now", overwrite: true });
assert.ok(r.error && !r.text.includes(SECRET) && /author-only/.test(r.text), "peer overwrite refused without echo: " + r.text);

// the verifier writing a draft does not count, and B still cannot see A's
r = await v.call("board_set", { room, key: "draft/V", text: "verifier notes" });
assert.ok(!r.error, "verifier may write a draft: " + r.text);
r = await b.call("board_get", { room, key: "draft/A" });
assert.ok(r.error, "still sealed: the verifier is not a drafter");

// the last drafter's write reveals every draft/* to everyone, once, with a system line; B's delta ships the keys
r = await b.call("board_set", { room, key: "draft/B", text: "shortest repr via String(x)" });
assert.ok(!r.error, "B drafted: " + r.text);
r = await b.call("board_get", { room, key: "draft/A" });
assert.ok(!r.error && r.text.includes(SECRET), "revealed to B: " + r.text);
r = await out.call("board_get", { room });
assert.ok(r.text.includes("draft/A") && r.text.includes("draft/B"), "revealed to outsiders too");
r = await b.call("wait_for_messages", { room, timeout_ms: 0 });
assert.ok(r.text.includes("draft/A"), "B's board delta ships the newly revealed key: " + r.text);
assert.ok(/draft\/\* is now readable by all/.test(r.text), "reveal announced");
const log = hub.getRoom(room).messages.filter((m) => /is now readable by all/.test(m.content));
assert.equal(log.length, 1, "announced exactly once");

// the reveal survives a restart (replay latches it)
const replayed = new Hub({ dataDir });
const rr = replayed.getRoom(room);
assert.equal(rr.draftsRevealed, true, "replay re-latches the reveal");
assert.equal(replayed.draftSealed(rr, "draft/A", rr.board.get("draft/A")!, undefined), false, "not sealed after replay");

// a drafter who leaves stops counting: the remaining drafters' drafts reveal without them
const room2 = "blind-drafts-leaver";
const c = await seat("c"); const d = await seat("d"); const e = await seat("e");
await c.call("join_room", { room: room2, name: "C", agent: "test" });
await d.call("join_room", { room: room2, name: "D", agent: "test" });
await e.call("join_room", { room: room2, name: "E", agent: "test" });
await c.call("board_set", { room: room2, key: "draft/C", text: "c-draft" });
await d.call("board_set", { room: room2, key: "draft/D", text: "d-draft" });
r = await d.call("board_get", { room: room2, key: "draft/C" });
assert.ok(r.error, "sealed while E has not drafted");
r = await e.call("leave_room", { room: room2, reason: "finished nothing here; no handoff, no claim, leaving the room" });
r = await d.call("board_get", { room: room2, key: "draft/C" });
assert.ok(!r.error && r.text.includes("c-draft"), "revealed once the only non-drafter left: " + r.text);

assert.equal(hub.getRoom(room2).messages.filter((m) => /is now readable by all/.test(m.content)).length, 1, "a leaver-triggered reveal is announced once");
// the deadline: a drafter who stays but never drafts does not keep everyone else's drafts sealed forever
Hub.DRAFT_REVEAL_MS = 300;
const room3 = "blind-drafts-deadline";
const f = await seat("f"); const g = await seat("g"); const h = await seat("h");
await f.call("join_room", { room: room3, name: "F", agent: "test" });
await g.call("join_room", { room: room3, name: "G", agent: "test" });
await h.call("join_room", { room: room3, name: "H", agent: "test" });
await f.call("board_set", { room: room3, key: "draft/F", text: "f-draft" });
await new Promise((res) => setTimeout(res, 150));
await g.call("board_set", { room: room3, key: "draft/G", text: "g-draft" }); // a later draft does not push the clock back
r = await g.call("board_get", { room: room3, key: "draft/F" });
assert.ok(r.error, "sealed before the deadline while H has not drafted");
await new Promise((res) => setTimeout(res, 250));
r = await g.call("board_get", { room: room3, key: "draft/F" });
assert.ok(!r.error && r.text.includes("f-draft"), "revealed on the deadline measured from the first draft: " + r.text);
r = await h.call("board_get", { room: room3 });
assert.ok(r.text.includes("draft/F") && r.text.includes("draft/G"), "the non-drafter sees them too");
const note = hub.getRoom(room3).messages.filter((m) => /draft deadline passed \(no draft from H\)/.test(m.content));
assert.equal(note.length, 1, "deadline reveal announced once, naming who did not draft");
assert.equal(new Hub({ dataDir }).getRoom(room3).draftsRevealed, true, "deadline reveal persisted");

// a restart mid-window keeps the original clock and still announces the reveal
Hub.DRAFT_REVEAL_MS = 400;
const room4 = "blind-drafts-restart";
const i = await seat("i"); const j = await seat("j");
await i.call("join_room", { room: room4, name: "I", agent: "test" });
await j.call("join_room", { room: room4, name: "J", agent: "test" });
await i.call("board_set", { room: room4, key: "draft/I", text: "i-draft" });
const restarted = new Hub({ dataDir });
const r4 = restarted.getRoom(room4);
assert.ok(r4.draftsOpenedAt && !r4.draftsRevealed, "replay restores the clock, still sealed");
assert.equal(restarted.draftSealed(r4, "draft/I", r4.board.get("draft/I")!, "J"), true, "sealed for J after restart");
await new Promise((res) => setTimeout(res, 500));
assert.equal(r4.draftsRevealed, true, "restarted hub reveals on the original deadline");
assert.ok(r4.messages.some((m) => /draft deadline passed/.test(m.content)), "and announces it");
Hub.DRAFT_REVEAL_MS = 0;
const room5 = "blind-drafts-no-deadline";
const k = await seat("k"); const l = await seat("l");
await k.call("join_room", { room: room5, name: "K", agent: "test" });
await l.call("join_room", { room: room5, name: "L", agent: "test" });
await k.call("board_set", { room: room5, key: "draft/K", text: "k-draft" });
await new Promise((res) => setTimeout(res, 50));
r = await l.call("board_get", { room: room5, key: "draft/K" });
assert.ok(r.error, "DRAFT_REVEAL_MS=0 waits for every drafter");

console.log("blind-drafts regression: ok");
process.exit(0);
