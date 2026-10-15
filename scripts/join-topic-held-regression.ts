/**
 * join_room handed every seat the room's whole topic, and a launched flat seat already holds it: its brief opens with
 * it (prompts/minimal.md "{{TOPIC}}"). In swarm-092526-89rn that is ~8.3k chars (~2k tokens) more in every seat's
 * context, re-read on every model request (evidence/context-share-transcripts: join_room's result was 4.2-4.3% of a
 * cu2b seat's context). The launcher now tells the hub, in the seat's MCP URL (topic_held=<digest>), the digest of
 * the exact topic its brief carries; join_room then ships only the topic's opening for that room. A seat whose brief
 * does not hold the topic (a recruit, a human, a seat of another room) still gets it whole: the digest must match the
 * room it joins.
 * RED before the change: no topicDigest export, and join_room returns the whole topic to every caller. GREEN after.
 * Run: npx tsx scripts/join-topic-held-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";
import { topicDigest } from "../src/hub/status-view.js";
import { seatBeat } from "../src/env.js";

Hub.DEFAULT_NUDGE_MS = 0;
const dir = mkdtempSync(join(tmpdir(), "join-topic-held-"));
try {
  const h = new Hub({ dataDir: dir });
  const topic = "GOAL: " + "make rooms cheaper. ".repeat(400);
  const joinAs = async (name: string, opts: Parameters<typeof createSessionServer>[2]) => {
    const session = createSessionServer(h, undefined, opts);
    const client = new Client({ name, version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await session.server.connect(st); await client.connect(ct);
    const r = await client.callTool({ name: "join_room", arguments: { room: "held", name, agent: "claude", topic } });
    return JSON.parse((r.content as { text: string }[])[0].text) as { room: { topic: string } };
  };
  const creator = await joinAs("creator", {});
  assert.equal(creator.room.topic, topic, "a caller with no topic_held gets the whole topic");
  const held = await joinAs("seat", { topicHeld: topicDigest(topic) });
  assert.ok(held.room.topic.length < 400, `a seat whose brief holds this topic gets its opening only (got ${held.room.topic.length} chars)`);
  assert.ok(topic.startsWith(held.room.topic.split("…")[0]), "the opening is the topic's own start");
  const other = await joinAs("other", { topicHeld: topicDigest("some other room's topic") });
  assert.equal(other.room.topic, topic, "a digest of a different topic changes nothing");

  // the launcher puts the digest in the seat's MCP URL only when given one
  assert.equal(new URL(seatBeat("http://127.0.0.1:1/mcp", "k", undefined, undefined, topicDigest(topic)).mcpUrl).searchParams.get("topic_held"), topicDigest(topic));
  assert.equal(new URL(seatBeat("http://127.0.0.1:1/mcp", "k").mcpUrl).searchParams.get("topic_held"), null);
  console.log("join-topic-held regression: ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
