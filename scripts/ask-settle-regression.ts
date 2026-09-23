/** Pass settles delivered asks one per call, without a wait in between; it still never settles an unseen ask.
 * In swarm-092653-202z an integrator answered five READYs in one combined message; every held wait then returned
 * at once with the next of them, and a pass without a fresh wait was a no-op, so each ask cost a wait plus a pass.
 * Run against source: npx tsx --test scripts/ask-settle-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hub } from "../src/hub.js";

const ROOM = "ask-settle";

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "ask-settle-"));
  const hub = new Hub({ dataDir: dir });
  const i = hub.join(ROOM, "I", "test", { nudgeAfterMs: 0 }, undefined, "s1").participant;
  const b = hub.join(ROOM, "B", "test", {}, undefined, "s2").participant;
  const room = hub.getRoom(ROOM);
  t.after(() => {
    clearTimeout(room.nudgeTimer);
    clearTimeout(room.openingsTimer);
    rmSync(dir, { recursive: true, force: true });
  });
  const open = () => hub.addressedBy(room, i).map((m) => m.content);
  return { hub, i, b, open };
}

test("after one wait delivers three asks, three passes settle all three", async (t) => {
  const { hub, i, b, open } = fixture(t);
  for (const sha of ["aaa", "bbb", "ccc"]) hub.send(ROOM, b.id, `@I READY ${sha}`, undefined, true);
  await hub.wait(ROOM, i.id, i.lastSeenSeq, 0);
  assert.equal(open().length, 3);
  hub.pass(ROOM, i.id);
  hub.pass(ROOM, i.id);
  hub.pass(ROOM, i.id);
  assert.deepEqual(open(), []);
});

test("a pass never settles an ask that has not been delivered", async (t) => {
  const { hub, i, b, open } = fixture(t);
  await hub.wait(ROOM, i.id, i.lastSeenSeq, 0);
  hub.send(ROOM, b.id, "@I READY ddd", undefined, true);
  hub.pass(ROOM, i.id);
  assert.deepEqual(open(), ["@I READY ddd"]);
});
