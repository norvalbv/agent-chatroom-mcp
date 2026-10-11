/**
 * Last call (evidence-pack item 1, swarm-180216-182a): a proposal that reaches consensus ended the room at once. In 13
 * concluded rooms on hub 7717, 11 concluded within 14 s of the last amend, the verifier had not voted on the final text
 * in 6, and 9 had a vote, amend or board write refused within 17 s of the conclusion (/tmp/c1/recount.mjs). Now a
 * proposal that has the votes while someone in the electorate has not voted on its current version gets a LAST CALL:
 * the room is told who it is waiting for and when it closes, those seats owe a vote, and the room concludes when the
 * window ends or as soon as everyone has voted on that version. The conclusion records how it closed (telemetry).
 * Red on main: the majority vote concludes the room at once.
 * Run: npx tsx scripts/last-call-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub } from "../src/hub.js";

const TEXT = "Adopt the cache: reads are faster in scripts/bench.ts and nothing else changes.";
const QUOTE = "nothing else changes";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(room: string, lastCallMs: number, dataDir?: string) {
  Hub.LAST_CALL_MS = lastCallMs;
  const hub = new Hub({ dataDir });
  const { room: r, participant: a } = hub.join(room, "A", "test", { quorum: "majority", nudgeAfterMs: 0, expectedParticipants: 3, requireChallenge: false }, undefined, "s1");
  const { participant: b } = hub.join(room, "B", "test", {}, undefined, "s2");
  const { participant: v } = hub.join(room, "verifier", "test", {}, undefined, "s3", "verifier");
  const pr = hub.propose(room, a.id, TEXT);
  const agree = (id: string) => hub.vote(room, id, pr.id, "agree", "checked", undefined, QUOTE);
  return { hub, r, a, b, v, pr, agree };
}

test("majority with a seat unvoted opens a last call instead of concluding", async () => {
  const { hub, r, b, v, pr, agree } = setup("lc-window", 300);
  agree(b.id);
  assert.equal(r.state, "open", "a majority with the verifier unvoted must not conclude at once");
  const notice = r.messages.find((m) => m.kind === "system" && /LAST CALL/.test(m.content));
  assert.ok(notice, "the room is told it is in last call");
  assert.match(notice!.content, /verifier/, "the notice names who has not voted on the current version");
  assert.ok(hub.needsVote(r, v, pr), "the unvoted seat owes a vote during last call");
  assert.ok(hub.blockedBy(r, pr).some((x) => /last call/.test(x)), "blocked_by says the room is in last call");
  // board writes still land during the window
  hub.setBoard("lc-window", v.id, "result/late", "late result");
  await sleep(450);
  assert.equal(r.state, "concluded", "the window ends and the room concludes on the votes it has");
  const c = r.conclusion!.closing!;
  assert.equal(c.ended, "window");
  assert.deepEqual(c.not_voted_on_final.map((x) => x.name), ["verifier"]);
  assert.equal(c.not_voted_on_final[0].role, "verifier");
  assert.ok(c.last_call_seconds !== undefined && c.last_call_seconds >= 0.2);
  assert.match(r.messages.find((m) => m.kind === "conclusion")!.content, /not voted on v1: verifier/i);
});

test("everyone voting on the current version ends the last call at once", () => {
  const { r, b, v, agree } = setup("lc-early", 60_000);
  agree(b.id);
  assert.equal(r.state, "open");
  agree(v.id);
  assert.equal(r.state, "concluded", "nobody left to wait for: conclude now");
  assert.equal(r.conclusion!.closing!.ended, "all_voted");
  assert.deepEqual(r.conclusion!.closing!.not_voted_on_final, []);
});

test("a room where everyone has voted concludes with no last call at all", () => {
  Hub.LAST_CALL_MS = 60_000;
  const hub = new Hub();
  const { room: r, participant: a } = hub.join("lc-none", "A", "test", { nudgeAfterMs: 0, requireChallenge: false }, undefined, "s1");
  const { participant: b } = hub.join("lc-none", "B", "test", {}, undefined, "s2");
  const pr = hub.propose("lc-none", a.id, TEXT);
  hub.vote("lc-none", b.id, pr.id, "agree", "ok", undefined, QUOTE);
  assert.equal(r.state, "concluded");
  assert.ok(!r.messages.some((m) => /LAST CALL/.test(m.content)), "no last call when nobody is unvoted");
  assert.equal(r.conclusion!.closing!.last_call_seconds, undefined);
  assert.ok(r.conclusion!.closing!.seconds_from_proposal >= 0);
});

test("an amend during last call drops it; the new version gets its own; LAST_CALL_MS=0 restores the old behaviour", async () => {
  const { r, a, b, pr, hub, agree } = setup("lc-amend", 200);
  agree(b.id);
  hub.amend("lc-amend", a.id, pr.id, "nothing else changes", "only reads change");
  await sleep(300);
  assert.equal(r.state, "open", "a version without the votes does not conclude when the old window ends");
  hub.vote("lc-amend", b.id, pr.id, "agree", "ok", undefined, "only reads change");
  hub.vote("lc-amend", a.id, pr.id, "agree", "ok", undefined, "only reads change");
  assert.equal(r.state, "open", "v2 has the votes but the verifier has not voted on it: a new last call");
  assert.equal(r.messages.filter((m) => /LAST CALL/.test(m.content)).length, 2);
  assert.match(r.messages.filter((m) => /LAST CALL/.test(m.content))[1].content, /v2/);
  const off = setup("lc-off", 0);
  off.agree(off.b.id);
  assert.equal(off.r.state, "concluded");
  assert.equal(off.r.conclusion!.closing!.ended, "none");
  Hub.LAST_CALL_MS = 0;
});

test("a seat that has voted but holds a take/* keeps the room open until it releases it", async () => {
  const { hub, r, b, v, agree } = setup("lc-take", 60_000);
  hub.setBoard("lc-take", b.id, "take/rerun-join", "outside rerun still running");
  agree(b.id);
  agree(v.id);
  assert.equal(r.state, "open", "everyone voted, but B said it is still doing something");
  const notice = r.messages.find((m) => m.kind === "system" && /LAST CALL/.test(m.content))!;
  assert.match(notice.content, /take\/rerun-join \(B\)/, "the notice names the take and its holder");
  hub.setBoard("lc-take", b.id, "result/rerun-join", "the rerun landed: 3 of 3");
  hub.setBoard("lc-take", b.id, "take/rerun-join", "");
  assert.equal(r.state, "concluded", "releasing the take ends the last call");
  assert.equal(r.conclusion!.closing!.ended, "all_voted");
  assert.equal(r.conclusion!.closing!.takes_held, undefined);
  assert.ok(r.board.has("result/rerun-join"), "the late result is on the board");
});

test("the last call is logged as an event", () => {
  const dir = mkdtempSync(join(tmpdir(), "last-call-"));
  const { b, agree } = setup("lc-log", 60_000, dir);
  agree(b.id);
  const lines = readFileSync(join(dir, "lc-log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const ev = lines.find((e) => e.type === "last_call");
  assert.ok(ev, "a last_call event is persisted");
  assert.deepEqual(ev.waiting_on, ["verifier"]);
  assert.equal(ev.version, 1);
  Hub.LAST_CALL_MS = 0; // let node:test exit without the open window's timer mattering
});
