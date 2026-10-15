/**
 * The same work taken twice in the first minute of a room (board evidence/duplication, swarm-092526-89rn). Replaying
 * every take/ and claim/ creation in the room logs, the hub's same-work rule (equal key words) matched no pair, yet:
 * - swarm-130459-mrw4-crypto: take/decode-takers (crypto-claude-2, 13:06:00) and take/taker-decode (crypto-claude-1,
 *   13:06:03) named the same eight wallets; both were granted, and c1 fetched the same wallets over the shared IP budget
 *   until c2 noticed in chat 5 min 39 s later. Only a plural told the keys apart.
 * - swarm-130459-mrw4-tennis: take/data-feed-lag (tennis-claude-4) and claim/data-feed-lag (tennis-claude-3) 6 s apart,
 *   the same piece; take/ and claim/ were never compared with each other.
 * So: a plural is not a difference in a take's words, and a take and a claim naming the same work get one advisory @-line
 * (a claim is never refused for overlap; a take inside someone's area may be meant as help). Every firing is an
 * overlap_notice record in the room log.
 * Run: npx tsx scripts/take-same-work-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";

const cases: [string, () => Promise<void> | void][] = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

let serial = 0;
function room(dataDir?: string) {
  const h = new Hub({ dataDir });
  const name = `same-work-${++serial}`;
  const [a, b, c] = ["crypto-claude-1", "crypto-claude-2", "crypto-claude-3"].map((n) => h.join(name, n, "test", {}, undefined, `sess-${n}`).participant);
  return { h, name, a, b, c };
}
const throws = (run: () => unknown, re: RegExp) => assert.throws(run, (e: Error) => re.test(e.message) || assert.fail(`unexpected message: ${e.message}`));
const notices = (h: Hub, name: string) => h.getRoom(name).messages.filter((m) => m.content.includes("names the same work"));
const records = (dir: string, type: string) => readdirSync(dir).filter((f) => f.endsWith(".jsonl"))
  .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)).filter((e) => e.type === type);

test("the recorded crypto pair: a plural is not a difference, the second take is refused with its holder", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, b.id, "take/decode-takers", "crypto-claude-2: decode the taker-heavy wallets (0xcE25, dangerously-skip-per, GoodFallen)");
  throws(() => h.setBoard(name, a.id, "take/taker-decode", "crypto-claude-1: decode the high-taker-share wallets (0xcE25, dangerously-skip-per)"),
    /names the same work as "take\/decode-takers", held by crypto-claude-2/);
});

test("different work still passes: another noun, a narrower key, a word ending in ss", () => {
  const { h, name, a, b, c } = room();
  h.setBoard(name, b.id, "take/decode-takers", "takers");
  h.setBoard(name, a.id, "take/maker-decode", "makers"); // the recorded follow-up take: other work
  h.setBoard(name, c.id, "take/decode-takers-gpu", "narrower");
  h.setBoard(name, a.id, "take/class-check", "x");
  h.setBoard(name, b.id, "take/clas-check", "a different word, not a plural");
  assert.equal(h.getRoom(name).board.get("take/maker-decode")?.text, "makers");
});

test("the recorded tennis pair: a claim after a take of the same words gets one advisory notice @-naming both, and stands", () => {
  const dir = mkdtempSync(join(tmpdir(), "same-work-"));
  const { h, name, a, b } = room(dir);
  h.setBoard(name, a.id, "take/data-feed-lag", "crypto-claude-1: free live score feeds, measured lead/lag vs Polymarket price");
  const e = h.setBoard(name, b.id, "claim/data-feed-lag", JSON.stringify({ owner: "crypto-claude-2", area: "data-feed-lag", what: "free live score feed recorder" }));
  assert.ok(e, "the claim is written, not refused");
  const n = notices(h, name);
  assert.equal(n.length, 1);
  assert.match(n[0].content, /@crypto-claude-2 your "claim\/data-feed-lag" names the same work as @crypto-claude-1's "take\/data-feed-lag"/);
  assert.equal(n[0].kind, "chat", "chat kind so the @-mentions wake a held wait");
  const rec = records(dir, "overlap_notice");
  assert.equal(rec.length, 1);
  assert.deepEqual([rec[0].key, rec[0].other, rec[0].by, rec[0].other_by, rec[0].rule], ["claim/data-feed-lag", "take/data-feed-lag", "crypto-claude-2", "crypto-claude-1", "same-work"]);
});

test("a take after a claim of the same words (plural aside) gets the notice too; the claim owner's own take does not", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "claim/feed-lags", JSON.stringify({ owner: "crypto-claude-1", area: "feed-lags" }));
  h.setBoard(name, a.id, "take/feed-lag", "mine: no notice");
  assert.equal(notices(h, name).length, 0);
  h.setBoard(name, a.id, "take/feed-lag", ""); // released, so the next take is judged against the claim alone
  h.setBoard(name, b.id, "take/lag-feed", "crypto-claude-2: the same piece");
  assert.equal(notices(h, name).length, 1);
  assert.match(notices(h, name)[0].content, /@crypto-claude-2 your "take\/lag-feed" names the same work as @crypto-claude-1's "claim\/feed-lags"/);
});

test("a released claim and a different area post nothing", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "claim/data-feed-lag", JSON.stringify({ owner: "crypto-claude-1", area: "data-feed-lag", status: "released" }));
  h.setBoard(name, b.id, "take/data-feed-lag", "free now");
  h.setBoard(name, a.id, "claim/sim-harness", JSON.stringify({ owner: "crypto-claude-1", area: "sim-harness" }));
  h.setBoard(name, b.id, "take/sim-harness-review", "other work");
  assert.equal(notices(h, name).length, 0);
});

for (const [n, run] of cases) {
  try { await run(); console.log(`ok - ${n}`); } catch (e) { console.error(`FAIL - ${n}\n${(e as Error).stack}`); process.exitCode = 1; }
}
if (!process.exitCode) console.log("TAKE SAME WORK OK");
