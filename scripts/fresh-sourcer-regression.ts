/**
 * Fresh sourcer (swarm-000525-jcz8, research-depth): research rooms conclude on what the prompt gave them (pure research
 * rooms first propose after a median 6.9 min; 6 of 13 concluded ones cite no source the topic did not already name;
 * scripts/research-depth-measure.py). The work ledger knows when no seat made a web call before a proposal. When the
 * hub's fresh challenger is on and that is so, its brief also asks it to find one source outside the repository on the
 * proposal's main claim, so the one seat that has not seen the discussion is also the one that leaves the machine.
 * Proposals with a web call behind them, or with seats that do not report local work, get the brief as before.
 * Run: npx tsx scripts/fresh-sourcer-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";
import { Spawner, type SpawnedAgent } from "../src/spawner.js";

const TEXT = "Adopt unanimous quorum by default: it is what the literature on multi-agent debate recommends.";
const spawner = new Spawner({ mcpUrl: "http://test/mcp", defaultCwd: process.cwd(), logDir: mkdtempSync(join(tmpdir(), "fresh-sourcer-")), dryRun: true, freshChallenger: true });
spawner.attach({ isHeld: () => false, claimArea: () => {}, ensureRoom: () => {}, announce: () => {}, liveAgents: () => 0, roomTopic: () => "t" });

// 1. The hub tells the listener whether any reporting seat made a web call before the proposal.
const hub = new Hub({});
const seen: { offline?: boolean }[] = [];
hub.onProposalOpened = (_room, p) => seen.push(p);
const keyed = (room: string, name: string, session: string, opts = {}) => {
  const { participant } = hub.join(room, name, "claude", { nudgeAfterMs: 0, ...opts }, undefined, session);
  participant.seatKeyHash = `hash-${session}`; // launched seat with a heartbeat key
  return participant;
};
const a = keyed("offline", "A", "s1");
keyed("offline", "B", "s2");
hub.heartbeat("offline", a.id, { tool: "Read", detail: "src/hub.ts" });
hub.propose("offline", a.id, TEXT);
assert.equal(seen[0].offline, true, "no reporting seat made a web call");

const c = keyed("online", "C", "s3");
keyed("online", "D", "s4");
hub.heartbeat("online", c.id, { tool: "WebFetch", detail: "https://arxiv.org/abs/2305.14325" });
hub.propose("online", c.id, TEXT);
assert.equal(seen[1].offline, false, "one web call is enough");

const { participant: e } = hub.join("unknown", "E", "claude", { nudgeAfterMs: 0 }, undefined, "s5");
hub.join("unknown", "F", "claude", {}, undefined, "s6");
hub.propose("unknown", e.id, TEXT);
assert.equal(seen[2].offline, undefined, "seats that do not report local work: unknown, so nothing is asserted");

// 2. The fresh challenger's brief asks for an outside source only when the room made no web call.
const brief = (room: string, offline: boolean | undefined): string =>
  (spawner.freshChallenger(room, { id: `prop_${room}`, text: TEXT, by: "A", offline }) as SpawnedAgent).brief;
const sourcing = brief("r-offline", true);
assert.match(sourcing, /no seat in this room made a web call/i);
assert.match(sourcing, /outside this repository/);
assert.match(sourcing, /WebSearch|WebFetch/);
assert.match(sourcing, /URL/);
assert.match(sourcing, /challenge/, "a source that contradicts the claim is filed as a challenge");
assert.ok(sourcing.length <= 4000, "fits the brief limit");
for (const [room, offline] of [["r-online", false], ["r-unknown", undefined]] as const) {
  assert.doesNotMatch(brief(room, offline), /outside this repository/, `no sourcing ask when offline=${offline}`);
}

console.log("fresh-sourcer-regression OK");
process.exit(0);
