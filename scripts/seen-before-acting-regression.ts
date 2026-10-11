/**
 * Was a vote or challenge made on text the seat had been sent? (telemetry gap G13, evidence-pack item 1: in 00cp three
 * challenges arrived 6, 16 and 21 s after the proposal and 7 amends followed within 74 s; "the text was negotiated
 * before the proposal existed, and the log cannot show where"). The hub now records when each seat was first delivered
 * the message that made the current version, and every vote and challenge carries seen_s (seconds from that delivery
 * to the act; absent: the hub never delivered that version to the seat) and since_text_s (seconds since the version was
 * written). A challenge 6 s after delivery on a long text, or a vote with no seen_s, is visible in the record.
 * Red on main: neither field exists.
 * Run: npx tsx scripts/seen-before-acting-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub } from "../src/hub.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("votes and challenges say how long after the seat was sent the version they act on", async () => {
  Hub.LAST_CALL_MS = 0;
  const dir = mkdtempSync(join(tmpdir(), "seen-before-"));
  const hub = new Hub({ dataDir: dir });
  const a = hub.join("sb-room", "A", "test", { nudgeAfterMs: 0, quorum: "majority" }, undefined, "s1").participant;
  const b = hub.join("sb-room", "B", "test", {}, undefined, "s2").participant;
  const c = hub.join("sb-room", "C", "test", {}, undefined, "s3").participant;
  const room = hub.getRoom("sb-room");
  const deliver = (p: typeof a) => hub.settleRead(room, p, p.lastSeenSeq, room.messages.filter((m) => m.seq > p.lastSeenSeq));
  const pr = hub.propose("sb-room", a.id, "Use --no-cache: the three existing opt-outs are all spelled --no-.");
  deliver(b);
  await sleep(150);
  hub.challenge("sb-room", b.id, pr.id, `"all spelled --no-" is wrong: --claude-full is an opt-out too.`);
  const ch = pr.challenges.at(-1)!;
  assert.ok(ch.seen_s !== undefined && ch.seen_s >= 0.1, `B's challenge came ${ch.seen_s} s after B was sent v1`);
  assert.ok(ch.since_text_s !== undefined && ch.since_text_s >= 0.1);
  // C was never delivered the proposal: its vote carries no seen_s, so a vote on unsent text shows
  hub.vote("sb-room", c.id, pr.id, "agree", "the challenge is about wording only, the count still holds", undefined, "the three existing opt-outs");
  assert.equal(pr.votes[c.id].seen_s, undefined, "C acted on a version the hub never sent it");
  assert.ok(pr.votes[c.id].since_text_s !== undefined);
  // after an amend, the clock is the new version's; C agrees to v2 without ever being sent it
  hub.amend("sb-room", a.id, pr.id, "all spelled --no-", "spelled --no-, beside --claude-full");
  hub.vote("sb-room", c.id, pr.id, "agree", "v2 is right as far as I can tell", undefined, "beside --claude-full");
  assert.equal(room.state, "open");
  deliver(b);
  hub.vote("sb-room", b.id, pr.id, "agree", "answered: v2 names --claude-full now", undefined, "beside --claude-full");
  assert.ok(pr.votes[b.id].seen_s !== undefined && pr.votes[b.id].seen_s! < 0.1, "B's vote is timed from its delivery of v2, not v1");
  assert.equal(room.state, "concluded");
  assert.deepEqual(room.conclusion!.closing!.agreed_unsent, ["C"], "the conclusion names who agreed to text it was never sent");
  const evs = readFileSync(join(dir, "sb-room.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(evs.some((e) => e.type === "challenge" && e.challenge.seen_s !== undefined), "the challenge event carries it");
  assert.ok(evs.some((e) => e.type === "vote" && e.entry.since_text_s !== undefined), "the vote event carries it");
});

test("after a hub restart a version made before it is 'unknown', not 'never sent'", async () => {
  // review/83871804 (claude-opus-5-5-2): delivery stamps are in memory, so a restart must not turn readers into non-readers
  Hub.LAST_CALL_MS = 0;
  const dir = mkdtempSync(join(tmpdir(), "seen-restart-"));
  const hub = new Hub({ dataDir: dir });
  const a = hub.join("sr-room", "A", "test", { nudgeAfterMs: 0, quorum: "majority" }, undefined, "s1").participant;
  const b = hub.join("sr-room", "B", "test", {}, undefined, "s2").participant;
  hub.join("sr-room", "C", "test", {}, undefined, "s3");
  const pr = hub.propose("sr-room", a.id, "Use --no-cache: the three existing opt-outs are all spelled --no-.");
  const room = hub.getRoom("sr-room");
  hub.settleRead(room, b, b.lastSeenSeq, room.messages.filter((m) => m.seq > b.lastSeenSeq)); // B was sent v1 before the restart
  await sleep(5); // a restart is never in the same millisecond as the message in life; the hub must not depend on it either way
  const restored = new Hub({ dataDir: dir });
  restored.join("sr-room", "B", "test", {}, b.id, "s2");
  restored.join("sr-room", "A", "test", {}, a.id, "s1");
  const rpr = restored.getRoom("sr-room").proposals.get(pr.id)!;
  restored.vote("sr-room", b.id, pr.id, "agree", "read it before the restart", undefined, "the three existing opt-outs");
  assert.equal(rpr.votes[b.id].seen_s, undefined);
  assert.equal(rpr.votes[b.id].seen_unknown, true, "not known, rather than never sent");
  const c = restored.getRoom("sr-room");
  if (c.state === "concluded") assert.equal(c.conclusion!.closing!.agreed_unsent, undefined, "and not listed as agreeing unsent");
});
