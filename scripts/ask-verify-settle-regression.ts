/** Writing the verify/* (or attack/*) entry an ask was for answers the ask. Before this only chat settled an ask (a reply
 * to it, or an @-back to its sender), so a reviewer who wrote the requested verify entry and announced it to the room
 * was still woken by every such ask until it passed it. Across swarm-000525-jcz8 and swarm-082539-kns2, 47 of the 94
 * asks whose commit the addressee then verified or attacked were still owed after the entry was written
 * (claude-opus-5-5-3's replay of both room logs). The match is by commit: the entry must cover a commit the ask names.
 * Run: npx tsx --test scripts/ask-verify-settle-regression.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Hub } from "../src/hub.js";

const ROOM = "ask-verify";
function fixture(t: { after: (fn: () => void) => void }) {
  const hub = new Hub();
  const a = hub.join(ROOM, "A", "test", { nudgeAfterMs: 0 }, undefined, "s1").participant;
  const r = hub.join(ROOM, "R", "test", {}, undefined, "s2").participant;
  const room = hub.getRoom(ROOM);
  t.after(() => { clearTimeout(room.nudgeTimer); clearTimeout(room.openingsTimer); });
  const owed = () => hub.addressedBy(room, r).map((m: { content: string }) => m.content);
  return { hub, a, r, owed };
}
const head = (commit: string) => JSON.stringify({ proposal: "pending", command: "npx tsx scripts/x.ts", cwd: ".", base_commit: "c7e925e7", base_exit_code: 1, commit, exit_code: 0, output_tail: "OK" });

test("a verify entry covering the asked-for commit settles the ask", (t) => {
  const { hub, a, r, owed } = fixture(t);
  hub.send(ROOM, a.id, "@R please verify 3542fb0f, the dashboard fix");
  hub.send(ROOM, a.id, "@R and also review 9cababc5 when you can");
  assert.equal(owed().length, 2);
  hub.setBoard(ROOM, r.id, "verify/dashboard", head("3542fb0f"));
  assert.deepEqual(owed(), ["@R and also review 9cababc5 when you can"], "only the ask whose commit the entry covers is settled");
});

test("a short or long form of the same commit matches", (t) => {
  const { hub, a, r, owed } = fixture(t);
  hub.send(ROOM, a.id, "@R verify d854591a please");
  hub.setBoard(ROOM, r.id, "verify/board", head("d854591abcdef01"));
  assert.deepEqual(owed(), []);
});

test("an attack entry naming the commit settles too; another seat's entry does not", (t) => {
  const { hub, a, r, owed } = fixture(t);
  const c = hub.join(ROOM, "C", "test", {}, undefined, "s3").participant;
  hub.send(ROOM, a.id, "@R attack idea/x at f5095d72 if it is wrong");
  hub.setBoard(ROOM, a.id, "idea/x", "the design at f5095d72 says \"the snapshot is removed when it leaves\"");
  hub.setBoard(ROOM, c.id, "verify/x", head("f5095d72"));
  assert.equal(owed().length, 1, "C's verify does not settle an ask addressed to R");
  hub.setBoard(ROOM, r.id, "attack/idea/x", 'R objects to "the snapshot is removed when it leaves" at f5095d72: not on a crash.');
  assert.deepEqual(owed(), []);
});

test("an ask with no commit, or a plain board entry, stays owed", (t) => {
  const { hub, a, r, owed } = fixture(t);
  hub.send(ROOM, a.id, "@R can you look at the ledger idea?");
  hub.send(ROOM, a.id, "@R verify 1b0871f5");
  hub.setBoard(ROOM, r.id, "notes/r", "looked at 1b0871f5");
  hub.setBoard(ROOM, r.id, "verify/other", head("aaaa1111"));
  assert.equal(owed().length, 2);
});
