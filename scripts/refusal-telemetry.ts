/** Regression: completed guarded calls form a matched refusal-rate denominator.
 * Run: npx tsx scripts/refusal-telemetry.ts (in-process MCP, no network port).
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub, HubError } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";

Hub.DEFAULT_NUDGE_MS = 0;
const dataDir = mkdtempSync(join(tmpdir(), "refusal-telemetry-"));
const hub = new Hub({ dataDir });
const session = createSessionServer(hub);
const client = new Client({ name: "telemetry-test", version: "1" });
const [ct, st] = InMemoryTransport.createLinkedPair();
await session.server.connect(st);
await client.connect(ct);
const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
const events = (room = "rates") => readFileSync(join(dataDir, `${room}.jsonl`), "utf8").trim().split("\n").map((s) => JSON.parse(s));
try {
  const joined = await call("join_room", { room: "rates", name: "builder", agent: "codex" });
  const participant = JSON.parse((joined.content as { text: string }[])[0].text).participant_id;
  const secret = "DO_NOT_RETAIN_TOOL_BODY";
  assert.equal((await call("submit_opening", { room: "rates", content: secret.repeat(30) })).isError, true);
  assert.notEqual((await call("submit_opening", { room: "rates", content: "A short opening." })).isError, true);
  const completed = events().filter((e) => e.type === "call_completion" && e.tool === "submit_opening");
  assert.equal(completed.length, 2, "persist one completion for each refused AND successful guarded call");
  assert.deepEqual(completed.map((e) => e.outcome), ["hub_refusal", "success"]);
  const refusal = events().find((e) => e.type === "refusal");
  assert.equal(refusal.participant, participant);
  assert.ok(Number.isFinite(Date.parse(refusal.ts)), "refusal carries timestamp");
  for (const event of [...completed, refusal]) {
    assert.ok(Number.isFinite(Date.parse(event.ts)));
    assert.equal(event.participant, participant);
    assert.ok(!JSON.stringify(event).includes(secret));
    assert.ok(!JSON.stringify(event).includes(session.sessionKey));
  }
  const stats = () => hub.stats(hub.getRoom("rates")) as any;
  assert.deepEqual(stats().call_outcomes.submit_opening, { success: 1, hub_refusal: 1, error: 0 });
  assert.equal(stats().refusal_rates.submit_opening, 0.5);
  assert.equal(Object.values(stats().refusals).reduce((a: number, b: any) => a + b, 0), 1);
  assert.ok(!JSON.stringify(stats()).includes(participant), "public stats must not expose participant ids");

  // Unauthenticated submitted ids must not be attributed to another seat.
  assert.equal((await call("pass", { room: "rates", participant_id: "p_forged" })).isError, true);
  assert.equal(events().filter((e) => e.type === "refusal").at(-1).participant, null);
  assert.equal(events().filter((e) => e.type === "call_completion").at(-1).participant, null);

  // A non-HubError is counted as error, never as a guard refusal.
  const getRoom = hub.getRoom.bind(hub);
  hub.getRoom = () => { throw new Error(secret); };
  assert.equal((await call("room_status", { room: "rates" })).isError, true);
  hub.getRoom = getRoom;
  assert.deepEqual(stats().call_outcomes.room_status, { success: 0, hub_refusal: 0, error: 1 });
  assert.equal(stats().refusal_rates.room_status, 0);
  assert.ok(!JSON.stringify(events().filter((e) => e.type === "call_completion" || e.type === "refusal")).includes(secret));

  // HubError text can interpolate user input: even its prefix must not leak.
  hub.getRoom = () => { throw new HubError(secret); };
  assert.equal((await call("room_status", { room: "rates" })).isError, true);
  hub.getRoom = getRoom;
  assert.ok(!JSON.stringify(events().filter((e) => e.type === "call_completion" || e.type === "refusal")).includes(secret));
  assert.deepEqual(stats().call_outcomes.room_status, { success: 0, hub_refusal: 1, error: 1 });
  assert.equal(stats().refusal_rates.room_status, 0.5, "errors belong in the completed-call denominator");

  // One connection may own multiple seats; successful join has an unambiguous
  // issued actor, while a later call without an override has no attributable seat.
  const second = await call("join_room", { room: "rates", name: "second", agent: "codex" });
  const secondId = JSON.parse((second.content as { text: string }[])[0].text).participant_id;
  assert.equal(events().filter((e) => e.type === "call_completion").at(-1).participant, secondId);
  assert.equal((await call("pass", { room: "rates" })).isError, true);
  assert.equal(events().filter((e) => e.type === "call_completion").at(-1).participant, null);
  assert.notEqual((await call("leave_room", { room: "rates", participant_id: secondId, reason: "telemetry check complete, nothing owed" })).isError, true);
  assert.equal(events().filter((e) => e.type === "call_completion").at(-1).participant, secondId);

  const replay = new Hub({ dataDir });
  assert.deepEqual(replay.stats(replay.getRoom("rates")).call_outcomes, stats().call_outcomes);
  assert.deepEqual(replay.stats(replay.getRoom("rates")).refusal_rates, stats().refusal_rates);
  assert.deepEqual(replay.stats(replay.getRoom("rates")).refusals, stats().refusals);

  // Old room logs have no denominator coverage. Appending new outcomes cannot
  // turn their lifetime refusal count into a misleading mixed-epoch fraction.
  const legacy = events().filter((e) => e.type === "room" || e.type === "refusal").map((e) => {
    e.room = "legacy";
    delete e.telemetryVersion;
    delete e.ts;
    delete e.participant;
    return e;
  });
  writeFileSync(join(dataDir, "legacy.jsonl"), legacy.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const legacyHub = new Hub({ dataDir });
  const legacyStats = () => legacyHub.stats(legacyHub.getRoom("legacy")) as any;
  assert.equal(legacyStats().refusal_rates.submit_opening, "unknown");
  legacyHub.recordCallCompletion("legacy", "submit_opening", "success", null);
  assert.equal(legacyStats().refusal_rates.submit_opening, "unknown");
  const legacyReplay = new Hub({ dataDir });
  assert.equal(legacyReplay.stats(legacyReplay.getRoom("legacy")).refusal_rates.submit_opening, "unknown");
  console.log("REFUSAL TELEMETRY OK");
} finally {
  await client.close();
  await session.server.close();
  rmSync(dataDir, { recursive: true, force: true });
}
