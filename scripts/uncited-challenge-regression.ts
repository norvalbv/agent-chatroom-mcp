/** Source-level regressions: npx tsx --test scripts/uncited-challenge-regression.ts */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hub } from "../src/hub.js";

const text = "Require matching proposal spans before accepting blocking challenges. Keep nonblocking objections free.";
function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "uncited-challenge-"));
  const hub = new Hub({ dataDir: dir });
  const a = hub.join("regression", "Alice", "test", {}, undefined, "session-a").participant;
  const b = hub.join("regression", "Bob", "test", {}, undefined, "session-b").participant;
  const c = hub.join("regression", "Carol", "test", {}, undefined, "session-c").participant;
  const room = hub.getRoom("regression");
  const pr = hub.propose(room.name, a.id, text);
  t.after(() => {
    clearTimeout(room.nudgeTimer);
    clearTimeout(room.openingsTimer);
    rmSync(dir, { recursive: true, force: true });
  });
  const disk = () => readdirSync(dir).sort().map((name) => [name, readFileSync(join(dir, name), "utf8")]);
  return { hub, room, pr, a, b, c, disk };
}

for (const objection of [
  "The proposal does not explain how rejection works",
  'The clause "a nonexistent proposal passage" is too broad',
  'The clause "Require" is too short to identify the target',
]) test(`reject without mutation: ${objection}`, (t) => {
  const { hub, room, pr, b, disk } = fixture(t);
  hub.vote(room.name, b.id, pr.id, "agree", undefined, undefined, text);
  const quiet = hub.send(room.name, b.id, "@Alice Private working evidence", undefined, true, true);
  assert.equal(quiet.quiet, true);
  const before = JSON.stringify({ pr, messages: room.messages, participants: [...room.participants], disk: disk() });
  assert.throws(() => hub.challenge(room.name, b.id, pr.id, `${objection}; evidence ${quiet.id}`),
    /blocking challenge.*quot[\s\S]*12[\s\S]*closest passage/i);
  assert.equal(JSON.stringify({ pr, messages: room.messages, participants: [...room.participants], disk: disk() }), before,
    "rejection must preserve vote, challenge list, quiet thread, messages and persisted events");
});

test("matching quotes accepted; existing 12-character threshold and normalization preserved", (t) => {
  const { hub, room, pr, b } = fixture(t);
  hub.vote(room.name, b.id, pr.id, "agree", undefined, undefined, text);
  hub.challenge(room.name, b.id, pr.id, 'Does "Require matc" identify enough of the proposal?');
  assert.equal(pr.challenges[0].cites, "Require matc");
  assert.equal(pr.challenges[0].blocking, true);
  assert.equal(pr.votes[b.id], undefined);
  hub.challenge(room.name, b.id, pr.id, 'Does “matching   proposal spans” preserve normalization?');
  assert.equal(pr.challenges[1].cites, "matching   proposal spans");
  hub.amend(room.name, b.id, pr.id, "Require matching proposal spans", "Validate quoted anchors");
  assert.ok(pr.challenges.every((c) => c.status === "answered"));
});

test("nonblocking uncited dissent remains accepted and retains vote", (t) => {
  const { hub, room, pr, b } = fixture(t);
  hub.vote(room.name, b.id, pr.id, "agree", undefined, undefined, text);
  const vote = pr.votes[b.id];
  hub.challenge(room.name, b.id, pr.id, "I still question the general approach to this design.", false);
  assert.equal(pr.challenges[0].cites, undefined);
  assert.equal(pr.challenges[0].blocking, false);
  assert.equal(pr.votes[b.id], vote);
  assert.equal(hub.openChallenges(pr).length, 0);
});

test("legacy uncited blocker gives truthful advice in status and stuck notice", (t) => {
  const { hub, room, pr, b, c } = fixture(t);
  hub.challenge(room.name, b.id, pr.id, 'Does "matching proposal spans" cover legacy data?');
  // Simulate a pre-validation persisted challenge, without changing replay policy.
  delete pr.challenges[0].cites;
  for (const active of [true, false]) {
    b.active = active;
    const advice = hub.blockedBy(room, pr).join("; ");
    assert.match(advice, /legacy.*uncited|legacy.*unanchored/i);
    assert.match(advice, /Bob/);
    assert.match(advice, /re-vote.*agree/i);
    assert.match(advice, /human.*clos/i);
    if (!active) assert.match(advice, /return|rejoin/i);
    assert.doesNotMatch(advice, /amend the cited text/);
  }
  hub.vote(room.name, c.id, pr.id, "agree", "The scoped fix has been independently checked.", undefined, text);
  assert.equal(pr.status, "open");
  const notice = room.messages.at(-1)!.content;
  assert.match(notice, /legacy.*uncited|legacy.*unanchored/i);
  assert.match(notice, /human.*clos/i);
  assert.doesNotMatch(notice, /amend the text it cites/);
});
