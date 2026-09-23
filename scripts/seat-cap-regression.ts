/**
 * Flat-room seat cap (src/seat-cap.ts). RED before: `--flat --agents 15` launched 14 byte-identical
 * same-model workers; swarm-083203-kooz landed the same 157-line salvage twice (8b9f7d2, 223d512).
 * Run: npx tsx scripts/seat-cap-regression.ts
 * The launcher-level refusal (exit 2 before the hub starts) is covered in scripts/seat-env-regression.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_MAX_SAME_SEATS, seatCapRefusal, seatsPerModel } from "../src/seat-cap.ts";

const mix = (o: Partial<Parameters<typeof seatsPerModel>[0]>) => ({ workers: 3, models: [], codex: 0, codexModels: ["gpt-a", "gpt-b"], openrouter: 0, openrouterModels: ["ds"], ...o });
let failures = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`); } catch (e) { failures++; console.error(`FAIL ${name}: ${(e as Error).message}`); }
}

test("default cap is 4", () => assert.equal(DEFAULT_MAX_SAME_SEATS, 4));
test("the default --agents 4 (3 workers) passes", () => assert.equal(seatCapRefusal(mix({ workers: 3 }), 4), null));
test("5 same-model workers are refused at the default cap", () => assert.match(seatCapRefusal(mix({ workers: 5 }), 4) ?? "", /5 x claude:default/));
test("this room's shape (--flat --agents 15, one model) is refused and names the override", () => {
  const r = seatCapRefusal(mix({ workers: 14 }), 4);
  assert.match(r ?? "", /14 x claude:default/);
  assert.match(r ?? "", /--max-same-seats N/);
});
test("the README's 12-seat mix over 4 models passes (11 workers, 3 per model at most)", () => {
  assert.equal(seatCapRefusal(mix({ workers: 11, models: ["sonnet", "haiku", "fable", "opus"] }), 4), null);
  assert.equal(seatsPerModel(mix({ workers: 11, models: ["sonnet", "haiku", "fable", "opus"] })).get("claude:sonnet"), 3);
});
test("alt providers are counted per model and taken out of the claude seats", () => {
  const m = seatsPerModel(mix({ workers: 9, codex: 4, openrouter: 3 }));
  assert.equal(m.get("claude:default"), 2);
  assert.equal(m.get("codex:gpt-a"), 2);
  assert.equal(m.get("codex:gpt-b"), 2);
  assert.equal(m.get("openrouter:ds"), 3);
});
test("a 39-seat single-slug openrouter lobby is refused unless asked for", () => {
  const lobby = mix({ workers: 39, openrouter: 39 });
  assert.match(seatCapRefusal(lobby, 4) ?? "", /39 x openrouter:ds/);
  assert.equal(seatCapRefusal(lobby, 39), null);
});
test("launcher checks the cap before starting the hub", () => {
  const src = readFileSync(new URL("../src/swarm.ts", import.meta.url), "utf8");
  const cap = src.indexOf("seatCapRefusal({");
  assert.ok(cap > 0, "swarm.ts calls seatCapRefusal");
  assert.ok(cap < src.indexOf("await ensureHub();"), "refusal happens before ensureHub");
});
test("fleet asks for its same-model rooms on purpose in both launches (area and consolidation)", () => {
  const src = readFileSync(new URL("../src/fleet.ts", import.meta.url), "utf8");
  const launches = src.match(/"--flat", "--agents", String\(AGENTS\)[^\]]*\]/g) ?? [];
  assert.equal(launches.length, 2, "fleet launches swarm.js twice");
  for (const l of launches) assert.match(l, /"--max-same-seats", String\(AGENTS - 1\)/);
});
test("a non-numeric --max-same-seats is refused, not silently NaN", () => {
  const src = readFileSync(new URL("../src/swarm.ts", import.meta.url), "utf8");
  assert.match(src, /!Number\.isInteger\(MAX_SAME_SEATS\) \|\| MAX_SAME_SEATS < 1/);
});
console.log(`SEAT CAP: ${failures ? `${failures} failed` : "OK"}`);
process.exitCode = failures ? 1 : 0;
