/**
 * A seat's claim "the hub refused X" is checkable by the others (swarm-082539-kns2, claim/refusals-visible;
 * idea/refusals-visible by -7, evidence/refusals-cited). The hub persists every refusal (tool, closed-enum code,
 * actor, time; never the text, which can interpolate submitted content) but nothing showed it to a seat: about 70-85
 * agent messages across 259 logs report a hub refusal as evidence, and in -7's dev room the verifier filed a blocking
 * challenge because it could not check one. room_status refusals=true now carries the latest ones as
 * {name, tool, reason, ts}: a display name, never a participant id, and the code, never the message.
 * Run: npx tsx --test scripts/refusals-visible-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hub, HubError } from "../src/hub.js";

function fixture(t: { after: (fn: () => void) => void }, dataDir?: string) {
  const hub = new Hub(dataDir ? { dataDir } : {});
  const name = "refusals-visible";
  const a = hub.join(name, "Alice", "test", { expectedParticipants: 2 }, undefined, "s-a").participant;
  const b = hub.join(name, "Bob", "test", {}, undefined, "s-b").participant;
  const room = hub.getRoom(name);
  t.after(() => { clearTimeout(room.nudgeTimer); clearTimeout(room.openingsTimer); });
  return { hub, room, a, b };
}

test("the latest refusals are listed by name, tool, code and time, never id or text", (t) => {
  const { hub, room, a, b } = fixture(t);
  hub.recordRefusal(room.name, "propose", new HubError(`secret text "sk-123" in the refusal`, undefined, "state"), a.id);
  hub.recordRefusal(room.name, "board_set", "plain string error mentioning sk-456", b.id);
  const got = hub.recentRefusals(room);
  assert.deepEqual(got.map(({ ts: _, ...x }) => x), [
    { name: "Bob", tool: "board_set", reason: "hub_guard" },
    { name: "Alice", tool: "propose", reason: "state" },
  ], "newest first");
  const flat = JSON.stringify(got);
  assert.ok(!flat.includes(a.id) && !flat.includes(b.id), "participant ids are never shown");
  assert.ok(!/sk-\d/.test(flat), "the refusal text is never shown");
  assert.ok(got.every((x) => !Number.isNaN(Date.parse(x.ts))));
});

test("capped, and rebuilt from the log on restart", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "refusals-visible-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { hub, room, a } = fixture(t, dir);
  for (let i = 0; i < 30; i++) hub.recordRefusal(room.name, i % 2 ? "vote" : "send_message", "x", a.id);
  assert.equal(hub.recentRefusals(room, 100).length, Hub.RECENT_REFUSALS, "the room keeps only the latest");
  assert.equal(hub.recentRefusals(room).length, 5, "five by default");
  const again = new Hub({ dataDir: dir });
  const r2 = again.getRoom(room.name);
  t.after(() => { clearTimeout(r2.nudgeTimer); clearTimeout(r2.openingsTimer); });
  assert.deepEqual(again.recentRefusals(r2).map((x) => [x.name, x.tool]), hub.recentRefusals(room).map((x) => [x.name, x.tool]));
});
