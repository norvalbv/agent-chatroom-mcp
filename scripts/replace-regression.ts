/**
 * Replace regressions (item 2 of swarm-140818-f1qy). Run: npx tsx scripts/replace-regression.ts
 *
 * Covers: replace reuses the kick path (Hub.removeParticipant) rather than duplicating it, the
 * successor's brief carries the predecessor's claim/*, handoff/* and inbox/* context, self-replace and
 * missing/failing removal are refused before any recruit is launched, the single-recruit/same-room
 * constraints already enforced by request() still apply, an agent may not unilaterally remove a live
 * colleague (review B2), an already-departed or already-kicked target skips removal and goes straight to
 * recruiting instead of throwing (review B3), and a recruit failure after removal says so plainly rather
 * than leaving a silent hole (review B4).
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub } from "../src/hub.js";
import { Spawner, type SpawnerHooks } from "../src/spawner.js";

function fixture(fn: (s: Spawner, hub: Hub, dir: string) => void, hookOverrides: Partial<SpawnerHooks> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "replace-regression-"));
  try {
    const hub = new Hub({});
    const room = "replace-room";
    hub.join(room, "predecessor", "test", { requireChallenge: false, expectedParticipants: 2 }, undefined, "s1");
    hub.join(room, "colleague", "test", {}, undefined, "s2");
    const s = new Spawner({ logDir: dir, dryRun: true, mcpUrl: "http://127.0.0.1:18490/mcp", defaultCwd: dir });
    s.attach({
      isHeld: () => false,
      claimArea: () => {},
      ensureRoom: () => {},
      announce: () => {},
      liveAgents: () => 0,
      registerReplacement: (r, predecessor, name) => hub.registerReplacement(r, predecessor, name).replacementToken,
      removeParticipant: (r, target, by, reason) => { hub.removeParticipant(r, target, by, reason); },
      targetStatus: (r, target) => {
        const p = [...hub.getRoom(r).participants.values()].find((x) => x.name === target);
        if (!p) return undefined;
        // `connected` mirrors what index.ts reads from its transports map: is the target's MCP session still open?
        return { active: p.active, kicked: !!p.kicked, staleMs: Date.now() - Date.parse(hub.lastSeen(p)), connected: sessionConnected };
      },
      predecessorContext: (r, name) => {
        const board = hub.getRoom(r).board;
        const isTheirs = (e: { by: string; text: string }) => {
          if (e.by === name) return true;
          try { return (JSON.parse(e.text) as { released_from?: string }).released_from === name; } catch { return false; }
        };
        const own = [...board.entries()].filter(([k, e]) => (k.startsWith("claim/") || k.startsWith("handoff/")) && isTheirs(e));
        return own.map(([k, e]) => `${k}: ${e.text}`).join("\n\n");
      },
      ...hookOverrides,
    });
    fn(s, hub, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const ROOM = "replace-room";
/** what the fixture's targetStatus reports for the target's MCP session (index.ts reads its transports map for this) */
let sessionConnected = false;
const req = { room: ROOM, requestedBy: "colleague", replacing: "predecessor", reason: "no heartbeat for 15 min per room_status", requesterIsHuman: true };

test("replace kicks via the real removal primitive: predecessor marked left, kicked record set, claim released", () => {
  fixture((s, hub) => {
    hub.setBoardAs(ROOM, "predecessor", "claim/thing", JSON.stringify({ owner: "predecessor", status: "building", scope: "the widget" }));
    const [rec] = s.replace(req);
    assert.ok(rec.name, "a successor name was assigned");
    const p = [...hub.getRoom(ROOM).participants.values()].find((x) => x.name === "predecessor")!;
    assert.equal(p.active, false);
    assert.ok(p.kicked, "kicked record set (the same field the kick vote sets)");
    assert.equal(p.kicked!.by, "colleague");
    const claim = hub.getRoom(ROOM).board.get("claim/thing")!;
    assert.equal(JSON.parse(claim.text).status, "released", "claim/* released exactly like a kick vote's removal");
    assert.throws(() => hub.requireParticipant(hub.getRoom(ROOM), p.id), /KICKED/, "predecessor's next call is refused");
  });
});

test("the successor's brief carries what the predecessor was doing", () => {
  fixture((s, hub) => {
    hub.setBoardAs(ROOM, "predecessor", "claim/widget", JSON.stringify({ owner: "predecessor", status: "building", scope: "wire the button" }));
    hub.setBoardAs(ROOM, "predecessor", "handoff/widget-notes", "half the CSS is done, the click handler is not");
    const [rec] = s.replace({ ...req, name: "successor" });
    const prompt = readFileSync(rec.log, "utf8");
    assert.match(prompt, /You replace predecessor, who dropped out of this room/);
    assert.match(prompt, /What predecessor was doing:/);
    assert.match(prompt, /claim\/widget: .*wire the button/);
    assert.match(prompt, /handoff\/widget-notes: half the CSS is done/);
    assert.doesNotMatch(prompt, /\{\{REPLACING\}\}/);
  });
});

test("no brief given: a sensible default names the predecessor and the reason", () => {
  fixture((s) => {
    const [rec] = s.replace(req);
    const prompt = readFileSync(rec.log, "utf8");
    assert.match(prompt, /Take over for predecessor, who was removed from this room \(no heartbeat for 15 min per room_status\)/);
  });
});

test("cannot replace yourself, and a missing reason, removal or status hook fails closed before any recruit is launched", () => {
  fixture((s) => {
    assert.throws(() => s.replace({ ...req, requestedBy: "predecessor" }), /cannot replace yourself/);
    assert.throws(() => s.replace({ ...req, reason: "  " }), /reason is required/);
    assert.equal(s.agents.length, 0, "nothing launched on any refusal");
  });
  // no removeParticipant/targetStatus hooks attached at all
  const dir = mkdtempSync(join(tmpdir(), "replace-regression-"));
  try {
    const s = new Spawner({ logDir: dir, dryRun: true, mcpUrl: "http://127.0.0.1:18490/mcp", defaultCwd: dir });
    s.attach({ isHeld: () => false, claimArea: () => {}, ensureRoom: () => {}, announce: () => {}, liveAgents: () => 0, registerReplacement: () => "x" });
    assert.throws(() => s.replace(req), /unavailable/);
    assert.equal(s.agents.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no such participant is refused before any recruit is launched", () => {
  fixture((s) => {
    assert.throws(() => s.replace({ ...req, replacing: "nobody" }), /No participant named "nobody"/);
    assert.equal(s.agents.length, 0);
  });
});

test("B2: an agent may not unilaterally remove a live, recently-seen colleague -- kick_vote is required", () => {
  fixture((s, hub) => {
    assert.throws(() => s.replace({ ...req, requesterIsHuman: false }), /use kick_vote/i);
    const p = [...hub.getRoom(ROOM).participants.values()].find((x) => x.name === "predecessor")!;
    assert.equal(p.active, true, "refused before removal: the colleague is untouched");
    assert.equal(s.agents.length, 0);
  });
});

test("B2: an agent MAY remove a live colleague once it has been quiet longer than the stale threshold", () => {
  fixture((s, hub) => {
    const p = [...hub.getRoom(ROOM).participants.values()].find((x) => x.name === "predecessor")!;
    p.lastActiveAt = new Date(Date.now() - 11 * 60_000).toISOString(); // 11 min of silence
    const [rec] = s.replace({ ...req, requesterIsHuman: false });
    assert.ok(rec.name);
    assert.equal(p.active, false);
  });
});

test("B2: a stale target whose MCP session is still connected is alive, not dead -- an agent is refused even after the stale threshold", () => {
  sessionConnected = true;
  try {
    fixture((s, hub) => {
      const p = [...hub.getRoom(ROOM).participants.values()].find((x) => x.name === "predecessor")!;
      p.lastActiveAt = new Date(Date.now() - 11 * 60_000).toISOString(); // 11 min inside one long command
      assert.throws(() => s.replace({ ...req, requesterIsHuman: false }), /still connected/);
      assert.equal(p.active, true, "refused before removal: the busy colleague is untouched");
      assert.equal(s.agents.length, 0);
      // a dashboard human is trusted even while the target's session is connected
      const [rec] = s.replace({ ...req, requesterIsHuman: true });
      assert.ok(rec.name);
      assert.equal(p.active, false);
    });
  } finally {
    sessionConnected = false;
  }
});

test("B2: a stale target whose MCP session is gone may be replaced by an agent", () => {
  fixture((s, hub) => {
    const p = [...hub.getRoom(ROOM).participants.values()].find((x) => x.name === "predecessor")!;
    p.lastActiveAt = new Date(Date.now() - 11 * 60_000).toISOString();
    const [rec] = s.replace({ ...req, requesterIsHuman: false }); // sessionConnected is false: the process is gone
    assert.ok(rec.name);
    assert.equal(p.active, false);
  });
});

test("B2: a human (the token-gated dashboard route) may replace a live colleague unconditionally", () => {
  fixture((s, hub) => {
    const [rec] = s.replace({ ...req, requesterIsHuman: true });
    assert.ok(rec.name);
    const p = [...hub.getRoom(ROOM).participants.values()].find((x) => x.name === "predecessor")!;
    assert.equal(p.active, false);
  });
});

test("B3: an already-departed (idle-swept, not kicked) target skips removal and is recruited anyway", () => {
  fixture((s, hub) => {
    const p = [...hub.getRoom(ROOM).participants.values()].find((x) => x.name === "predecessor")!;
    p.active = false; // simulates sweepIdle's plain departure: no kicked record
    const [rec] = s.replace({ ...req, requesterIsHuman: false }); // an agent may do this: nothing live is being touched
    assert.ok(rec.name, "recruited without error even though there was nothing to remove");
    assert.equal(p.kicked, undefined, "a plain departure is not retroactively marked kicked");
  });
});

test("B3: an already-kicked target (e.g. by a prior kick vote) also skips removal and is recruited anyway", () => {
  fixture((s, hub) => {
    const target = [...hub.getRoom(ROOM).participants.values()].find((x) => x.name === "predecessor")!;
    hub.removeParticipant(ROOM, target.id, "someone-else", "already kicked by a vote");
    const [rec] = s.replace(req);
    assert.ok(rec.name, "recruited without the double-remove error a naive implementation would throw");
  });
});

test("B4: a recruit failure after removal says so plainly instead of leaving a silent hole", () => {
  fixture((s) => {
    assert.throws(() => s.replace(req), /predecessor was removed, but recruiting a successor failed/);
  }, { liveAgents: () => 999999 }); // forces request()'s live-agent cap to refuse
});

test("existing single-recruit/same-room constraints on replacing still apply", () => {
  fixture((s) => {
    for (const extra of [{ count: 2 }, { newRoom: "other" }]) assert.throws(() => s.replace({ ...req, ...extra } as typeof req), /one recruit/);
    assert.equal(s.agents.length, 0);
  });
});

console.log("REPLACE OK");
