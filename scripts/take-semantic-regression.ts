/**
 * Owner #895: the take same-work rule's word list (src/hub/take.ts HOW_WORDS) is "extremely naive". Scored offline on 609
 * labelled pairs from 215 room logs (board evidence/take-matcher-labels):
 * - equal key words found 1 of the 6 duplicate take pairs and refused reruns of another seat's result: in
 *   swarm-130459-mrw4-esports take/rerun-final-bid-esports and take/final-bid-esports-rerun were refused against
 *   take/final-bid-esports, because "rerun" counted as a how-word;
 * - an embedding of key + text (embeddinggemma, cosine >= 0.869) fired on 5 of 13,031 take pairs, all the same work,
 *   e.g. take/hub-openrouter-key-seat-env vs take/hub-openrouter-key-to-seats (swarm-211613-dpl4), which no word rule matched.
 * So: "rerun" is a word of the work again, the true word-rule refusals stay, and a meaning check advises (never refuses),
 * off unless CHATROOM_EMBED_URL is set, asynchronous with a hard timeout so a dead endpoint never delays a write.
 * The endpoint here is a local stub with fixed vectors; no model runs.
 * Run: npx tsx scripts/take-semantic-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";

const cases: [string, () => Promise<void> | void][] = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

let serial = 0;
function room(names = ["esports-claude-2", "esports-claude-3", "esports-claude-4"]) {
  const dir = mkdtempSync(join(tmpdir(), "take-semantic-"));
  const h = new Hub({ dataDir: dir });
  const name = `semantic-${++serial}`;
  const [a, b, c] = names.map((n) => h.join(name, n, "test", {}, undefined, `sess-${n}`).participant);
  return { h, dir, name, a: a!, b: b!, c: c! };
}
const records = (dir: string, type: string) => readdirSync(dir).filter((f) => f.endsWith(".jsonl"))
  .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)).filter((e) => e.type === type);
const notices = (h: Hub, name: string) => h.getRoom(name).messages.filter((m) => m.content.includes("reads like the same work"));
async function checks(dir: string, n: number, ms = 3000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 20))) if (records(dir, "semantic_check").length >= n) break;
  return records(dir, "semantic_check");
}

// a stub /api/embed: one axis per topic word, so texts about the same thing have cosine ~1 and others ~0.1
const TOPICS = ["openrouter", "esports", "guard", "decode", "posters"];
const vec = (t: string) => [...TOPICS.map((w) => (t.toLowerCase().includes(w) ? 1 : 0)), 0.1];
let calls = 0;
const stub = (hang = false) => new Promise<[Server, number]>((resolve) => {
  const s = createServer((req, res) => {
    let body = ""; req.on("data", (d) => (body += d));
    req.on("end", () => { calls++; if (hang) return; const { input } = JSON.parse(body) as { input: string[] }; res.end(JSON.stringify({ embeddings: input.map(vec) })); });
  });
  s.listen(0, "127.0.0.1", () => resolve([s, (s.address() as { port: number }).port]));
});
const withEnv = async (env: Record<string, string | undefined>, run: () => Promise<void>) => {
  const old = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try { await run(); } finally { for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
};

test("the recorded esports refusals: rerunning another seat's result is other work and passes", () => {
  const { h, name, a, c } = room();
  h.setBoard(name, a.id, "take/final-bid-esports", "esports-claude-2: final bid table");
  h.setBoard(name, c.id, "take/rerun-final-bid-esports", "esports-claude-4: rerun of the final bid on fresh prices");
  h.setBoard(name, c.id, "take/final-bid-esports-rerun", "esports-claude-4: the same, other spelling");
  assert.equal(h.getRoom(name).board.get("take/rerun-final-bid-esports")?.holder, "esports-claude-4");
});

test("the true word-rule refusals stay: trim-guard-size vs guard-size-trim, decode-takers vs taker-decode", () => {
  const { h, name, a, b } = room(["claude-opus-5-5-3", "claude-opus-5-5-4", "x"]);
  h.setBoard(name, a.id, "take/guard-size-trim", "claude-opus-5-5-3: trimming the guard-size hits");
  assert.throws(() => h.setBoard(name, b.id, "take/trim-guard-size", "claude-opus-5-5-4: trim guard size"), /names the same work as "take\/guard-size-trim"/);
  h.setBoard(name, a.id, "take/decode-takers", "takers");
  assert.throws(() => h.setBoard(name, b.id, "take/taker-decode", "takers"), /names the same work as "take\/decode-takers"/);
});

test("off by default: with no CHATROOM_EMBED_URL nothing is embedded, posted or recorded", async () => {
  await withEnv({ CHATROOM_EMBED_URL: undefined }, async () => {
    const before = calls;
    const { h, dir, name, a, b } = room(["claude-opus-5-5-4", "claude-opus-5-5-2", "x"]);
    h.setBoard(name, a.id, "take/hub-openrouter-key-seat-env", "seatChildEnv drops OPENROUTER_API_KEY");
    h.setBoard(name, b.id, "take/hub-openrouter-key-to-seats", "building the seat env fix for the openrouter key");
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(calls, before);
    assert.equal(notices(h, name).length, 0);
    assert.equal(records(dir, "semantic_check").length, 0);
  });
});

test("the recorded openrouter pair: no word rule matches it, the meaning check @-names both once and records it", async () => {
  const [s, port] = await stub();
  try {
    await withEnv({ CHATROOM_EMBED_URL: `http://127.0.0.1:${port}/api/embed`, CHATROOM_EMBED_MODEL: undefined, CHATROOM_EMBED_MIN: undefined }, async () => {
      const { h, dir, name, a, b } = room(["claude-opus-5-5-4", "claude-opus-5-5-2", "x"]);
      h.setBoard(name, a.id, "take/hub-openrouter-key-seat-env", "seatChildEnv drops OPENROUTER_API_KEY for seats");
      h.setBoard(name, b.id, "take/hub-openrouter-key-to-seats", "building the seat env fix for the openrouter key");
      const r = await checks(dir, 1);
      assert.equal(r.length, 1, "one check: the first take had nothing to compare with");
      assert.deepEqual([r[0]!.key, r[0]!.other, r[0]!.notified, r[0]!.model, r[0]!.min], ["take/hub-openrouter-key-to-seats", "take/hub-openrouter-key-seat-env", true, "embeddinggemma", 0.869]);
      assert.ok((r[0]!.cos as number) > 0.99 && typeof r[0]!.ms === "number");
      const n = notices(h, name);
      assert.equal(n.length, 1);
      assert.match(n[0]!.content, /@claude-opus-5-5-2 your "take\/hub-openrouter-key-to-seats" reads like the same work as @claude-opus-5-5-4's "take\/hub-openrouter-key-seat-env"/);
      assert.equal(n[0]!.kind, "chat", "chat kind so the @-mentions wake a held wait");
      const o = records(dir, "overlap_notice");
      assert.deepEqual([o.length, o[0]!.rule, o[0]!.shared_pct], [1, "semantic", 100]);
      assert.ok(h.getRoom(name).board.get("take/hub-openrouter-key-to-seats"), "advisory: the take stands");
    });
  } finally { s.close(); }
});

test("different work is checked and recorded but not posted; a take vs a claim is compared, claim vs claim is not", async () => {
  const [s, port] = await stub();
  try {
    await withEnv({ CHATROOM_EMBED_URL: `http://127.0.0.1:${port}/api/embed` }, async () => {
      const { h, dir, name, a, b, c } = room();
      h.setBoard(name, a.id, "take/final-bid-esports", "esports-claude-2: final bid table");
      h.setBoard(name, b.id, "take/decode-posters", "decode the poster wallets");
      let r = await checks(dir, 1);
      assert.deepEqual([r.length, r[0]!.notified], [1, false]);
      assert.ok((r[0]!.cos as number) < 0.5);
      h.setBoard(name, c.id, "claim/posters", JSON.stringify({ owner: "esports-claude-4", area: "posters", note: "decode the posters' wallets" }));
      r = await checks(dir, 2);
      assert.deepEqual([r.length, r[1]!.key, r[1]!.other, r[1]!.notified], [2, "claim/posters", "take/decode-posters", true]);
      h.setBoard(name, a.id, "claim/poster-wallets", JSON.stringify({ owner: "esports-claude-2", area: "poster wallets", note: "decode posters" }));
      r = await checks(dir, 3);
      assert.equal(r[2]!.other, "take/decode-posters", "a new claim is compared with takes only; claim vs claim is board.ts's stem rule");
      assert.equal(notices(h, name).length, 2);
    });
  } finally { s.close(); }
});

test("a dead endpoint never delays the write: closed port and a hanging server each cost one error record", async () => {
  const [hang, port] = await stub(true);
  const closed = await new Promise<number>((resolve) => { const t = createServer(); t.listen(0, "127.0.0.1", () => { const p = (t.address() as { port: number }).port; t.close(() => resolve(p)); }); });
  try {
    for (const [url, err] of [[`http://127.0.0.1:${closed}/api/embed`, /fetch failed|ECONNREFUSED/], [`http://127.0.0.1:${port}/api/embed`, /^timeout$/]] as const) {
      await withEnv({ CHATROOM_EMBED_URL: url, CHATROOM_EMBED_TIMEOUT_MS: "300" }, async () => {
        const { h, dir, name, a, b } = room(["claude-opus-5-5-4", "claude-opus-5-5-2", "x"]);
        h.setBoard(name, a.id, "take/hub-openrouter-key-seat-env", "openrouter key");
        const t0 = Date.now();
        h.setBoard(name, b.id, "take/hub-openrouter-key-to-seats", "openrouter key fix");
        assert.ok(Date.now() - t0 < 100, `setBoard returned in ${Date.now() - t0} ms`);
        const r = await checks(dir, 1);
        assert.equal(r.length, 1);
        assert.match(String(r[0]!.error), err);
        assert.equal(r[0]!.notified, false);
        assert.ok((r[0]!.ms as number) < 2000);
        assert.equal(notices(h, name).length, 0);
      });
    }
  } finally { hang.closeAllConnections(); hang.close(); }
});

test("an unknown model without CHATROOM_EMBED_MIN stays off: its cosines are not on embeddinggemma's scale", async () => {
  const [s, port] = await stub();
  try {
    await withEnv({ CHATROOM_EMBED_URL: `http://127.0.0.1:${port}/api/embed`, CHATROOM_EMBED_MODEL: "nomic-embed-text", CHATROOM_EMBED_MIN: undefined }, async () => {
      const before = calls;
      const { h, dir, name, a, b } = room(["claude-opus-5-5-4", "claude-opus-5-5-2", "x"]);
      h.setBoard(name, a.id, "take/hub-openrouter-key-seat-env", "openrouter key");
      h.setBoard(name, b.id, "take/hub-openrouter-key-to-seats", "openrouter key fix");
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(calls, before);
      assert.equal(records(dir, "semantic_check").length, 0);
    });
  } finally { s.close(); }
});

for (const [n, run] of cases) {
  try { await run(); console.log(`ok - ${n}`); } catch (e) { console.error(`FAIL - ${n}\n${(e as Error).stack}`); process.exitCode = 1; }
}
if (!process.exitCode) console.log("TAKE SEMANTIC OK");
