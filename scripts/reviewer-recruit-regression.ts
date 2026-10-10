/**
 * A claim's reviewer is a standing seat, not a one-brief recruit (swarm-000525-jcz8, remaining/verification).
 * The hub picked recruits as reviewers there and both left without reviewing (deadline-builder for claim/launcher-seat-port,
 * port-guard-builder for claim/verify-gaps: "I am a one-brief recruit and I am leaving now"). Across 256 past room logs
 * plus that room, 11 of 13 claims whose hub-assigned reviewer was a recruit never got a verify/* from it, against 231 of
 * 473 for standing seats (scripts/reviewer-recruit-measure.py). A recruit is still picked when it is the only one who can.
 * Run: npx tsx scripts/reviewer-recruit-regression.ts
 */
import assert from "node:assert/strict";
import { Hub } from "../src/hub.js";

let failed = 0;
function test(name: string, run: () => void) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).message.split("\n")[0]}`);
  }
}

const claim = (area: string, owner: string) => JSON.stringify({ area, owner, team: [owner], status: "open" });
let serial = 0;

test("a recruit that joined first and has the lightest load is passed over for a standing seat", () => {
  const h = new Hub();
  const name = `reviewer-recruit-${++serial}`;
  const owner = h.join(name, "owner", "test", {}, undefined, "s-o").participant;
  h.join(name, "builder-recruit", "claude", {}, undefined, "s-r", "recruit");
  const bob = h.join(name, "bob", "test", {}, undefined, "s-b").participant;
  const e = h.setBoard(name, owner.id, "claim/area", claim("area", "owner"))!;
  assert.equal(e.reviewer, bob.name);
});

test("load still balances across standing seats; recruits are skipped every time", () => {
  const h = new Hub();
  const name = `reviewer-recruit-${++serial}`;
  const owner = h.join(name, "owner", "test", {}, undefined, "s-o").participant;
  h.join(name, "r1", "claude", {}, undefined, "s-r1", "recruit");
  h.join(name, "bob", "test", {}, undefined, "s-b");
  h.join(name, "carol", "test", {}, undefined, "s-c");
  const got = ["a", "b", "c", "d"].map((x) => h.setBoard(name, owner.id, `claim/${x}`, claim(x, "owner"))!.reviewer);
  assert.deepEqual(got, ["bob", "carol", "bob", "carol"]);
});

test("a recruit is still assigned when it is the only other connection", () => {
  const h = new Hub();
  const name = `reviewer-recruit-${++serial}`;
  const owner = h.join(name, "owner", "test", {}, undefined, "s-o").participant;
  h.join(name, "r1", "claude", {}, undefined, "s-r1", "recruit");
  const e = h.setBoard(name, owner.id, "claim/area", claim("area", "owner"))!;
  assert.equal(e.reviewer, "r1", "better a recruit than no reviewer");
});

test("a recruit's own claim gets a standing reviewer too", () => {
  const h = new Hub();
  const name = `reviewer-recruit-${++serial}`;
  h.join(name, "owner", "test", {}, undefined, "s-o");
  const r = h.join(name, "r1", "claude", {}, undefined, "s-r1", "recruit").participant;
  h.join(name, "r2", "claude", {}, undefined, "s-r2", "recruit");
  const e = h.setBoard(name, r.id, "claim/area", claim("area", "r1"))!;
  assert.equal(e.reviewer, "owner");
});

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("REVIEWER RECRUIT OK");
