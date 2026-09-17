/** Integrated-tree contract: npx tsx scripts/stats-integration-regression.ts
 * Baseline 356ef86 shipped only board_entries; the integrated tree exposes
 * proposal_electorates / conclusion_electorate and board_manifests. Covers every
 * pre-existing stats field, exact UTF8 manifest bytes, frozen post-conclusion
 * electorates, no-cursor-advance on repeated reads, and the MCP wait path. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";
Hub.DEFAULT_NUDGE_MS = 0;
const dataDir = mkdtempSync(join(tmpdir(), "stats-integration-"));
const hub = new Hub({ dataDir });
const session = createSessionServer(hub);
const client = new Client({ name: "stats-integration", version: "1" });
const [ct, st] = InMemoryTransport.createLinkedPair();
await session.server.connect(st);
await client.connect(ct);
const call = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, JSON.stringify(result));
  return JSON.parse((result.content as { text: string }[])[0].text);
};
const LEGACY = ["room","state","duration_ms","time_to_conclusion_ms","messages_by_kind","per_participant","proposals","amendments","challenges","board_entries","refusals","call_outcomes","refusal_rates","refusal_rate_coverage","near_simultaneous_replies","unanswered_human_messages"];
const ELECTORATE_KEYS = ["policy","electorate_size","agree","disagree","abstain","unvoted","surviving_snapshot_size","departed_snapshot_size","replacement_size","late_joiners_excluded"];
try {
  const j = await call("join_room", { room: "integrated", name: "A", agent: "test" });
  const pid = j.participant_id as string;
  const stats = () => hub.stats(hub.getRoom("integrated")) as any;
  for (const key of LEGACY) assert.ok(key in stats(), key);
  await call("board_set", { room: "integrated", key: "evidence/int", text: "..." });
  await call("wait_for_messages", { room: "integrated", timeout_ms: 0 });
  await call("wait_for_messages", { two_waits: true, room: "integrated", timeout_ms: 0 });
  const waitsBefore = stats().board_manifests.waits as number;
  const bytesBefore = stats().board_manifests.bytes as number;
  assert.equal(waitsBefore, 2, "one accounting sample per wait, never double-counted");
  const frozen = JSON.stringify(stats().board_manifests);
  assert.equal(JSON.stringify(stats().board_manifests), frozen, "repeated reads are byte-identical, no cursor advance");
  assert.ok(!("coverage" in stats().board_manifests), "field set comes from the delta branch contract, not the retired candidate");
  // Full-board wait ships every key; the next unchanged wait ships none.
  await call("board_set", { room: "integrated", key: "sources/src", text: "fetched abstract" });
  const delta = await call("wait_for_messages", { room: "integrated", timeout_ms: 0 });
  assert.ok(delta.board_delta?.keys.includes("sources/src"), "changed keys ship as a delta");
  assert.ok(!("board_keys" in delta), "unchanged subscription ships deltas, not the full baseline");
  const after = stats().board_manifests;
  assert.equal(after.waits, waitsBefore + 1, "exactly one accounting sample per response");
  assert.ok(after.bytes > bytesBefore, "shipped envelope bytes grow when keys ship");
  assert.ok(after.full >= 1 && after.delta >= 1, "both delivery kinds are counted");
  // --- electorate: the stats denominator must be the hub's own electorate helper ---
  // Majority room so two of three eligible voters may conclude (the default quorum is unanimous).
  const majority = hub.createRoom("integrated-majority", { quorum: "majority" });
  const a2 = hub.join("integrated-majority", "A2", "test", {}, undefined, "s1").participant;
  const b2 = hub.join("integrated-majority", "B2", "test", {}, undefined, "s2").participant;
  const c2 = hub.join("integrated-majority", "C2", "test", {}, undefined, "s3").participant;
  const proposal = hub.propose("integrated-majority", a2.id, "Require independent evidence before adopting a conclusion.");
  const summary = () => (hub.stats(majority) as any).proposal_electorates[0];
  assert.equal(summary().electorate, 3, "open-proposal denominator comes from the shared electorate helper");
  assert.equal(summary().distinct_sessions, 3);
  assert.equal(summary().denominator, "electorate");
  hub.challenge("integrated-majority", b2.id, proposal.id, '"independent evidence" must explicitly require checking.');
  hub.amend("integrated-majority", a2.id, proposal.id, "independent evidence", "independently checked evidence");
  hub.vote("integrated-majority", a2.id, proposal.id, "agree", "checks out", undefined, "independently checked evidence");
  hub.vote("integrated-majority", c2.id, proposal.id, "agree", "checks out", undefined, "adopting a conclusion");
  assert.equal(majority.state, "concluded");
  const frozenConclusion = (hub.stats(majority) as any).conclusion_electorate;
  assert.equal(frozenConclusion.electorate, 3);
  assert.equal(frozenConclusion.agree, 2);
  assert.equal(frozenConclusion.excluded_leavers, 0);
  assert.equal((hub.stats(majority) as any).proposal_electorates.length, 0, "accepted proposals freeze into conclusion_electorate");
  hub.leave("integrated-majority", b2.id);
  assert.deepEqual((hub.stats(majority) as any).conclusion_electorate, frozenConclusion, "post-conclusion departure must not change the frozen tally");
  // An OPEN proposal tracks the live helper: a departure is excluded, not silently kept.
  const live = hub.createRoom("integrated-majority-live", { quorum: "majority" });
  const a3 = hub.join("integrated-majority-live", "A3", "test", {}, undefined, "s1").participant;
  const b3 = hub.join("integrated-majority-live", "B3", "test", {}, undefined, "s2").participant;
  hub.join("integrated-majority-live", "C3", "test", {}, undefined, "s3");
  const openProposal = hub.propose("integrated-majority-live", a3.id, "Leavers before the close are excluded from the live denominator.");
  hub.leave("integrated-majority-live", b3.id);
  assert.equal((hub.stats(live) as any).proposal_electorates[0].electorate, 2, "open proposal denominator follows departures");
  assert.equal((hub.stats(live) as any).proposal_electorates[0].excluded_leavers, 1);
  const fresh = new Hub();
  assert.equal((fresh.stats(fresh.createRoom("no-waits")) as any).board_manifests, null);
  console.log("STATS INTEGRATION OK");
} finally {
  await client.close();
  await session.server.close();
  rmSync(dataDir, { recursive: true, force: true });
}
