/** Connection-identity regression for the independent challenge gate.
 * Run against source: npx tsx scripts/challenge-session-regression.ts
 */
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub, HubError, type Challenge, type RoomOptions } from "../src/hub.js";

const TEXT = "Use independent evidence to reach the conclusion.";
const QUOTE = "Use independent evidence";
const OBJECTION = '"independent evidence" needs an explicit source before acceptance.';
const REASON = "The independent source has now been checked and the objection is resolved.";
const ROOM = "challenge-session-regression";

function setup(opts: RoomOptions = {}, sessions = true, dataDir?: string) {
  const hub = new Hub({ dataDir });
  const { room, participant: a } = hub.join(ROOM, "A", "test", {
    requireChallenge: true, nudgeAfterMs: 0, ...opts,
  }, undefined, sessions ? "s1" : undefined);
  const { participant: alias } = hub.join(ROOM, "A2", "test", {}, undefined, sessions ? "s1" : undefined);
  const { participant: b } = hub.join(ROOM, "B", "test", {}, undefined, sessions ? "s2" : undefined);
  const proposal = hub.propose(ROOM, a.id, TEXT);
  const agree = (pid: string) => hub.vote(ROOM, pid, proposal.id, "agree", REASON, undefined, QUOTE);
  return { hub, room, a, alias, b, proposal, agree };
}

for (const requireChallenge of [true, false] as const) {
  test(`same-session blocking challenge rejected without mutation (gate=${requireChallenge})`, () => {
    const { hub, room, alias, proposal, agree } = setup({ requireChallenge });
    agree(alias.id); // rejection must not erase this vote
    const before = JSON.stringify({ challenges: proposal.challenges, votes: proposal.votes, messages: room.messages });
    assert.throws(() => hub.challenge(ROOM, alias.id, proposal.id, OBJECTION), HubError);
    assert.equal(JSON.stringify({ challenges: proposal.challenges, votes: proposal.votes, messages: room.messages }), before);
  });
}

test("independent session supplies scrutiny and permits conclusion", () => {
  const { hub, room, alias, b, proposal, agree } = setup();
  agree(alias.id);
  agree(b.id);
  assert.equal(room.state, "open", "votes alone cannot satisfy required scrutiny");
  hub.challenge(ROOM, b.id, proposal.id, OBJECTION);
  assert.equal(proposal.challenges.length, 1);
  assert.equal(proposal.votes[b.id], undefined, "blocking challenge clears challenger vote");
  agree(b.id);
  assert.equal(room.state, "concluded");
});

test("nonblocking alias objection remains allowed but does not supply scrutiny", () => {
  const { hub, room, alias, b, proposal, agree } = setup();
  hub.challenge(ROOM, alias.id, proposal.id, OBJECTION, false);
  agree(alias.id);
  agree(b.id);
  assert.equal(room.state, "open");
  assert.equal(hub.proposalView(room, proposal).needs_challenge, true);
  hub.challenge(ROOM, b.id, proposal.id, OBJECTION);
  agree(b.id);
  assert.equal(room.state, "concluded");
});

test("sessionless callers retain distinct-participant compatibility", () => {
  const { hub, room, a, alias, b, proposal, agree } = setup({}, false);
  assert.throws(() => hub.challenge(ROOM, a.id, proposal.id, OBJECTION), HubError);
  hub.challenge(ROOM, alias.id, proposal.id, OBJECTION);
  agree(alias.id);
  agree(b.id);
  assert.equal(room.state, "concluded");
});

test("evaluation rechecks current session identity of a stored conceded challenge", () => {
  const { hub, room, alias, b, proposal, agree } = setup();
  // Model a legacy record already admitted before the identity guard existed.
  const legacy: Challenge = {
    by: { id: alias.id, name: alias.name }, objection: OBJECTION,
    ts: new Date().toISOString(), version: proposal.version,
    status: "conceded", blocking: true, cites: "independent evidence",
  };
  proposal.challenges.push(legacy);
  agree(alias.id);
  agree(b.id);
  assert.equal(room.state, "open", "legacy same-session scrutiny must not conclude");
  assert.equal(hub.proposalView(room, proposal).needs_challenge, true);
  assert.ok(hub.blockedBy(room, proposal).some((reason) => /challenge|scrutiny/.test(reason) && /different connection|someone other/.test(reason)));
  hub.challenge(ROOM, b.id, proposal.id, OBJECTION);
  agree(b.id);
  assert.equal(room.state, "concluded");
});

test("persisted legacy same-session challenge cannot satisfy scrutiny after replay", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "challenge-session-"));
  try {
    const { a, alias, b, proposal } = setup({}, true, dataDir);
    // A historical event may exist even though new admission now rejects it.
    const challenge: Challenge = {
      by: { id: alias.id, name: alias.name }, objection: OBJECTION,
      ts: new Date().toISOString(), version: proposal.version,
      status: "conceded", blocking: true, cites: "independent evidence",
    };
    appendFileSync(join(dataDir, `${ROOM}.jsonl`), JSON.stringify({
      type: "challenge", room: ROOM, proposalId: proposal.id, challenge, votes: proposal.votes,
    }) + "\n");
    const hub = new Hub({ dataDir });
    for (const p of [a, alias, b]) hub.join(ROOM, p.name, "test", {}, p.id, p.session);
    const room = hub.getRoom(ROOM);
    const restored = room.proposals.get(proposal.id)!;
    const agree = (pid: string) => hub.vote(ROOM, pid, proposal.id, "agree", REASON, undefined, QUOTE);
    assert.equal(room.participants.get(alias.id)?.session, "s1");
    agree(alias.id);
    agree(b.id);
    assert.equal(room.state, "open", "replayed alias scrutiny must not conclude");
    assert.equal(hub.proposalView(room, restored).needs_challenge, true);
    assert.ok(hub.blockedBy(room, restored).some((reason) => /challenge from someone other/.test(reason)));
    hub.challenge(ROOM, b.id, proposal.id, OBJECTION);
    agree(b.id);
    assert.equal(room.state, "concluded");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
