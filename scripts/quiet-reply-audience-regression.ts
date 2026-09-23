/** Pool item 5 (swarm-105804): a quiet reply_to implies the parent's author as audience. Run: npx tsx scripts/quiet-reply-audience-regression.ts */
import assert from "node:assert/strict";
import { Hub } from "../src/hub.js";

const hub = new Hub();
const name = "quiet-reply-audience";
const { participant: asker } = hub.join(name, "asker", "test");
const { participant: replier } = hub.join(name, "replier", "test");
const { participant: bystander } = hub.join(name, "bystander", "test");
const { participant: human } = hub.join(name, "boss", "human");
const next = (p: typeof asker) => hub.wait(name, p.id, p.lastSeenSeq, 0);
for (const p of [asker, replier, bystander]) await next(p);

// A public parent: the quiet reply names nobody, yet the parent's author is its audience.
const parent = hub.send(name, asker.id, "does anyone know where the cap lives?", undefined, true);
await next(replier);
await next(bystander);
const reply = hub.send(name, replier.id, "src/hub.ts, in readAs", parent.id, true, true);
assert.equal(reply.quiet, true, "the reply stays quiet");
assert.deepEqual(new Set(reply.audience), new Set([replier.id, asker.id]), "audience is the sender plus the parent's author");
assert.ok((await next(asker)).some((m) => m.id === reply.id), "the parent's author receives the quiet reply by push");
assert.ok(!(await next(bystander)).some((m) => m.id === reply.id), "bystanders do not");

// reply_to by printed seq works the same way.
const parent2 = hub.send(name, asker.id, "and the limit?", undefined, true);
await next(replier);
const reply2 = hub.send(name, replier.id, "200", `#${parent2.seq}`, true, true);
assert.ok(reply2.audience?.includes(asker.id), "reply_to as '#seq' also implies the parent's author");

// Replying quietly to your own message still needs someone to talk to.
const own = hub.send(name, replier.id, "note to self", undefined, true);
assert.throws(() => hub.send(name, replier.id, "quiet follow-up", own.id, true, true), /must @-name at least one agent/);
// A human author is never a quiet audience (quiet is for agents); without an @-name it is refused.
const humanMsg = hub.send(name, human.id, "status?", undefined, true);
assert.throws(() => hub.send(name, replier.id, "quiet about the boss", humanMsg.id, true, true), /must @-name at least one agent/);
// A system message has no author to imply.
const sys = hub.getRoom(name).messages.find((m) => m.kind === "system")!;
assert.throws(() => hub.send(name, replier.id, "quiet about a notice", sys.id, true, true), /must @-name at least one agent/);
// No reply_to: the rule is unchanged.
assert.throws(() => hub.send(name, replier.id, "psst", undefined, true, true), /must @-name at least one agent/);
console.log("QUIET REPLY AUDIENCE OK");
