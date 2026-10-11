/**
 * A proposal shorter than the 15-character agree quote can be agreed by quoting all of it (evidence-pack item 11,
 * bugs.md 5, sc-4450; claim/launcher-bugs). Run: npx tsx scripts/short-proposal-regression.ts
 *
 * swarm-185546-uiax proposed "TOTAL=4" (7 chars): propose accepted it, every agree was refused for a quote under
 * 15 chars, and the room concluded only after amending to 39 chars, which reset votes and repeated verification.
 */
import assert from "node:assert/strict";
import { Hub } from "../src/hub.js";

function setup(text: string) {
  const hub = new Hub({});
  const a = hub.join("r", "a", "claude", { requireChallenge: false, expectedParticipants: 3 }, undefined, "s1").participant;
  const b = hub.join("r", "b", "claude", {}, undefined, "s2").participant;
  const c = hub.join("r", "c", "claude", {}, undefined, "s3").participant;
  const pr = hub.propose("r", a.id, text);
  return { hub, a, b, c, pr, room: hub.getRoom("r") };
}
const cases: [string, () => void][] = [
  ["a short proposal is agreed by quoting all of it", () => {
    const { hub, b, c, pr, room } = setup("TOTAL=4");
    assert.doesNotThrow(() => hub.vote("r", b.id, pr.id, "agree", undefined, undefined, "TOTAL=4"));
    hub.vote("r", c.id, pr.id, "agree", undefined, undefined, " TOTAL=4 ");
    assert.equal(room.state, "concluded");
  }],
  ["a short proposal still refuses a partial quote", () => {
    const { hub, b, pr } = setup("TOTAL=4");
    assert.throws(() => hub.vote("r", b.id, pr.id, "agree", undefined, undefined, "TOTAL"), /quote/);
    assert.throws(() => hub.vote("r", b.id, pr.id, "agree", undefined, undefined, "4"), /quote/);
  }],
  ["a long proposal still needs 15 characters", () => {
    const { hub, b, pr } = setup("Adopt the measured table as the answer.");
    assert.throws(() => hub.vote("r", b.id, pr.id, "agree", undefined, undefined, "Adopt the"), /15\+ chars/);
    assert.doesNotThrow(() => hub.vote("r", b.id, pr.id, "agree", undefined, undefined, "Adopt the measured table"));
  }],
  // dev room swarm-183234-3oie-room (7836): "INSTALL" was agreed, but a cited blocking challenge was refused (it must
  // quote 12+ characters), so the mandatory-challenge gate could only be met with a contrived executable challenge
  ["a short proposal takes a blocking challenge that quotes all of it", () => {
    const hub = new Hub({});
    const a = hub.join("r", "a", "claude", { expectedParticipants: 3 }, undefined, "s1").participant;
    const b = hub.join("r", "b", "claude", {}, undefined, "s2").participant;
    hub.join("r", "c", "claude", {}, undefined, "s3");
    const pr = hub.propose("r", a.id, "INSTALL");
    assert.doesNotThrow(() => hub.challenge("r", b.id, pr.id, 'I object to "INSTALL": a README must first say what the project is, or installing it means nothing.'));
    assert.equal(hub.getRoom("r").proposals.get(pr.id)!.challenges[0].cites, "INSTALL");
  }],
  ["a short proposal still refuses a blocking challenge that quotes only part of it, or nothing", () => {
    const hub = new Hub({});
    const a = hub.join("r", "a", "claude", { expectedParticipants: 3 }, undefined, "s1").participant;
    const b = hub.join("r", "b", "claude", {}, undefined, "s2").participant;
    hub.join("r", "c", "claude", {}, undefined, "s3");
    const pr = hub.propose("r", a.id, "INSTALL");
    assert.throws(() => hub.challenge("r", b.id, pr.id, 'I object to "INST": a README must first say what the project is.'), /must quote/);
    assert.throws(() => hub.challenge("r", b.id, pr.id, "A README must first say what the project is, or installing it means nothing."), /must quote/);
  }],
  ["a long proposal still needs a 12-character quoted span to block", () => {
    const hub = new Hub({});
    const a = hub.join("r", "a", "claude", { expectedParticipants: 3 }, undefined, "s1").participant;
    const b = hub.join("r", "b", "claude", {}, undefined, "s2").participant;
    hub.join("r", "c", "claude", {}, undefined, "s3");
    const pr = hub.propose("r", a.id, "Adopt the measured table as the answer.");
    assert.throws(() => hub.challenge("r", b.id, pr.id, 'I object to "measured": nobody reran the measurement after the fix.'), /must quote/);
    assert.doesNotThrow(() => hub.challenge("r", b.id, pr.id, 'I object to "the measured table": nobody reran the measurement after the fix.'));
  }],
];
let failed = 0;
for (const [name, test] of cases) {
  try { test(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message.split("\n")[0] : error}`); }
}
if (failed) { console.error(`SHORT PROPOSAL: ${failed}/${cases.length} failed`); process.exitCode = 1; }
else console.log(`SHORT PROPOSAL OK (${cases.length} cases)`);
