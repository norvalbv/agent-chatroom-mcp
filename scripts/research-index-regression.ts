/**
 * The research index does not read its own output (bugs.md 11, pack item 14). scripts/research-index.sh excluded
 * "INDEX.md" while the generated file is docs/research-index.md, so every regeneration listed the index as a place each
 * source was cited; and a DOI at the end of a sentence was kept with its full stop, so one source was listed twice
 * ("10.1145/2363.2433" and "10.1145/2363.2433.") in the list every seat's prompt carries as SOURCES ALREADY READ.
 * Run: npx tsx scripts/research-index-regression.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const run = (...args: string[]) => {
  const r = spawnSync("bash", ["scripts/research-index.sh", ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const table = run();
const rows = table.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Source") && !l.startsWith("|---"));
assert.ok(rows.length > 10, "the index lists sources");
const selfCited = rows.filter((l) => /research-index/.test(l.split("|")[2] ?? ""));
assert.equal(selfCited.length, 0, `the index cites itself for ${selfCited.length} sources, e.g. ${selfCited[0]}`);
const ids = run("--ids").split("\n").filter(Boolean);
const dotted = ids.filter((id) => /[.,;:]$/.test(id));
assert.deepEqual(dotted, [], "no id keeps the sentence's punctuation");
assert.equal(new Set(ids).size, ids.length, "each source once");
console.log(`RESEARCH INDEX OK (${ids.length} sources)`);

// the same list goes into every seat's prompt (src/settled.ts): this repository's own log once gave "10.1145/2363.2433"
// and "10.1145/2363.2433." as two sources
const { settledAxes } = await import("../src/settled.js");
const line = settledAxes(process.cwd()).split("\n").find((l) => l.startsWith("SOURCES ALREADY READ")) ?? "";
const promptIds = line.slice(line.indexOf("): ") + 3).split(", ").map((x) => x.trim()).filter(Boolean);
assert.ok(promptIds.length > 10);
assert.deepEqual(promptIds.filter((id) => /[.,;:]$/.test(id)), [], "the prompt's list keeps no sentence punctuation");
assert.equal(new Set(promptIds).size, promptIds.length);
console.log(`SEAT PROMPT SOURCES OK (${promptIds.length})`);
