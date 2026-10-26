/**
 * A disagree that quotes the clause it objects to stands across amends that keep that clause (server chair note 3,
 * swarm-164210-9f66, claim/verifier-hold-and-breakout-review). The 9f66 verifier had checked the final text and was
 * waiting on three breakout slots marked [PENDING]; it said so by voting disagree "HOLD, not a content objection".
 * Every amend dropped that disagree (src/hub.ts amend kept only agrees whose quote survived), so it cast it on v7 and
 * re-cast it four times (v8, v9, v10, v14), promised a note "at least every 8 minutes" (#2837; its gaps were 0.8-9.3
 * min) to stay under the verifier-silence lapse, and a worker had to warn it that the room could close without bk2
 * (#2907). The vote tool already said a disagree "stands until you re-vote or that text is amended"; the code did not.
 * Over 319 room logs on hub 7717, 267 disagrees were dropped by an amend and 106 were re-cast by the same seat on a
 * later version. Gerrit keeps a Code-Review -2 "valid across all patch sets" and GitHub keeps a "Request changes"
 * review until its author approves (sources/gerrit-config-labels, sources/github-protected-branches). Now a disagree
 * may carry `quote`; an amend that keeps the quoted clause keeps the disagree, as it keeps an agree, and it counts as
 * standing. A disagree with no quote resets as before.
 * Second half: a verifier whose disagree stands on the current text no longer "owes a vote". It did (needsVote), so
 * hold_until_actionable never held it: in 9f66 its waits returned after a median 9.1 s (n=26) while its disagree stood,
 * against 55 s for the five other seats (n=81) while it stood (between 23:58 and 00:28).
 * Run: npx tsx --test scripts/disagree-carry-regression.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hub } from "../src/hub.js";

const BK5 = "- bk5, fast-cancel maker feasibility: [PENDING]";
const BK4 = "- bk4, fastest signal: [PENDING]";
const BK2 = "- bk2, busy-evening filters, held-out grade: [PENDING]";
const TEXT = `CONCLUSION. The broad rule is not shown to pay at our speed.\n${BK5}\n${BK4}\n${BK2}\nOwner input: none yet.`;
const QUOTE = "The broad rule is not shown to pay at our speed.";

function setup(room: string, quorum: "supermajority" | "unanimous" = "supermajority") {
  Hub.LAST_CALL_MS = 0;
  const hub = new Hub();
  const opts = { quorum, nudgeAfterMs: 0, requireChallenge: false };
  const [a, b, c, d] = ["A", "B", "C", "D"].map((n, i) => hub.join(room, n, "test", i ? {} : opts, undefined, `s${i}`).participant);
  const v = hub.join(room, "verifier", "test", {}, undefined, "sv", "verifier").participant;
  const pr = hub.propose(room, a.id, TEXT);
  const agree = (id: string) => hub.vote(room, id, pr.id, "agree", "checked against the sources", undefined, QUOTE);
  return { hub, r: hub.getRoom(room), a, b, c, d, v, pr, agree };
}

test("a quoted disagree survives an amend that keeps its clause, and still blocks as the verifier's", () => {
  const { hub, r, a, b, c, d, v, pr, agree } = setup("dc-carry");
  hub.vote(r.name, v.id, pr.id, "disagree", "HOLD, not a content objection: checked; agree once bk2 lands", undefined, BK2);
  agree(b.id); agree(c.id); agree(d.id);
  hub.amend(r.name, a.id, pr.id, BK5, "- bk5, fast-cancel maker feasibility: NOT PLAUSIBLE (inbox/bk5/result)");
  assert.equal(pr.version, 2);
  assert.equal(pr.votes[v.id]?.vote, "disagree", "the bk2 line is untouched, so the verifier's hold stands");
  assert.deepEqual(hub.standingDisagrees(pr).map((x) => x.name), ["verifier"], "a carried disagree is a standing objection");
  const amendLine = r.messages.filter((m) => m.kind === "amend").at(-1)!.content;
  assert.match(amendLine, /verifier's disagree stands/, "the room is told the hold carried");
  hub.amend(r.name, a.id, pr.id, BK4, "- bk4, fastest signal: NO feed set is GO (inbox/bk4/result)");
  assert.equal(pr.votes[v.id]?.vote, "disagree", "still standing after a second unrelated amend");
  agree(a.id);
  assert.equal(r.state, "open", "4/5 agree on v3 but the verifier's carried disagree blocks");
  assert.ok(hub.blockedBy(r, pr).some((x) => /the verifier's agree/.test(x) && /HOLD/.test(x)), "blocked_by names the hold, not 'has not voted'");
  // review/dd4195b8 nit a: room_status must not call the vote blocked_by names "stale"
  const shown = hub.proposalView(r, pr).votes.find((x) => x.name === "verifier") as { stale?: string; carried?: string };
  assert.equal(shown.stale, undefined, "a carried vote is not stale");
  assert.equal(shown.carried, "cast at v1; its quoted clause is unchanged in v3");
});

test("an amend that replaces the quoted clause drops the disagree; the verifier then checks and agrees once", () => {
  const { hub, r, a, b, c, d, v, pr, agree } = setup("dc-answered");
  hub.vote(r.name, v.id, pr.id, "disagree", "HOLD: agree once bk2 lands with its held-out grade", undefined, BK2);
  agree(b.id); agree(c.id); agree(d.id);
  hub.amend(r.name, a.id, pr.id, BK2, "- bk2, busy-evening filters, held-out grade: NO filter is adopted (F1 t 1.76)");
  assert.equal(pr.votes[v.id], undefined, "its clause is gone, so the disagree is answered and reset");
  assert.ok(hub.needsVote(r, v, pr), "the verifier owes a vote on the filled text");
  agree(a.id); agree(b.id);
  hub.vote(r.name, v.id, pr.id, "agree", "bk2 line matches my rerun", undefined, QUOTE);
  assert.equal(r.state, "concluded");
});

test("a disagree with no quote resets on any amend, as before", () => {
  const { hub, r, a, v, pr } = setup("dc-unquoted");
  hub.vote(r.name, v.id, pr.id, "disagree", "HOLD for owner input: not a content objection");
  hub.amend(r.name, a.id, pr.id, "Owner input: none yet.", "Owner input: keep.");
  assert.equal(pr.votes[v.id], undefined);
  assert.deepEqual(hub.standingDisagrees(pr), []);
});

test("a disagree's quote must be verbatim in the text, like an agree's", () => {
  const { hub, r, v, pr } = setup("dc-badquote");
  assert.throws(
    () => hub.vote(r.name, v.id, pr.id, "disagree", "this clause overstates the result", undefined, "the broad rule loses money at every speed"),
    /quote is not in/,
  );
});

test("a verifier whose disagree stands on the current text does not owe a vote, so a held wait can hold", () => {
  const { hub, r, a, v, pr } = setup("dc-owes");
  assert.ok(hub.needsVote(r, v, pr), "before voting it owes one");
  hub.vote(r.name, v.id, pr.id, "disagree", "HOLD: agree once bk2 lands", undefined, BK2);
  assert.equal(hub.needsVote(r, v, pr), false, "it has voted on this text; it owes nothing until the text changes");
  assert.equal(hub.actionableNow(r, v), false, "so chatter does not wake its hold_until_actionable wait");
  hub.amend(r.name, a.id, pr.id, BK4, "- bk4, fastest signal: NO GO");
  assert.equal(hub.needsVote(r, v, pr), false, "its quoted clause survived the amend, so its disagree still answers this version");
  hub.amend(r.name, a.id, pr.id, BK2, "- bk2: NO filter adopted");
  assert.ok(hub.needsVote(r, v, pr), "its clause changed: now it owes a vote");
});

test("in a unanimous room a carried disagree keeps the proposal from passing until its author re-votes", () => {
  const { hub, r, a, b, c, d, v, pr, agree } = setup("dc-unanimous", "unanimous");
  hub.vote(r.name, b.id, pr.id, "disagree", "this headline overstates what paper shows", undefined, QUOTE);
  hub.amend(r.name, a.id, pr.id, "Owner input: none yet.", "Owner input: keep.");
  agree(a.id); agree(c.id); agree(d.id); agree(v.id);
  assert.equal(r.state, "open", "B's objection to the headline was not touched by the amend");
  assert.deepEqual(hub.standingDisagrees(pr).map((x) => x.name), ["B"]);
  agree(b.id);
  assert.equal(r.state, "concluded");
});

test("a departed seat's carried disagree does not hold a unanimous room (attack/decision/verifier-hold)", () => {
  const { hub, r, a, b, c, d, v, pr, agree } = setup("dc-departed", "unanimous");
  hub.vote(r.name, b.id, pr.id, "disagree", "this headline overstates what paper shows", undefined, QUOTE);
  hub.leave(r.name, b.id, "done");
  hub.amend(r.name, a.id, pr.id, "Owner input: none yet.", "Owner input: keep.");
  assert.deepEqual(hub.standingDisagrees(pr), [], "nobody can ask a departed seat to re-vote, so its carried disagree does not stand");
  // review/dea5937a N2: room_status must not leave the reader to infer that a carried vote blocks when it does not
  const shown = hub.proposalView(r, pr).votes.find((x) => x.name === "B") as { carried?: string };
  assert.equal(shown.carried, "cast at v1; its quoted clause is unchanged in v2, but its author left, so it does not stand");
  agree(a.id); agree(c.id); agree(d.id); agree(v.id);
  assert.equal(r.state, "concluded", "as before the carry: an amend cleared a departed seat's disagree");
});

test("a carried disagree survives a hub restart (replayed from the amend event)", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "disagree-carry-"));
  try {
    Hub.LAST_CALL_MS = 0;
    const hub = new Hub({ dataDir: dir });
    const name = "dc-replay";
    const a = hub.join(name, "A", "test", { quorum: "supermajority", nudgeAfterMs: 0, requireChallenge: false }, undefined, "s0").participant;
    const b = hub.join(name, "B", "test", {}, undefined, "s1").participant;
    const pr = hub.propose(name, a.id, TEXT);
    hub.vote(name, b.id, pr.id, "disagree", "HOLD until bk2 lands with its grade", undefined, BK2);
    hub.amend(name, a.id, pr.id, BK5, "- bk5: NOT PLAUSIBLE");
    const room = hub.getRoom(name);
    clearTimeout(room.nudgeTimer);
    clearTimeout(room.openingsTimer);
    const again = new Hub({ dataDir: dir });
    const pr2 = again.getRoom(name).proposals.get(pr.id)!;
    assert.equal(pr2.version, 2);
    assert.equal(pr2.votes[b.id]?.vote, "disagree", "the carried disagree is in the amend event's votes");
    assert.deepEqual(again.standingDisagrees(pr2).map((x) => x.name), ["B"]);
    const r2 = again.getRoom(name);
    clearTimeout(r2.nudgeTimer);
    clearTimeout(r2.openingsTimer);
    // the telemetry reads the same event: scripts/vote-recast.ts counts it as carried, not dropped
    const { recastRow } = await import("./vote-recast.js");
    const row = await recastRow(join(dir, `${name}.jsonl`));
    assert.equal(row.amends, 1);
    assert.equal(row.carried, 1);
    assert.equal(row.dropped, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
