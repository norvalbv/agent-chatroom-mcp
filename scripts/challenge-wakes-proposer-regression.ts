/**
 * A challenge on your own proposal is something you must act on (evidence/held-wait-misses-challenge, swarm-180216-182a).
 * In A/B round 2 on the integration build, two seats challenged a proposal and then all five seats, the proposer
 * included, sat in held waits for 172-188 s until the hub's "3 min of silence" line woke them; the amends came 4 s
 * later. 6090b3a1 bounds how long chatter is skipped (back to the seat's own wait budget); this makes the challenge
 * itself actionable for the proposer, so its held wait returns at once instead of at the end of that budget. Only an
 * undelivered, open, blocking challenge on a proposal the seat made counts; once delivered it no longer wakes it.
 * Red on main: actionableNow is false for the proposer.
 * Run: npx tsx scripts/challenge-wakes-proposer-regression.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hub } from "../src/hub.js";

function setup() {
  Hub.LAST_CALL_MS = 0;
  const hub = new Hub();
  const a = hub.join("cw-room", "A", "test", { nudgeAfterMs: 0 }, undefined, "s1").participant;
  const b = hub.join("cw-room", "B", "test", {}, undefined, "s2").participant;
  const c = hub.join("cw-room", "C", "test", {}, undefined, "s3").participant;
  const room = hub.getRoom("cw-room");
  const pr = hub.propose("cw-room", a.id, "Use --no-cache: the three existing opt-outs are all spelled --no-.");
  hub.vote("cw-room", b.id, pr.id, "agree", "checked", undefined, "the three existing opt-outs");
  const deliverAll = (p: typeof a) => hub.settleRead(room, p, p.lastSeenSeq, room.messages.filter((m) => m.seq > p.lastSeenSeq));
  for (const p of [a, b, c]) deliverAll(p);
  return { hub, room, a, b, c, pr, deliverAll };
}

test("a challenge on the seat's own proposal wakes it; delivering it ends that", () => {
  const { hub, room, a, c, pr, deliverAll } = setup();
  assert.equal(hub.actionableNow(room, a), false, "nothing is owed by the proposer before the challenge");
  hub.challenge("cw-room", c.id, pr.id, `"all spelled --no-" is wrong: --claude-full is an opt-out too.`);
  assert.equal(hub.actionableNow(room, a), true, "the proposer owes an answer: its held wait returns now");
  deliverAll(a);
  assert.equal(hub.actionableNow(room, a), false, "once delivered it does not keep waking the proposer");
});

test("it is only the proposer's: a non-blocking objection, or someone else's proposal, does not wake it", () => {
  const { hub, room, a, b, c, pr } = setup();
  hub.challenge("cw-room", c.id, pr.id, `"all spelled --no-" may miss env-var opt-outs.`, false);
  assert.equal(hub.actionableNow(room, a), false, "a recorded, non-blocking objection is not owed an answer");
  hub.challenge("cw-room", c.id, pr.id, `"the three existing opt-outs" is wrong: --claude-full makes four.`);
  assert.equal(hub.actionableNow(room, b), false, "a seat that is not the proposer is not woken by it (it may be by owing a vote)");
});
