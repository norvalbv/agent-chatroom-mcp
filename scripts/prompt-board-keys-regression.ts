/**
 * Every board key shape the seat prompts tell agents to write is one the board accepts (evidence-pack item 11,
 * bugs.md 7, sc-3597). Run: npx tsx scripts/prompt-board-keys-regression.ts
 *
 * prompts/worker.md, loop.md and recruit.md told seats to cache a large file's summary under digest/<path>@<hash>;
 * board keys have no "@", so in swarm-191130-twok five mandated digest writes were refused with "Board keys are short
 * names like ..." and the shared cache could not be used at all.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Hub } from "../src/hub.js";

/** what a seat would put in each placeholder */
const FILL: Record<string, string> = { path: "src/hub/board.ts", hash: "1a2b3c4d5e", area: "auth", what: "audit-exp-Q8", slug: "board-append", name: "seat-1", key: "decision/x", sha: "81d4f9c2", "short-sha": "81d4f9c2", room: "swarm-180216-182a-room", n: "3", id: "2404.13208", "arxiv-id": "2404.13208", item: "inbox-cap" };
const PREFIXES = ["claim", "take", "verify", "review", "attack", "idea", "resource", "handoff", "decision", "sources", "friction", "digest", "filedigest", "draft", "help", "join-request", "hold", "devroom", "evidence"];
const SHAPE = new RegExp("(?<![\\w/-])((?:" + PREFIXES.join("|") + ")/[^\\s`'\"),;]*<[a-z-]+>[^\\s`'\"),;]*)", "g");

let failed = 0;
const seen: string[] = [];
for (const file of readdirSync("prompts").filter((f) => f.endsWith(".md"))) {
  const text = readFileSync(join("prompts", file), "utf8");
  for (const m of text.matchAll(SHAPE)) {
    const shape = m[1].replace(/[.:]+$/, "");
    const key = shape.replace(/<([a-z-]+)>/g, (_all, p: string) => FILL[p] ?? `MISSING-${p}`);
    seen.push(`${file}: ${shape}`);
    try {
      assert.ok(!key.includes("MISSING-"), `no sample value for a placeholder in ${shape}`);
      assert.ok(Hub.BOARD_KEY.test(key), `${file} tells seats to write "${shape}", but "${key}" is not a valid board key`);
    } catch (e) { failed++; console.error(`FAIL ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
  }
}
// and the hub takes the write end to end
try {
  const hub = new Hub({});
  const a = hub.join("r", "seat-1", "claude", {}, undefined, "s1").participant;
  const shape = readFileSync("prompts/worker.md", "utf8").match(/board_set ((?:file)?digest\/[^\s`]+)/)?.[1];
  assert.ok(shape, "worker.md names the digest key to write");
  const key = shape!.replace(/<([a-z-]+)>/g, (_all, p: string) => FILL[p] ?? p);
  assert.doesNotThrow(() => hub.setBoard("r", a.id, key, "board.ts: the shared board, reserved prefixes, inbox cap."));
  console.log(`PASS the digest key from worker.md is accepted by board_set (${key})`);
} catch (e) { failed++; console.error(`FAIL ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
assert.ok(seen.length >= 5, `expected to find key shapes in the prompts, found ${seen.length}`);
if (failed) { console.error(`PROMPT BOARD KEYS: ${failed} failed (${seen.length} shapes checked)`); process.exitCode = 1; }
else console.log(`PROMPT BOARD KEYS OK (${seen.length} shapes checked)`);
