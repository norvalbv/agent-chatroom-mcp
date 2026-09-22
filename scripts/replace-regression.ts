/**
 * Replace regressions (item 2 of swarm-140818-f1qy). Run: npx tsx scripts/replace-regression.ts
 *
 * Covers: replace reuses the kick path (Hub.removeParticipant) rather than duplicating it, the
 * successor's brief carries the predecessor's claim/*, handoff/* and inbox/* context, self-replace and
 * missing/failing removal are refused before any recruit is launched, and the single-recruit/same-room
 * constraints already enforced by request() still apply.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub } from "../src/hub.js";
import { Spawner } from "../src/spawner.js";

function fixture(fn: (s: Spawner, hub: Hub, dir: string) => void) {
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
      predecessorContext: (r, name) => {
        const board = hub.getRoom(r).board;
        const isTheirs = (e: { by: string; text: string }) => {
          if (e.by === name) return true;
          try { return (JSON.parse(e.text) as { released_from?: string }).released_from === name; } catch { return false; }
        };
        const own = [...board.entries()].filter(([k, e]) => (k.startsWith("claim/") || k.startsWith("handoff/")) && isTheirs(e));
        return own.map(([k, e]) => `${k}: ${e.text}`).join("\n\n");
      },
    });
    fn(s, hub, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const ROOM = "replace-room";
const req = { room: ROOM, requestedBy: "colleague", replacing: "predecessor", reason: "no heartbeat for 15 min per room_status" };

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

test("cannot replace yourself, and a missing reason or removal hook fails closed before any recruit is launched", () => {
  fixture((s) => {
    assert.throws(() => s.replace({ ...req, requestedBy: "predecessor" }), /cannot replace yourself/);
    assert.throws(() => s.replace({ ...req, reason: "  " }), /reason is required/);
    assert.equal(s.agents.length, 0, "nothing launched on any refusal");
  });
  // no removeParticipant hook attached at all
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

test("a failing removal (already departed, human, self) is not swallowed, and nothing is launched", () => {
  fixture((s, hub) => {
    const target = [...hub.getRoom(ROOM).participants.values()].find((x) => x.name === "predecessor")!;
    hub.removeParticipant(ROOM, target.id, "someone", "already gone");
    assert.throws(() => s.replace(req), /already removed/);
    assert.equal(s.agents.length, 0);
  });
});

test("existing single-recruit/same-room constraints on replacing still apply", () => {
  fixture((s) => {
    for (const extra of [{ count: 2 }, { newRoom: "other" }]) assert.throws(() => s.replace({ ...req, ...extra } as typeof req), /one recruit/);
    assert.equal(s.agents.length, 0);
  });
});

console.log("REPLACE OK");
