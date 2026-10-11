/**
 * The verifier's agree is needed, as every seat is told (evidence-pack item 1, swarm-180216-182a, claim/verifier-vote-counts).
 * The launcher tells each seat "A verifier named "verifier" sits in the room and the final proposal needs its agree
 * vote" (src/swarm.ts), but the hub required it only under unanimous quorum. Of 8 concluded supermajority rooms with a
 * verifier seat on hub 7717, 6 concluded with no standing verifier vote on the final version (tky5, 00cp, ouev, 22gz,
 * mrkt, gwhf; /tmp/c1/verifier.mjs); mrkt's verifier: "Concluded 5/6 without my vote ... Change 2 disputed". Gerrit's
 * Verified label is the same rule: +1 needed on the latest patch set, any -1 blocks, an older approval is outdated.
 * Now, while a seat with role verifier is active, a proposal passes only with its agree on the current version, and its
 * disagree blocks. Red on main: the supermajority concludes without it.
 * Run: npx tsx scripts/verifier-gate-regression.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hub } from "../src/hub.js";

const TEXT = "Ship change 1 and change 2: both pass the regression suite on the branch.";
const QUOTE = "both pass the regression suite";

function setup(room: string, withVerifier = true) {
  Hub.LAST_CALL_MS = 0;
  const hub = new Hub();
  const opts = { quorum: "supermajority" as const, nudgeAfterMs: 0, requireChallenge: false };
  const [a, b, c, d] = ["A", "B", "C", "D"].map((n, i) => hub.join(room, n, "test", i ? {} : opts, undefined, `s${i}`).participant);
  const v = withVerifier ? hub.join(room, "verifier", "test", {}, undefined, "sv", "verifier").participant : hub.join(room, "E", "test", {}, undefined, "sv").participant;
  const pr = hub.propose(room, a.id, TEXT);
  const agree = (id: string, quote = QUOTE) => hub.vote(room, id, pr.id, "agree", "checked", undefined, quote);
  return { hub, r: hub.getRoom(room), a, b, c, d, v, pr, agree };
}

test("a supermajority without the verifier's agree does not conclude; its agree concludes", () => {
  const { hub, r, b, c, d, v, pr, agree } = setup("vg-needs");
  agree(b.id); agree(c.id); agree(d.id); // 4 of 5: the supermajority
  assert.equal(r.state, "open", "4/5 agree but the verifier has not voted");
  assert.ok(r.messages.some((m) => m.kind === "system" && /has the votes but the verifier/.test(m.content)), "the room is told why it has not concluded");
  assert.ok(hub.blockedBy(r, pr).some((x) => /the verifier/.test(x) && /verifier/.test(x)));
  assert.ok(hub.needsVote(r, v, pr), "the verifier owes a vote");
  agree(v.id);
  assert.equal(r.state, "concluded");
  assert.deepEqual(r.conclusion!.closing!.verifier, { name: "verifier", agreed: true, vote: "agree", version: 1 });
});

test("the verifier's disagree blocks a supermajority, and the room is told what it objects to", () => {
  const { hub, r, b, c, d, v, pr, agree } = setup("vg-veto");
  hub.vote("vg-veto", v.id, pr.id, "disagree", "change 2 fails its own test on the branch: drop it from the text");
  agree(b.id); agree(c.id); agree(d.id);
  assert.equal(r.state, "open", "4/5 agree, the verifier disagrees");
  const line = r.messages.find((m) => m.kind === "system" && /the verifier/.test(m.content) && /disagree/.test(m.content));
  assert.ok(line, "a line names the verifier's disagree");
  assert.match(line!.content, /change 2 fails its own test/);
});

test("an agree the verifier cast on an older version is outdated", () => {
  const { hub, r, a, b, c, d, v, pr, agree } = setup("vg-stale");
  agree(v.id);
  hub.amend("vg-stale", a.id, pr.id, "Ship change 1 and change 2", "Ship change 1, change 2 and change 3");
  agree(a.id); agree(b.id); agree(c.id); agree(d.id);
  assert.equal(r.state, "open", "the verifier agreed to v1, not to the text with change 3");
  assert.ok(hub.needsVote(r, v, pr));
  agree(v.id);
  assert.equal(r.state, "concluded");
  assert.equal(r.conclusion!.closing!.verifier!.version, 2);
});

test("a verifier that leaves no longer holds the room; a room with no verifier is unchanged", () => {
  const { hub, r, b, c, d, v, agree } = setup("vg-left");
  agree(b.id); agree(c.id); agree(d.id);
  assert.equal(r.state, "open");
  hub.leave("vg-left", v.id, "verifier seat lost to the usage limit");
  assert.equal(r.state, "concluded", "nobody is left to verify: the votes decide");
  assert.equal(r.conclusion!.closing!.verifier, undefined);
  const plain = setup("vg-plain", false);
  plain.agree(plain.b.id); plain.agree(plain.c.id); plain.agree(plain.d.id);
  assert.equal(plain.r.state, "concluded", "4/5 without a verifier seat concludes as before");
});

test("a verifier silent past the hub's dead threshold stops holding, and the conclusion says so", () => {
  // attack/decision/verifier-vote-counts: a seated verifier waiting hours for a usage limit to reset must not hold the room for good
  const { hub, r, b, c, d, v, agree } = setup("vg-silent");
  agree(b.id); agree(c.id);
  v.lastActiveAt = new Date(Date.now() - 11 * 60_000).toISOString(); // no hub call or heartbeat for 11 min
  assert.equal(hub.verifierHolds(r, [...r.proposals.values()][0]).length, 0, "a silent verifier holds nothing");
  agree(d.id);
  assert.equal(r.state, "concluded", "the votes decide once the verifier reads as dead");
  const cv = r.conclusion!.closing!.verifier!;
  assert.equal(cv.agreed, false);
  assert.equal(cv.silent_minutes, 11);
  assert.match(r.messages.find((m) => m.kind === "conclusion")!.content, /Concluded WITHOUT the verifier's agree: verifier never voted and has been silent for 11 min/);
});

test("a verifier that is busy (heartbeating) keeps holding however long its check takes", () => {
  const { hub, r, b, c, d, v, agree } = setup("vg-busy");
  v.lastActiveAt = new Date(Date.now() - 25 * 60_000).toISOString(); // last hub call 25 min ago...
  v.working = { tool: "Bash", step: 40, at: new Date(Date.now() - 20_000).toISOString() } as never; // ...but its hook heartbeated 20 s ago
  agree(b.id); agree(c.id); agree(d.id);
  assert.equal(r.state, "open", "a verifier running a long check is alive and still owed");
  assert.equal(hub.verifierHolds(r, [...r.proposals.values()][0]).length, 1);
});

test("a verifier inside one long command (no heartbeat for 11 min, but a job of its own running) keeps holding", () => {
  // review/cc372f8e (claude-opus-5-5-4): the heartbeat fires at the START of a tool call, so one foreground suite run longer
  // than 10 minutes read as silence and the room could close while the verifier was checking
  const { hub, r, b, c, d, v, agree } = setup("vg-job");
  v.lastActiveAt = new Date(Date.now() - 11 * 60_000).toISOString();
  const jobs = { on: true };
  (hub as unknown as { jobsOf: (p: { id: string }) => unknown[] }).jobsOf = (p) => (jobs.on && p.id === v.id ? [{ pid: 4242, command: "node scripts/offline-runner.mjs", seconds: 660 }] : []);
  agree(b.id); agree(c.id); agree(d.id);
  assert.equal(r.state, "open", "the verifier's own job is running: it is checking, not gone");
  assert.equal(hub.verifierHolds(r, [...r.proposals.values()][0]).length, 1);
  jobs.on = false; // the job ended and still no call from the verifier: now it is silent
  assert.equal(hub.verifierHolds(r, [...r.proposals.values()][0]).length, 0);
});
