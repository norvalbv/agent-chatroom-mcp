import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";
import { Spawner, type SpawnerOptions } from "../src/spawner.js";

const ROOM = "swarm-123456-abcd-room";
async function fixture(run: (f: { call: (name: string, args?: Record<string, unknown>) => Promise<any>; spawner: Spawner; dir: string; effects: string[] }) => Promise<void>, withSpawner = true, options: Partial<SpawnerOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "recruit-status-"));
  const effects: string[] = [];
  const hub = new Hub();
  hub.createRoom(ROOM, {});
  const spawner = new Spawner({ logDir: dir, defaultCwd: dir, mcpUrl: "http://127.0.0.1:1/mcp", dryRun: true, maxLive: 7, maxPerRoom: 3, maxDepth: 2, maxPerRequester: 2, maxCumulativePerRoom: 4, maxCumulativePerRun: 5, ...options });
  spawner.policy = { agent: "codex", model: "gpt-6-astra" };
  spawner.attach({ isHeld: () => false, liveAgents: () => 6, claimArea: () => { effects.push("claim"); }, ensureRoom: () => { effects.push("room"); }, announce: () => { effects.push("announce"); } });
  const session = createSessionServer(hub, withSpawner ? spawner : undefined);
  const client = new Client({ name: "recruit-status", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await session.server.connect(st);
  await client.connect(ct);
  const call = async (name: string, args: Record<string, unknown> = { room: ROOM, recruitment_details: true }) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse((result.content as { text: string }[])[0].text);
  };
  try { await run({ call, spawner, dir, effects }); }
  finally { await client.close(); await session.server.close(); rmSync(dir, { recursive: true, force: true }); }
}

test("room_status exposes live policy before recruitment without mutating spawn state", async () => {
  await fixture(async ({ call, spawner, dir, effects }) => {
    await call("join_room", { room: ROOM, name: "worker", agent: "codex" });
    const before = await call("room_status");
    assert.deepEqual(before.recruitment?.policy, { agent: "codex", model: "gpt-6-astra" });
    assert.equal(before.recruitment.requester.depth, 0);
    assert.equal(before.recruitment.requester.live_recruits, 0);
    assert.deepEqual(before.recruitment.budgets.machine_live, { used: 6, limit: 7 });
    assert.deepEqual(before.recruitment.budgets.room_live_recruits, { used: 0, limit: 3 });
    assert.deepEqual(before.recruitment.budgets.room_total_recruits, { used: 0, limit: 4 });
    assert.deepEqual(before.recruitment.budgets.run_total_recruits, { used: 0, limit: 5 });
    const compact = (await call("room_status", { room: ROOM })).recruitment;
    assert.deepEqual(compact.policy, before.recruitment.policy);
    assert.equal(compact.budgets, undefined);
    spawner.policy = { agent: "claude", model: "claude-opus-5-5" };
    assert.deepEqual((await call("room_status")).recruitment.policy, spawner.policy);
    assert.deepEqual(spawner.agents, []);
    assert.deepEqual(readdirSync(dir), []);
    assert.deepEqual(effects, []);
  });
});

test("reported budget limits match request enforcement and count completed recruits", async () => {
  await fixture(async ({ call, spawner }) => {
    const req = { room: ROOM, requestedBy: "worker", brief: "Inspect the missing specialist evidence and report the result." };
    const status = (await call("room_status")).recruitment;
    assert.equal(status?.budgets.machine_live.limit, 7);
    assert.throws(() => spawner.request({ ...req, count: 2 }), /7 live agents machine-wide/);
    spawner.request(req);
    const after = (await call("room_status")).recruitment;
    assert.equal(after.budgets.room_live_recruits.used, 0, "dry-run recruit completed");
    assert.equal(after.budgets.room_total_recruits.used, 1);
    assert.equal(after.budgets.run_total_recruits.used, 1);
    assert.equal(after.requester, undefined, "unjoined reader has no requester identity");
  });
});

test("unpinned policy and unlimited requester budget have explicit null values", async () => {
  await fixture(async ({ call, spawner }) => {
    await call("join_room", { room: ROOM, name: "worker", agent: "codex" });
    spawner.policy = {};
    const status = (await call("room_status")).recruitment;
    assert.deepEqual(status.policy, { agent: null, model: null });
    assert.equal(status.requester.max_live_recruits, null);
    assert.equal(status.requester.max_depth, 2);
  }, true, { maxPerRequester: Infinity });
});

test("no-recruit hub remains readable", async () => {
  const previous = process.env.CHATROOM_NO_RECRUIT;
  process.env.CHATROOM_NO_RECRUIT = "1";
  try {
    await fixture(async ({ call }) => {
      const status = (await call("room_status")).recruitment;
      assert.equal(status?.enabled, false);
      assert.equal(status.requester, undefined);
    });
  } finally {
    if (previous === undefined) delete process.env.CHATROOM_NO_RECRUIT;
    else process.env.CHATROOM_NO_RECRUIT = previous;
  }
});

test("siblings consume run budget and stale snapshots grant no reservation", async () => {
  await fixture(async ({ call, spawner }) => {
    const req = { room: ROOM, requestedBy: "worker", brief: "Inspect the missing specialist evidence and report the result." };
    const snapshot = (await call("room_status")).recruitment;
    for (let i = 0; i < 4; i++) spawner.request(req);
    spawner.request({ ...req, newRoom: "sibling", count: 1 });
    const current = (await call("room_status")).recruitment;
    assert.equal(snapshot.budgets.run_total_recruits.used, 0);
    assert.equal(current.budgets.room_total_recruits.used, 4);
    assert.equal(current.budgets.run_total_recruits.used, 5);
    assert.throws(() => spawner.request({ ...req, newRoom: "next", count: 1 }), /run has used its 5 cumulative recruits/);
    assert.equal(spawner.agents.length, 5);
  });
});

test("multiple connection identities omit requester details instead of choosing one", async () => {
  await fixture(async ({ call }) => {
    await call("join_room", { room: ROOM, name: "first", agent: "codex" });
    await call("join_room", { room: ROOM, name: "second", agent: "codex" });
    const status = (await call("room_status")).recruitment;
    assert.equal(status.requester, undefined);
    assert.deepEqual(status.policy, { agent: "codex", model: "gpt-6-astra" });
    assert.doesNotMatch(JSON.stringify(status), /p_[a-f0-9]+/);
  });
});

test("a server with no spawner does not advertise recruitment", async () => {
  await fixture(async ({ call }) => { assert.equal((await call("room_status")).recruitment, undefined); }, false);
});
