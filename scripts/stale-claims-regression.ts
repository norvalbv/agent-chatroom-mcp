/**
 * A departed seat's claim/* entries stay owned (so respawn still sees an orphaned claim and recruits for it), but the
 * seat's registered successor can take a claim over at once, and anyone can once the owner has been gone for
 * Hub.STALE_CLAIM_MS; each takeover is posted, and room_status lists stale claims. A live owner's refusal is
 * unchanged. Reference: Concord MCP's stale-claim list and audited ownership transfer (MIT); the gap was reproduced
 * by the reuse builders' probe (todo/stale-claims-after-seat-leaves.md).
 * Run: npx tsx scripts/stale-claims-regression.ts
 */
import assert from "node:assert/strict";
import { Hub } from "../src/hub.js";

const cases: [string, () => void][] = [];
const test = (name: string, run: () => void) => cases.push([name, run]);

let serial = 0;
function room() {
  const h = new Hub();
  const name = `stale-claims-${++serial}`;
  const [a, b, c] = ["alice", "bob", "carol"].map((n) => h.join(name, n, "test", {}, undefined, `sess-${n}`).participant);
  return { h, name, a, b, c };
}
const claim = (owner: string, note = "building it") => JSON.stringify({ area: "auth", owner, team: [owner], status: "open", note });
const takeovers = (h: Hub, name: string) => h.getRoom(name).messages.filter((m) => m.from.name === "system" && m.content.includes("took over"));
/** Leave, bypassing the leave-with-open-proposal warning, and backdate the departure. */
function depart(h: Hub, name: string, pid: string, agoMs: number) {
  h.leave(name, pid, "done for now");
  backdate(h, name, pid, agoMs);
}
function backdate(h: Hub, name: string, pid: string, agoMs: number) {
  const p = h.getRoom(name).participants.get(pid)!;
  p.lastActiveAt = new Date(Date.now() - agoMs).toISOString();
  delete p.working;
}

test("a live owner's claim still refuses a peer, with and without overwrite, with the same message", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "claim/auth", claim("alice"));
  assert.throws(() => h.setBoard(name, b.id, "claim/auth", claim("bob")), /claim "claim\/auth" is owned by alice \(since .*\)\. Join their team via help\/ or join-request\/, or pick another area\./);
  assert.throws(() => h.setBoard(name, b.id, "claim/auth", claim("bob"), { overwrite: true }), /is owned by alice/);
  assert.equal(takeovers(h, name).length, 0);
});

test("the registered successor takes a departed seat's claim at once; the takeover is posted and ownership moves", () => {
  const { h, name, a } = room();
  h.setBoard(name, a.id, "claim/auth", claim("alice"));
  const { replacementToken } = h.registerReplacement(name, a.id, "alice-r1");
  const succ = h.join(name, "alice-r1", "test", { replacementToken }, undefined, "sess-alice-r1").participant;
  const e = h.setBoard(name, succ.id, "claim/auth", claim("alice-r1", "picking up alice's work"));
  assert.equal(e?.by, "alice-r1", "the successor now owns it");
  const t = takeovers(h, name);
  assert.equal(t.length, 1);
  assert.match(t[0].content, /alice-r1 took over "claim\/auth" from alice \(registered successor\)/);
});

test("a peer cannot take a departed seat's claim before the stale window, and can after it", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "claim/auth", claim("alice"));
  depart(h, name, a.id, 60_000);
  assert.throws(() => h.setBoard(name, b.id, "claim/auth", claim("bob")), /is owned by alice/, "one minute gone is not stale");
  const status = h.summary(h.getRoom(name)) as { stale_claims: { key: string; owner: string; open_to: string }[] };
  assert.deepEqual(status.stale_claims.map((s) => [s.key, s.owner, s.open_to]), [["claim/auth", "alice", "successor"]]);
  backdate(h, name, a.id, Hub.STALE_CLAIM_MS + 1_000);
  const status2 = h.summary(h.getRoom(name)) as { stale_claims: { open_to: string }[] };
  assert.equal(status2.stale_claims[0].open_to, "anyone");
  const e = h.setBoard(name, b.id, "claim/auth", claim("bob", "alice left; taking it"));
  assert.equal(e?.by, "bob");
  assert.match(takeovers(h, name)[0].content, /bob took over "claim\/auth" from alice \(owner gone since /);
  const status3 = h.summary(h.getRoom(name)) as { stale_claims: unknown[] };
  assert.equal(status3.stale_claims.length, 0, "a taken-over claim is no longer stale");
});

test("a claim the hub released on removal stays open to anyone and is not reported as a takeover", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "claim/auth", claim("alice"));
  const e0 = h.getRoom(name).board.get("claim/auth")!;
  h.getRoom(name).board.set("claim/auth", { ...e0, by: "system", text: JSON.stringify({ area: "auth", status: "released" }) });
  const e = h.setBoard(name, b.id, "claim/auth", claim("bob"));
  assert.equal(e?.by, "bob");
  assert.equal(takeovers(h, name).length, 0);
});

let failed = 0;
for (const [name, run] of cases) {
  try { run(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`not ok - ${name}\n  ${(e as Error).message}`); }
}
if (failed) { console.log(`${failed} of ${cases.length} failed`); process.exit(1); }
console.log(`STALE CLAIMS REGRESSION OK (${cases.length})`);
