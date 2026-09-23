/** Pool item 3 (swarm-105804): a challenge quoting the clause an open challenge already quotes is refused with that
 * challenge's id unless confirm=true. Run: npx tsx scripts/duplicate-challenge-regression.ts */
import assert from "node:assert/strict";
import { Hub, HubError } from "../src/hub.js";

const hub = new Hub();
const ROOM = "duplicate-challenge";
const { room, participant: a } = hub.join(ROOM, "A", "test", { requireChallenge: true, nudgeAfterMs: 0 });
const { participant: b } = hub.join(ROOM, "B", "test");
const { participant: c } = hub.join(ROOM, "C", "test");
const { participant: d } = hub.join(ROOM, "D", "test");
const pr = hub.propose(ROOM, a.id, "Ship the cache in v2 without a benchmark. Document the flag in the README.");

const first = hub.challenge(ROOM, b.id, pr.id, 'Shipping "the cache in v2 without a benchmark" risks a regression nobody measured.').challenges[0];
const messages = room.messages.length;

// Same clause, different words: refused, pointing at the open challenge; nothing is filed or posted.
let dup: HubError | undefined;
try {
  hub.challenge(ROOM, c.id, pr.id, 'I also object: "the cache in v2 without a benchmark" is unmeasured.');
} catch (e) {
  dup = e as HubError;
}
assert.ok(dup instanceof HubError, "a same-clause challenge is refused without confirm");
assert.match(dup.message, new RegExp(first.id!), "the refusal names the open challenge's id");
assert.equal((dup.data as { duplicate_of?: string })?.duplicate_of, first.id);
assert.equal(pr.challenges.length, 1, "nothing was filed");
assert.equal(room.messages.length, messages, "nothing was posted");

// A quote that contains or sits inside the open one is the same clause.
assert.throws(() => hub.challenge(ROOM, d.id, pr.id, 'Too risky: "Ship the cache in v2 without a benchmark" should wait.'), /already/);

// confirm=true files it anyway.
hub.challenge(ROOM, c.id, pr.id, 'I also object: "the cache in v2 without a benchmark" is unmeasured.', true, undefined, true);
assert.equal(pr.challenges.length, 2, "confirm=true files the duplicate");

// A different clause is not a duplicate.
hub.challenge(ROOM, d.id, pr.id, '"Document the flag in the README" is not enough; it needs a changelog line.');
assert.equal(pr.challenges.length, 3);

// An executable counterexample is anchored to its command, not to the quote: not a duplicate.
hub.challenge(ROOM, d.id, pr.id, '"the cache in v2 without a benchmark" fails this probe.', true, "npm run bench -- --cache");
assert.equal(pr.challenges.length, 4);

// A non-blocking objection on a clause does not stop a blocking challenge on it (only the blocking one holds the gate).
const pr2Room = "duplicate-challenge-2";
const { participant: a2 } = hub.join(pr2Room, "A", "test", { requireChallenge: true, nudgeAfterMs: 0 });
const { participant: b2 } = hub.join(pr2Room, "B", "test");
const { participant: c2 } = hub.join(pr2Room, "C", "test");
const pr2 = hub.propose(pr2Room, a2.id, "Adopt the new retry policy for every outbound call.");
hub.challenge(pr2Room, b2.id, pr2.id, 'Minor: "the new retry policy for every outbound call" could be scoped.', false);
hub.challenge(pr2Room, c2.id, pr2.id, 'Blocking: "the new retry policy for every outbound call" has no backoff cap.');
assert.equal(pr2.challenges.length, 2, "a blocking challenge is not a duplicate of a non-blocking one");
hub.challenge(pr2Room, b2.id, pr2.id, 'Also minor: "the new retry policy for every outbound call" wants a flag.', false);
assert.equal(pr2.challenges.length, 3, "non-blocking dissent is recorded as written, never deduplicated");

// Once the open challenge is no longer open, the clause is free again.
const pr3Room = "duplicate-challenge-3";
const { participant: a3 } = hub.join(pr3Room, "A", "test", { requireChallenge: true, nudgeAfterMs: 0 });
const { participant: b3 } = hub.join(pr3Room, "B", "test");
const { participant: c3 } = hub.join(pr3Room, "C", "test");
const pr3 = hub.propose(pr3Room, a3.id, "Freeze the schema until the migration lands.");
const x = hub.challenge(pr3Room, b3.id, pr3.id, '"Freeze the schema until the migration lands" blocks hotfixes.').challenges[0];
x.status = "answered";
hub.challenge(pr3Room, c3.id, pr3.id, '"Freeze the schema until the migration lands" still blocks hotfixes.');
assert.equal(pr3.challenges.length, 2, "an answered challenge does not dedupe a new one");
console.log("DUPLICATE CHALLENGE OK");
