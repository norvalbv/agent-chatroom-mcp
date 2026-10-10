/**
 * A verify entry says what its reviewer did not show, and the hub reads the dev room itself (swarm-000525-jcz8,
 * claim/verify-gaps; asked by launcher-claude #183, verifier #184, #194, #198). Every verify entry in that room kept a
 * "NOT VERIFIED by me" section in prose, often the part the brief required (agents watched on a private hub), and the
 * gate, blocked_by and the conclusion read only the JSON head; in past rooms 45 of 313 passing heads said so only in
 * prose (scripts/verify-gaps-measure.py). Now the head may carry "unverified":[...] and "dev_room":"http://127.0.0.1:
 * <port>/rooms/<room>"; the hub fetches that room over HTTP when the entry is written (a log path would be a file in
 * the reviewer's worktree) and checks it ran the verified commit with two agent seats speaking. This is not proof:
 * anything answering on that port, a static file included, reads as a dev room (review/verify-gaps).
 * What is missing rides on the open proposal and makes the conclusion "Verified PARTIAL". Not a gate.
 * Run: npx tsx --test scripts/verify-gaps-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hub, parseVerifyHead } from "../src/hub.js";

const COMMIT = "e4f5a6b";
const DEV = "http://127.0.0.1:7999/rooms/dev-room";
const NOT_LAUNCHED = "dev_room was not started by this hub (scripts/dev-run.ts), so its commit and seats are the dev hub's own word";

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "verify-gaps-"));
  const hub = new Hub({ dataDir: dir });
  const name = "verify-gaps-test";
  const a = hub.join(name, "Alice", "test", { requireVerification: true, requireChallenge: false, expectedParticipants: 2 }, undefined, "session-a").participant;
  const b = hub.join(name, "Bob", "test", {}, undefined, "session-b").participant;
  const room = hub.getRoom(name);
  hub.setBoard(name, a.id, "verify/own-run", "the author's own run");
  const pr = hub.propose(name, a.id, `Ship commit ${COMMIT}.`);
  t.after(() => {
    clearTimeout(room.nudgeTimer);
    clearTimeout(room.openingsTimer);
    rmSync(dir, { recursive: true, force: true });
  });
  const head = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ proposal: pr.id, command: "npx tsx scripts/x.ts", cwd: "/repo", base_commit: "a1b2c3d", base_exit_code: 1, commit: COMMIT, exit_code: 0, output_tail: "ok", ...over });
  const devRoom = (over: Record<string, unknown> = {}) => ({
    name: "dev-room", state: "concluded", code_state: { head: COMMIT, dirty: false }, message_count: 30,
    participants: [{ agent: "claude", messages: 4 }, { agent: "claude", messages: 2 }, { agent: "human", messages: 1 }], ...over,
  });
  const conclude = () => {
    hub.vote(name, a.id, pr.id, "agree", undefined, undefined, `Ship commit ${COMMIT}`);
    hub.vote(name, b.id, pr.id, "agree", undefined, undefined, `Ship commit ${COMMIT}`);
    assert.equal(room.state, "concluded", "gaps are reported, never a gate");
    return room.messages.at(-1)?.content ?? "";
  };
  return { hub, room, pr, a, b, head, devRoom, conclude, dir };
}

test("the head's own unverified list and a missing dev room ride on the proposal and make the conclusion PARTIAL", (t) => {
  const { hub, room, pr, b, head, conclude } = fixture(t);
  hub.setBoard(room.name, b.id, "verify/x", head({ kind: "exercised", unverified: ["full npm test", "a real recruit"] }));
  assert.ok(hub.verifiedBy(room, pr), "still counts");
  const gaps = hub.proposalView(room, pr).verification_gaps;
  assert.deepEqual(gaps?.[0].gaps.slice(0, 2), ["full npm test", "a real recruit"]);
  assert.match(gaps?.[0].gaps[2] ?? "", /"kind":"exercised" but no dev_room/);
  const line = conclude();
  assert.match(line, /Verified PARTIAL, not shown by the reviewer: verify\/x \(Bob\): full npm test; a real recruit; "kind":"exercised" but no dev_room/, line);
  assert.equal(room.conclusion?.verification_gaps?.[0].key, "verify/x");
});

test("a head that claims nothing it did not show carries no gap", (t) => {
  const { hub, room, pr, b, head, conclude } = fixture(t);
  hub.setBoard(room.name, b.id, "verify/x", head({ kind: "own_check" }));
  assert.equal(hub.proposalView(room, pr).verification_gaps, undefined);
  assert.doesNotMatch(conclude(), /PARTIAL/);
  assert.equal(room.conclusion?.verification_gaps, undefined);
});

test("a dev room the hub read itself, on the verified commit with two agents speaking, is read, but reads PARTIAL unless this hub started it", async (t) => {
  const { hub, room, pr, b, head, devRoom, conclude } = fixture(t);
  hub.setBoard(room.name, b.id, "verify/x", head({ dev_room: DEV }));
  assert.match(hub.proposalView(room, pr).verification_gaps?.[0].gaps[0] ?? "", /not read by the hub/, "a URL alone proves nothing");
  const seen: string[] = [];
  const r = await hub.readDevRoom(room.name, "verify/x", async (u) => { seen.push(u); return devRoom(); });
  assert.deepEqual(seen, [DEV]);
  assert.equal(r?.agent_seats, 2);
  assert.deepEqual(hub.proposalView(room, pr).verification_gaps?.[0].gaps, [NOT_LAUNCHED], "read, but only the dev hub's word (dev-runs-regression)");
  assert.match(conclude(), /PARTIAL.*not started by this hub/);
});

test("what the hub read decides, not what the head says", async (t) => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ code_state: { head: "0123456789", dirty: false } }, /dev_room ran 0123456789, not e4f5a6b/],
    [{ code_state: { head: COMMIT, dirty: true } }, /uncommitted changes/],
    [{ code_state: null }, /reported no git commit/],
    [{ participants: [{ agent: "claude", messages: 3 }, { agent: "claude", messages: 0 }] }, /1 agent seat\(s\) that spoke/],
  ];
  for (const [over, want] of cases) {
    const { hub, room, pr, b, head, devRoom } = fixture(t);
    hub.setBoard(room.name, b.id, "verify/x", head({ dev_room: DEV }));
    await hub.readDevRoom(room.name, "verify/x", async () => devRoom(over));
    assert.match(hub.proposalView(room, pr).verification_gaps?.[0].gaps.join(" | ") ?? "", want);
  }
});

test("an unreachable dev room is recorded as such, and a non-loopback one is never fetched", async (t) => {
  const { hub, room, pr, b, head } = fixture(t);
  hub.setBoard(room.name, b.id, "verify/x", head({ dev_room: DEV }));
  await hub.readDevRoom(room.name, "verify/x", async () => { throw new Error("connect ECONNREFUSED"); });
  assert.match(hub.proposalView(room, pr).verification_gaps?.[0].gaps[0] ?? "", /could not be read .*ECONNREFUSED/);
  for (const url of ["http://example.com/rooms/x", "file:///tmp/x.jsonl", "http://127.0.0.1:7999/rooms/x/../../admin"]) {
    hub.setBoard(room.name, b.id, "verify/x", head({ dev_room: url }));
    let called = false;
    assert.equal(await hub.readDevRoom(room.name, "verify/x", async () => { called = true; return {}; }), undefined);
    assert.equal(called, false, url);
  }
});

test("the receipt is written to the log and replayed; a rewrite drops it", async (t) => {
  const { hub, room, pr, b, head, devRoom, dir } = fixture(t);
  hub.setBoard(room.name, b.id, "verify/x", head({ dev_room: DEV }));
  await hub.readDevRoom(room.name, "verify/x", async () => devRoom());
  const again = new Hub({ dataDir: dir });
  const r2 = again.getRoom(room.name);
  t.after(() => { clearTimeout(r2.nudgeTimer); clearTimeout(r2.openingsTimer); });
  assert.deepEqual(again.proposalView(r2, r2.proposals.get(pr.id)!).verification_gaps?.[0].gaps, [NOT_LAUNCHED], "replayed hub keeps the receipt");
  hub.setBoard(room.name, b.id, "verify/x", head({ dev_room: DEV, output_tail: "rerun" }));
  assert.match(hub.proposalView(room, pr).verification_gaps?.[0].gaps[0] ?? "", /not read by the hub/, "a new text needs a new read");
});

test("the real fetch reads a running hub's room summary over HTTP", async (t) => {
  const { hub, room, pr, b, head, devRoom } = fixture(t);
  const srv = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url === "/rooms/dev-room" ? devRoom() : {}));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  t.after(() => srv.close());
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/rooms/dev-room`;
  hub.setBoard(room.name, b.id, "verify/x", head({ dev_room: url }));
  const r = await hub.readDevRoom(room.name, "verify/x");
  assert.equal(r?.code_head, COMMIT);
  assert.deepEqual(hub.proposalView(room, pr).verification_gaps?.[0].gaps, [NOT_LAUNCHED], "read, but only the dev hub's word (dev-runs-regression)");
});

test("the head shape: unverified is a list of strings, dev_room a string", () => {
  const base = { proposal: "p", command: "c", cwd: "/", exit_code: 0, output_tail: "" };
  assert.equal(parseVerifyHead(JSON.stringify({ ...base, unverified: "npm test" })), undefined);
  assert.equal(parseVerifyHead(JSON.stringify({ ...base, unverified: [1] })), undefined);
  assert.equal(parseVerifyHead(JSON.stringify({ ...base, dev_room: 7862 })), undefined);
  assert.deepEqual(parseVerifyHead(JSON.stringify({ ...base, unverified: [], dev_room: DEV }))?.unverified, []);
});
