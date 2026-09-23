/**
 * Room-level herding (swarm-083203-kooz: 15 blind openings, two ideas; four seats on one selector). When a claim/*
 * is first created the hub compares its key+area+note with every other live claim and, on >= 40% shared term stems
 * (Jaccard, >= 4 shared), posts one advisory @-line naming the new claimant and the existing owner. Never a refusal.
 * Run: npx tsx scripts/claim-overlap-regression.ts
 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";

const cases: [string, () => Promise<void> | void][] = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

let serial = 0;
function room() {
  const h = new Hub();
  const name = `claim-overlap-${++serial}`;
  const [a, b, c] = ["alice", "bob", "carol"].map((n) => h.join(name, n, "test", {}, undefined, `sess-${n}`).participant);
  return { h, name, a, b, c };
}
const claim = (area: string, owner: string, note: string) => JSON.stringify({ area, owner, team: [owner], status: "open", note });
const notices = (h: Hub, name: string) => h.getRoom(name).messages.filter((m) => m.content.includes("overlaps"));

// Real pair from swarm-083203-kooz (claude-opus-5-5-11 vs claude-opus-5-5-14's opening text).
const REPLAY = "Offline replay of a disagreement-adjudication selector: diff candidates on probe inputs, adjudicate the disputed output against the spec, on all retained K pools (printf + stamp), versus majority.";
const REPLAY2 = "Disagreement-adjudication selector replayed offline on all retained K pools: diff candidate signatures on probe inputs, decide the disputed output from spec, never by majority count.";

test("a duplicate claim gets one advisory notice @-naming both seats and the earlier key", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "claim/adjudication-replay", claim("adjudication-replay", "alice", REPLAY));
  const e = h.setBoard(name, b.id, "claim/selector-replay", claim("selector-replay", "bob", REPLAY2));
  assert.ok(e, "the claim is written, not refused");
  const n = notices(h, name);
  assert.equal(n.length, 1);
  assert.match(n[0].content, /@bob your "claim\/selector-replay" overlaps @alice's "claim\/adjudication-replay"/);
  assert.equal(n[0].kind, "chat", "chat kind so the @-mentions wake a held wait");
});

test("unrelated claims post nothing", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "claim/blind-drafts", claim("blind-drafts", "alice", "Hidden draft/* board prefix, revealed together once every voter has drafted; regression script."));
  h.setBoard(name, b.id, "claim/executable-challenge", claim("executable-challenge", "bob", "A challenge carrying a runnable command is answered only by a verify entry rerunning it with exit 0."));
  assert.equal(notices(h, name).length, 0);
});

test("updating your own claim, or a claim by the same seat, never notices", () => {
  const { h, name, a } = room();
  h.setBoard(name, a.id, "claim/adjudication-replay", claim("adjudication-replay", "alice", REPLAY));
  h.setBoard(name, a.id, "claim/selector-replay", claim("selector-replay", "alice", REPLAY2));
  h.setBoard(name, a.id, "claim/adjudication-replay", claim("adjudication-replay", "alice", REPLAY + " status update"));
  assert.equal(notices(h, name).length, 0);
});

test("a departed owner's claim does not trigger a notice (nobody left to coordinate with)", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "claim/adjudication-replay", claim("adjudication-replay", "alice", REPLAY));
  h.leave(name, a.id, "done");
  h.setBoard(name, b.id, "claim/selector-replay", claim("selector-replay", "bob", REPLAY2));
  assert.equal(notices(h, name).length, 0);
});

test("claimTerms stems key and note, drops stopwords and JSON field names", () => {
  const t = Hub.claimTerms("claim/launcher-spawner", claim("launcher", "x", "the spawner and the fleet"));
  assert.deepEqual([...t].sort(), ["fleet", "launch", "spawne"]);
});

test("board_set's MCP response carries overlaps for the claimant (the synchronous half), none for a distinct claim", async () => {
  const hub = new Hub();
  const call = async (who: string) => {
    const session = createSessionServer(hub);
    const client = new Client({ name: who, version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await session.server.connect(st);
    await client.connect(ct);
    return async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      assert.ok(!r.isError, JSON.stringify(r));
      return JSON.parse((r.content as { text: string }[])[0].text);
    };
  };
  const [asA, asB] = [await call("alice"), await call("bob")];
  const room = "claim-overlap-live";
  await asA("join_room", { room, name: "alice", agent: "test" });
  await asB("join_room", { room, name: "bob", agent: "test" });
  const first = await asA("board_set", { room, key: "claim/adjudication-replay", text: claim("adjudication-replay", "alice", REPLAY) });
  assert.equal(first.overlaps, undefined, "nothing to overlap with yet");
  const second = await asB("board_set", { room, key: "claim/selector-replay", text: claim("selector-replay", "bob", REPLAY2) });
  assert.equal(second.overlaps?.[0]?.key, "claim/adjudication-replay");
  assert.equal(second.overlaps[0].by, "alice");
  assert.ok(second.overlaps[0].shared_pct >= 40);
  const other = await asB("board_set", { room, key: "claim/executable-challenge", text: claim("executable-challenge", "bob", "A challenge carrying a runnable command is answered only by a verify entry rerunning it with exit 0.") });
  assert.equal(other.overlaps, undefined);
  const plain = await asB("board_set", { room, key: "evidence/x", text: REPLAY });
  assert.equal(plain.overlaps, undefined, "only claim/* keys are scored");
});

let failed = 0;
for (const [name, run] of cases) {
  try { await run(); console.log(`ok - ${name}`); } catch (e) { failed++; console.error(`FAIL - ${name}\n${(e as Error).stack}`); }
}
if (failed) { console.error(`${failed} of ${cases.length} failed`); process.exit(1); }
console.log(`claim-overlap-regression: ${cases.length} passed`);
