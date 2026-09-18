/**
 * Regression: seat-requested recruit break-outs inherit the requester room's run prefix.
 * Run: npx tsx scripts/recruit-prefix-regression.ts  (part of npm test via offline-runner.mjs)
 * Gap (evidence/recruit-room-prefix-gap, HEAD c0cf5a3): src/spawner.ts hooked ensureRoom with the
 * LITERAL new_room name, so a recruiter in swarm-123456-abcd-leads asking for new_room="brk-foo"
 * produced a room the launcher's artifact (src/swarm.ts:470-471, gathered by startsWith(runPrefix))
 * never sees, and the per-run recruit cap (src/spawner.ts:172) never counted it. The ensured/created
 * room must therefore share the requester's run prefix /^(swarm-[0-9]{6}(?:-[a-z0-9]{4})?)-/.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Spawner } from "../src/spawner.js";

const RUN_PREFIX = /^(swarm-[0-9]{6}(?:-[a-z0-9]{4})?)-/;
const ROOM_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

interface Calls {
  ensured: string[];
  claimed: { room: string; requester: string; area: string }[];
  replacements: string[];
}

function fixture(fn: (s: Spawner, calls: Calls) => void) {
  const dir = mkdtempSync(join(tmpdir(), "recruit-prefix-"));
  try {
    const calls: Calls = { ensured: [], claimed: [], replacements: [] };
    const s = new Spawner({ logDir: dir, dryRun: true, mcpUrl: "http://127.0.0.1:18490/mcp", defaultCwd: dir });
    s.attach({
      isHeld: () => false,
      claimArea: (room, requester, area) => { calls.claimed.push({ room, requester, area }); },
      ensureRoom: (room) => { calls.ensured.push(room); },
      announce: () => {},
      liveAgents: () => 0,
      registerReplacement: () => { calls.replacements.push("replacement"); return "one-use-proof"; },
    });
    fn(s, calls);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const base = {
  room: "swarm-123456-abcd-leads",
  requestedBy: "recruiter",
  brief: "Build the recruit-room-run-prefix fix: red test first, then spawner prefix inheritance, then build, smoke and suite green.",
};

test('break-out requested without the run prefix inherits the requester prefix', () => {
  fixture((s, calls) => {
    const recs = s.request({ ...base, newRoom: "brk-foo", roomTopic: "break-out topic" });
    assert.equal(calls.ensured.length, 1);
    const ensured = calls.ensured[0];
    assert.match(ensured, RUN_PREFIX, "ensured room must share the requester run prefix");
    assert.ok(ensured.startsWith("swarm-123456-abcd"), "ensured room must carry the requester run id");
    assert.equal(ensured, "swarm-123456-abcd-brk-foo");
    assert.equal(recs.length, 2, "a new_room recruit spawns a pair by default");
    for (const rec of recs) {
      assert.equal(rec.room, ensured, "recruits must be spawned INTO the prefixed room");
      assert.match(rec.room, RUN_PREFIX);
    }
  });
});

test("requester room without a run prefix keeps the literal break-out name", () => {
  fixture((s, calls) => {
    const recs = s.request({ ...base, room: "leads", newRoom: "brk-foo" });
    assert.deepEqual(calls.ensured, ["brk-foo"]);
    assert.equal(recs[0].room, "brk-foo");
  });
});

test("break-out that already carries a run prefix is not double-prefixed", () => {
  fixture((s, calls) => {
    s.request({ ...base, newRoom: "swarm-999999-abcd-brk" });
    assert.deepEqual(calls.ensured, ["swarm-999999-abcd-brk"]);
  });
});

test("break-out names stay sanitized to [a-zA-Z0-9_-]", () => {
  fixture((s, calls) => {
    const recs = s.request({ ...base, newRoom: "brk foo/bad" });
    const ensured = calls.ensured[0];
    assert.match(ensured, ROOM_NAME);
    assert.equal(ensured, "swarm-123456-abcd-brk-foo-bad");
    assert.equal(recs[0].room, ensured);
  });
});

test("claimArea lands on the prefixed break-out; replacement path untouched", () => {
  fixture((s, calls) => {
    const recs = s.request({ ...base, newRoom: "brk-foo", area: "sub-task" });
    assert.equal(calls.claimed.length, 1);
    assert.equal(calls.claimed[0].room, "swarm-123456-abcd-brk-foo", "claim must land on the prefixed break-out board");
    assert.equal(calls.claimed[0].area, "sub-task");
    assert.equal(calls.replacements.length, 0);
    // replacement stays a same-room, no-new_room path
    const rep = s.request({ ...base, replacing: "departed", name: "fresh", count: 1 });
    assert.equal(rep.length, 1);
    assert.equal(calls.replacements.length, 1);
    assert.equal(calls.ensured.length, 1, "replacement must not create any room");
  });
});

test("per-run recruit cap counts an unprefixed break-out against the requester run", () => {
  const dir = mkdtempSync(join(tmpdir(), "recruit-prefix-cap-"));
  try {
    const calls: Calls = { ensured: [], claimed: [], replacements: [] };
    const s = new Spawner({ logDir: dir, dryRun: true, mcpUrl: "http://127.0.0.1:18491/mcp", defaultCwd: dir, maxCumulativePerRun: 2 });
    s.attach({ isHeld: () => false, claimArea: () => {}, ensureRoom: (r) => { calls.ensured.push(r); }, announce: () => {}, liveAgents: () => 0 });
    // two recruits already exist in the same run: one in the leads room, one in a prefixed break-out
    const agents = (s as unknown as { agents: { name: string; room: string }[] }).agents;
    agents.push({ name: "p1", room: "swarm-123456-abcd-leads" }, { name: "p2", room: "swarm-123456-abcd-brk-foo" });
    assert.throws(() => s.request({ ...base, newRoom: "brk-bar" }), /run has used its 2 cumulative recruits/);
    assert.equal(calls.ensured.length, 0, "cap refusal must happen before any room is created");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
