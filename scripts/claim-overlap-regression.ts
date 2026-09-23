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

// Verbatim from swarm-083203-kooz: two seats claimed the same idea, the second writing "what" instead of "note".
// Jaccard is only 0.23 (long bodies), so this is the slug rule: keys share "overlap", bodies share >= 20%.
const NOTICE = claim("claim-overlap-notice", "alice", "Room-level herding seen live here: 15 blind openings -> 2 ideas; 4 seats on the same selector, several on draft/* salvage. Hub change in setBoard: when a claim/* is first created, score its key+note against other live claims (content-word overlap) and post one advisory @author+@owner line naming the overlapping claim and shared terms. Not a refusal. Threshold calibrated on the 136 persisted room logs in data/*.jsonl; regression script + offline-runner entry.");
const ECHO = JSON.stringify({ owner: "bob", area: "claim-overlap-echo", what: "Evidence: in this room 7/14 worker openings chose the same draft/* salvage, and bench arm D got 3 near-simultaneous claims (5-5-13, 5-5-9, me) because board_set on claim/* returns only {key,chars,by}. Fix: a claim/* write returns (and the chat notice carries) the other open claims' owner+area+first ~100 chars of what, plus a line telling the seat to merge into an existing claim if it overlaps. Regression script + offline-runner entry. Released claim/bench-arm-d to 5-5-13/5-5-9." });

test("long-bodied duplicates with matching slugs are caught, reading free-text fields other than note (live pair)", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "claim/claim-overlap-notice", NOTICE);
  h.setBoard(name, b.id, "claim/claim-overlap-echo", ECHO);
  const n = notices(h, name);
  assert.equal(n.length, 1);
  assert.match(n[0].content, /@bob your "claim\/claim-overlap-echo" overlaps @alice's "claim\/claim-overlap-notice"/);
});

test("matching slugs alone are not enough: different bodies under a shared slug stem post nothing", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "claim/tests-harness", claim("tests-harness", "alice", "Port the bench harness fixtures to a hermetic temp dir so parallel runs stop colliding on port 8853."));
  h.setBoard(name, b.id, "claim/tests-dashboard", claim("tests-dashboard", "bob", "Playwright coverage for the dashboard's human composer: send, close room, and the veto button."));
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
