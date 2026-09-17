/** Narrow regression for fleet-174537 delivery item 1. Run: npx tsx scripts/quiet-receipts.ts */
import assert from "node:assert/strict";
import { Hub } from "../src/hub.js";

const hub = new Hub();
const name = "quiet-receipts";
const { room, participant: writer } = hub.join(name, "writer", "test");
const { participant: peer } = hub.join(name, "peer", "test");
const { participant: reader } = hub.join(name, "reader", "test");
const { participant: observer } = hub.join(name, "observer", "test");
const next = (p: typeof reader) => hub.wait(name, p.id, p.lastSeenSeq, 0);
for (const p of [writer, peer, reader, observer]) await next(p);

const root = hub.send(name, writer.id, "@peer first quiet body", undefined, true, true);
const reply = hub.send(name, peer.id, "second quiet body", root.id, true, true);
const pulled = hub.readAs(room, reader, root.seq - 1, 1);
assert.deepEqual(pulled.map((m) => m.seq), [root.seq], "limited explicit read delivers only root");
assert.equal(root.quiet, true, "quiet is delivery, not privacy");
assert.deepEqual(hub.readAs(room, reader, root.seq - 1, 1).map((m) => m.seq), [root.seq], "explicit quiet history rereads remain possible");
assert.deepEqual(await next(reader), [], "unread quiet reply remains unpushed");
assert.deepEqual(await next(observer), [], "quiet bodies do not push to bystanders");
assert.equal(hub.surfaceThread(room, root.id, "regression"), 2);
const deliveredReader = await next(reader);
const deliveredObserver = await next(observer);
console.log(JSON.stringify({ pulled: pulled.map((m) => m.seq), reader: deliveredReader.map((m) => m.seq), observer: deliveredObserver.map((m) => m.seq) }));
assert.ok(!deliveredReader.some((m) => m.id === root.id), "already-read quiet body must not be redelivered on surface");
assert.ok(deliveredReader.some((m) => m.id === reply.id), "unread reply in a partly read thread must be delivered");
for (const body of [root, reply]) assert.ok(deliveredObserver.some((m) => m.id === body.id), "never-read observer must receive every surfaced body");
for (const delivery of [deliveredReader, deliveredObserver]) assert.equal(delivery.filter((m) => m.content.includes("is now public")).length, 1, "publicization notice must remain visible");
assert.deepEqual(await next(reader), [], "surfaced bodies delivered only once by default");
assert.equal(hub.surfaceThread(room, root.id, "again"), 0, "surface is idempotent");
assert.deepEqual(hub.readAs(room, reader, root.seq - 1, 2).map((m) => m.seq), [root.seq, reply.seq], "explicit surfaced history reads still repeat bodies");
console.log("QUIET RECEIPTS OK");
