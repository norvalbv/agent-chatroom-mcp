/** Regression for item 2 (swarm-125438-jp20): a benchmark hub must refuse recruitment outright, and
 * no provider key may reach it. Two independent checks, both gated by CHATROOM_NO_RECRUIT=1:
 *  1. Spawner.request() refuses every request_agent call, before any cap or policy check runs.
 *  2. src/env.ts's loadDotEnv() must not reintroduce a provider-shaped key (API_KEY/TOKEN/SECRET/...)
 *     that the caller explicitly excluded via excludePattern, so a hub started with those keys deleted
 *     from its env (as bench-rq1.ts does) cannot have them silently refilled from a gitignored .env.
 * No real subprocess, network or .env file is touched.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Spawner } from "../src/spawner.js";
import { loadDotEnv } from "../src/env.js";

function fixtureSpawner(fn: (s: Spawner) => void) {
  const dir = mkdtempSync(join(tmpdir(), "bench-hub-no-recruit-"));
  try {
    const s = new Spawner({ logDir: dir, dryRun: true, mcpUrl: "http://127.0.0.1:0/mcp", defaultCwd: dir });
    s.attach({ isHeld: () => false, claimArea: () => {}, ensureRoom: () => {}, announce: () => {}, liveAgents: () => 0 });
    fn(s);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const brief = "Verify the current dates.ts against the task brief and report back with findings.";

{
  const prior = process.env.CHATROOM_NO_RECRUIT;
  process.env.CHATROOM_NO_RECRUIT = "1";
  try {
    fixtureSpawner((s) => {
      assert.throws(
        () => s.request({ room: "bench-hub-rq1", requestedBy: "seat-1", brief, count: 1, name: "probe" }),
        /CHATROOM_NO_RECRUIT|recruitment is disabled/i,
        "Spawner.request must refuse outright when CHATROOM_NO_RECRUIT=1, before any cap check",
      );
      assert.equal(s.agents.length, 0, "no agent record must be created for a refused request");
    });
  } finally {
    if (prior === undefined) delete process.env.CHATROOM_NO_RECRUIT;
    else process.env.CHATROOM_NO_RECRUIT = prior;
  }
}

{
  // unset: recruitment must still work normally (this is a benchmark-only gate, not a global default)
  const prior = process.env.CHATROOM_NO_RECRUIT;
  delete process.env.CHATROOM_NO_RECRUIT;
  try {
    fixtureSpawner((s) => {
      const recs = s.request({ room: "swarm-010513-crup-normal", requestedBy: "seat-1", brief, count: 1, name: "probe" });
      assert.equal(recs.length, 1, "recruitment must work as normal when CHATROOM_NO_RECRUIT is unset");
    });
  } finally {
    if (prior === undefined) delete process.env.CHATROOM_NO_RECRUIT;
    else process.env.CHATROOM_NO_RECRUIT = prior;
  }
}

{
  const dir = mkdtempSync(join(tmpdir(), "bench-hub-dotenv-"));
  try {
    writeFileSync(join(dir, ".env"), 'OPENROUTER_API_KEY=leaked-secret\nCHATROOM_HUMAN_TOKEN=leaked-token\nOTHER_CONFIG="kept-value"\n');
    const env: NodeJS.ProcessEnv = {}; // simulates the hub's env after bench-rq1.ts strips API_KEY/TOKEN/SECRET-shaped vars
    const loaded = loadDotEnv(dir, { env, excludePattern: /API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i });
    assert.equal(env.OPENROUTER_API_KEY, undefined, "a benchmark hub's loadDotEnv must not reintroduce a provider key matching excludePattern");
    assert.equal(env.CHATROOM_HUMAN_TOKEN, undefined, "excludePattern also blocks other credential-shaped keys");
    assert.equal(env.OTHER_CONFIG, "kept-value", "non-credential .env values still load normally");
    assert.ok(!loaded.includes("OPENROUTER_API_KEY"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("[bench-hub-no-recruit-regression] OK");
