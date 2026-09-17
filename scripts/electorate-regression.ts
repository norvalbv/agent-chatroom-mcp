/** Effective electorate regressions. Run: npx tsx scripts/electorate-regression.ts */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub } from "../src/hub.js";

const TEXT = "Require independent evidence before adopting this conclusion.";
const NEXT = "Require independently checked evidence before adopting this conclusion.";
const QUOTE = "before adopting this conclusion";
const ROOM = "electorate-regression";
function setup(dataDir?: string) {
  const hub = new Hub({ dataDir });
  const { room, participant: a } = hub.join(ROOM, "A", "test", { requireChallenge: true, nudgeAfterMs: 0 }, undefined, "s1");
  const { participant: b } = hub.join(ROOM, "B", "test", {}, undefined, "s2");
  const proposal = hub.propose(ROOM, a.id, TEXT);
  const agree = (id: string) => hub.vote(ROOM, id, proposal.id, "agree", "The cited concern is resolved by independent checking.", undefined, QUOTE);
  return { hub, room, a, b, proposal, agree };
}

test("an unvoted replacement cannot supply the floor while the surviving snapshot alone concludes", () => {
  const { hub, room, a, b, proposal, agree } = setup();
  hub.challenge(ROOM, b.id, proposal.id, '"independent evidence" must explicitly require checking.');
  hub.amend(ROOM, a.id, proposal.id, TEXT, NEXT);
  const { participant: c } = hub.join(ROOM, "C", "test", {}, undefined, "s3");
  hub.leave(ROOM, b.id);
  agree(a.id);
  assert.equal(room.state, "open", "unvoted C must not let A conclude alone");
  assert.deepEqual(hub.proposalView(room, proposal).waiting_on, ["C"]);
  assert.ok(hub.blockedBy(room, proposal).some((reason) => reason === "votes from C"));
  agree(c.id);
  assert.equal(room.state, "concluded");
  assert.deepEqual(room.conclusion?.tally, { agree: 2, disagree: 0, abstain: 0 });
});

test("ordinary late joiners are neither waited on nor included in the agreement tally or conclusion denominator", () => {
  const { hub, room, b, proposal, agree } = setup();
  const { participant: c } = hub.join(ROOM, "C", "test", {}, undefined, "s3");
  assert.deepEqual(hub.proposalView(room, proposal).waiting_on, ["B"]);
  assert.ok(hub.blockedBy(room, proposal).includes("votes from B"));
  agree(c.id);
  assert.deepEqual(hub.proposalView(room, proposal).tally, { agree: 1, disagree: 0, abstain: 0 });
  hub.challenge(ROOM, b.id, proposal.id, '"independent evidence" needs a checked source.');
  agree(b.id);
  assert.equal(room.state, "concluded");
  assert.deepEqual(room.conclusion?.tally, { agree: 2, disagree: 0, abstain: 0 });
  assert.match(room.messages.find((m) => m.kind === "conclusion")!.content, /\(2\/2 agree;/);
});


test("conclusion freezes electorate, excluded leavers and tally through departures and restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "electorate-"));
  try {
    const { hub, room, a, b, proposal, agree } = setup(dir);
    hub.challenge(ROOM, b.id, proposal.id, '\"independent evidence\" must explicitly require checking.');
    hub.amend(ROOM, a.id, proposal.id, TEXT, NEXT);
    const { participant: c } = hub.join(ROOM, "C", "test", {}, undefined, "s3");
    hub.leave(ROOM, b.id);
    agree(a.id);
    agree(c.id);
    const expected = { electorate: 2, agree: 2, disagree: 0, abstain: 0, excluded_leavers: 1, distinct_sessions: 2, denominator: "electorate" };
    assert.match(room.messages.find((m) => m.kind === "conclusion")!.content, /2\/2 agree; 1 leavers-before-close excluded; quorum=unanimous/);
    assert.deepEqual(hub.stats(room).conclusion_electorate, expected);
    hub.leave(ROOM, a.id);
    hub.leave(ROOM, c.id);
    assert.deepEqual(hub.proposalView(room, proposal).tally, room.conclusion?.tally);
    assert.deepEqual(hub.stats(room).conclusion_electorate, expected);
    const restored = new Hub({ dataDir: dir });
    const rr = restored.getRoom(ROOM);
    assert.deepEqual(restored.proposalView(rr, rr.proposals.get(proposal.id)!).tally, room.conclusion?.tally);
    assert.deepEqual(restored.stats(rr).conclusion_electorate, expected);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("majority cannot use aliases to skip an independent replacement vote", () => {
  const hub = new Hub();
  const { room, participant: a } = hub.join(ROOM, "A", "test", { quorum: "majority", requireChallenge: true, nudgeAfterMs: 0 }, undefined, "s1");
  const alias = hub.join(ROOM, "Alias", "test", {}, undefined, "s1").participant;
  const b = hub.join(ROOM, "B", "test", {}, undefined, "s2").participant;
  const pr = hub.propose(ROOM, a.id, TEXT);
  hub.challenge(ROOM, b.id, pr.id, '\"independent evidence\" must explicitly require checking.');
  hub.amend(ROOM, a.id, pr.id, TEXT, NEXT);
  hub.join(ROOM, "LateAlias", "test", {}, undefined, "s1");
  const c = hub.join(ROOM, "C", "test", {}, undefined, "s3").participant;
  hub.join(ROOM, "D", "test", {}, undefined, "s4");
  hub.leave(ROOM, b.id);
  const agree = (id: string) => hub.vote(ROOM, id, pr.id, "agree", "Checked independently.", undefined, QUOTE);
  agree(a.id); agree(alias.id);
  assert.equal(room.state, "open");
  assert.deepEqual(hub.proposalView(room, pr).waiting_on, ["C"]);
  assert.equal(hub.leavingWouldBlock(room, c), undefined, "D can replace C on departure");
  agree(c.id);
  assert.equal(room.state, "concluded");
});
