/**
 * Fresh challenger (swarm-000525-jcz8, findings/recruiting): Claude worker seats called request_agent in 8 of 422
 * seat-runs, and a topic sentence asking for recruits moved that to 6 of 190. Recruits, once spawned, deliver
 * (127 of 153 wrote a board entry). So the hub recruits instead of waiting for a seat to: when a proposal opens it
 * starts ONE read-only seat that has not seen the discussion, briefed with the proposal text, to file the challenge
 * or say it found none. Opt-in (CHATROOM_FRESH_CHALLENGER=1), once per proposal, bounded per room, and a refused
 * spawn never fails the propose that triggered it. Red on main: nothing fires when a proposal opens.
 * Run: npx tsx scripts/fresh-challenger-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";
import { Spawner, type SpawnerHooks, type SpawnRequest, type SpawnedAgent } from "../src/spawner.js";

const announcements: string[] = [];
const held = new Set<string>();
const hooks: SpawnerHooks = {
  isHeld: (room) => held.has(room),
  claimArea: () => {},
  ensureRoom: () => {},
  announce: (_room, text) => announcements.push(text),
  liveAgents: () => 0,
  roomTopic: (room) => `topic of ${room}`,
};
function make(freshChallenger: boolean, extra: Record<string, number> = {}) {
  const spawner = new Spawner({ mcpUrl: "http://test/mcp", defaultCwd: process.cwd(), logDir: mkdtempSync(join(tmpdir(), "fresh-challenger-")), dryRun: true, freshChallenger, ...extra });
  spawner.attach(hooks);
  const spawned: SpawnedAgent[] = [];
  const requests: SpawnRequest[] = [];
  const realRequest = spawner.request.bind(spawner);
  spawner.request = ((req: SpawnRequest) => {
    requests.push(req);
    const out = realRequest(req);
    spawned.push(...out);
    return out;
  }) as typeof spawner.request;
  return { spawner, spawned, requests };
}
const TEXT = "Adopt the cache: reads are 40% faster in scripts/bench.ts and nothing else changes.";
const prop = (id: string, text = TEXT) => ({ id, text, by: "seat-1" });

// ---------- 1. Off by default: a proposal spawns nobody ----------
const off = make(false);
off.spawner.freshChallenger("room-off", prop("prop_a"));
assert.equal(off.spawned.length, 0, "no fresh challenger unless the hub opted in");

// ---------- 2. On: exactly one read-only seat, briefed with the proposal and nothing from the discussion ----------
const on = make(true);
on.spawner.freshChallenger("room-on", prop("prop_a"));
assert.equal(on.spawned.length, 1, "one fresh challenger per proposal");
assert.equal(on.spawned[0].room, "room-on");
assert.match(on.spawned[0].name, /^fresh-challenger/);
assert.ok(on.spawned[0].brief.includes("prop_a"), "the brief names the proposal id it must challenge");
assert.ok(on.spawned[0].brief.includes(TEXT), "the brief carries the proposal text");
assert.match(on.spawned[0].brief, /challenge/);
assert.match(on.spawned[0].brief, /leave_room/);
assert.notEqual(on.requests[0].canEdit, true, "the fresh challenger is read-only");
assert.equal(on.requests[0].count, 1);
assert.ok(announcements.some((a) => /fresh challenger/i.test(a) && a.includes("prop_a")), "the room is told the hub recruited, and for which proposal");

// ---------- 3. Once per proposal: an amend or a repeat call does not spawn a second ----------
on.spawner.freshChallenger("room-on", prop("prop_a", TEXT + " Amended."));
assert.equal(on.spawned.length, 1, "once-only per proposal id");

// ---------- 4. A later proposal in the same room gets its own, up to the room bound ----------
on.spawner.freshChallenger("room-on", prop("prop_b"));
assert.equal(on.spawned.length, 2, "a new proposal gets a new fresh challenger");
on.spawner.freshChallenger("room-on", prop("prop_c"));
assert.equal(on.spawned.length, 2, `at most ${Spawner.MAX_FRESH_CHALLENGERS_PER_ROOM} fresh challengers per room`);
on.spawner.freshChallenger("room-other", prop("prop_d"));
assert.equal(on.spawned.length, 3, "the bound is per room");

// ---------- 5. A long proposal is cut to fit the brief limit, never refused for length ----------
const long = make(true);
long.spawner.freshChallenger("room-long", prop("prop_long", "x".repeat(9000)));
assert.equal(long.spawned.length, 1, "a long proposal still gets its challenger");
assert.ok(long.spawned[0].brief.length <= 4000);
assert.match(long.spawned[0].brief, /read_messages|proposal/);

// ---------- 6. A refused spawn (hold, cap) never throws into the propose that triggered it ----------
const capped = make(true, { maxCumulativePerRoom: 0 });
assert.doesNotThrow(() => capped.spawner.freshChallenger("room-capped", prop("prop_a")));
assert.equal(capped.spawned.length, 0);
held.add("room-held");
const onHold = make(true);
assert.doesNotThrow(() => onHold.spawner.freshChallenger("room-held", prop("prop_a")));
assert.equal(onHold.spawned.length, 0, "no recruiting into a held room");

// ---------- 7. The hub fires the hook once when a proposal opens, and not on amend ----------
const hub = new Hub({});
const ROOM = "fresh-challenger-regression";
const { participant: a } = hub.join(ROOM, "A", "test", { requireChallenge: true, nudgeAfterMs: 0 }, undefined, "s1");
const { participant: b } = hub.join(ROOM, "B", "test", {}, undefined, "s2");
const opened: { room: string; id: string; text: string; by: string }[] = [];
hub.onProposalOpened = (room, p) => opened.push({ room, ...p });
const p1 = hub.propose(ROOM, a.id, TEXT);
assert.deepEqual(opened, [{ room: ROOM, id: p1.id, text: TEXT, by: "A" }], "propose reports the opened proposal to the hook");
hub.challenge(ROOM, b.id, p1.id, '"reads are 40% faster" has no baseline commit.');
hub.amend(ROOM, a.id, p1.id, "reads are 40% faster", "reads are 40% faster than 64d3531c");
assert.equal(opened.length, 1, "an amend is the same proposal: no second hook call");

// ---------- 8. A hook that throws never fails the propose ----------
const hub2 = new Hub({});
const { participant: c } = hub2.join(ROOM, "C", "test", { nudgeAfterMs: 0 }, undefined, "s1");
hub2.join(ROOM, "D", "test", {}, undefined, "s2");
hub2.onProposalOpened = () => {
  throw new Error("spawner exploded");
};
assert.doesNotThrow(() => hub2.propose(ROOM, c.id, TEXT));

// ---------- 9. The conclusion waits for the recruited challenger: until it leaves ----------
function passing(room: string) {
  const h = new Hub({});
  const { room: r, participant: x } = h.join(room, "X", "test", { requireChallenge: true, nudgeAfterMs: 0 }, undefined, "s1");
  const { participant: y } = h.join(room, "Y", "test", {}, undefined, "s2");
  const pr = h.propose(room, x.id, TEXT);
  const finish = () => {
    h.challenge(room, y.id, pr.id, '"reads are 40% faster" has no baseline commit.');
    h.amend(room, x.id, pr.id, "reads are 40% faster", "reads are 40% faster than 64d3531c");
    for (const v of [x, y]) h.vote(room, v.id, pr.id, "agree", "The baseline is now named.", undefined, "nothing else changes");
  };
  return { h, r, pr, finish };
}
const w1 = passing("fresh-wait-leave");
w1.h.awaitScrutiny("fresh-wait-leave", w1.pr.id, "fresh-challenger-1", 60_000);
w1.finish();
assert.equal(w1.r.state, "open", "a proposal with the votes still waits for the fresh challenger");
assert.ok(w1.h.blockedBy(w1.r, w1.pr).some((b) => /fresh challenger fresh-challenger-1 has not reported/.test(b)), "blocked_by names who it waits for");
const { participant: f1 } = w1.h.join("fresh-wait-leave", "fresh-challenger-1", "test", {}, undefined, "s3", "recruit");
assert.equal(w1.r.state, "open", "joining is not reporting");
w1.h.leave("fresh-wait-leave", f1.id, "checked the 40% claim: holds");
assert.equal(w1.r.state, "concluded", "the challenger leaving releases the wait");

// ---------- 10. ...or until it challenges, after which only its challenge blocks ----------
const w2 = passing("fresh-wait-challenge");
w2.h.awaitScrutiny("fresh-wait-challenge", w2.pr.id, "fresh-challenger-1", 60_000);
w2.finish();
const { participant: f2 } = w2.h.join("fresh-wait-challenge", "fresh-challenger-1", "test", {}, undefined, "s3", "recruit");
w2.h.challenge("fresh-wait-challenge", f2.id, w2.pr.id, '"nothing else changes" is false: writes are slower.');
assert.equal(w2.h.scrutinyPending(w2.r, w2.pr), undefined, "a filed challenge is the report");
assert.equal(w2.r.state, "open", "its challenge now blocks like any other");
assert.ok(!w2.h.blockedBy(w2.r, w2.pr).some((b) => /has not reported/.test(b)));

// ---------- 11. ...or until the window passes: a recruit that never arrives cannot stall the room ----------
const w3 = passing("fresh-wait-timeout");
w3.h.awaitScrutiny("fresh-wait-timeout", w3.pr.id, "fresh-challenger-1", 60);
w3.finish();
assert.equal(w3.r.state, "open");
await new Promise((r) => setTimeout(r, 200));
assert.equal(w3.r.state, "concluded", "the window passing concludes it with no further call");

console.log("fresh-challenger-regression OK");
