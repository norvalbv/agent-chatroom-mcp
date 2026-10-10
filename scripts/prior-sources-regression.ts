/**
 * Sources a prior run already read reach the next run's seats (swarm-082539-kns2, claim/source-carryover).
 * SOURCES ALREADY READ was built only from docs/decisions, so a source a prior run summarised on its board under
 * sources/* never reached the next run: round 1's board cited 33 arXiv ids, 7 reached round 2's list, and round 2
 * re-fetched 2 of the other 26. Now settledAxes() also lists the ids in the sources/* entries of the prior runs'
 * result.json boards, each with where its summary is, and leaves out ids the decision log already lists.
 * Run: npx tsx scripts/prior-sources-regression.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settledAxes } from "../src/settled.js";

const cwd = mkdtempSync(join(tmpdir(), "prior-sources-"));
mkdirSync(join(cwd, "docs", "decisions"), { recursive: true });
writeFileSync(join(cwd, "docs", "decisions", "some-axis.md"), "## Target 1 — Some axis\n\n**Ruling:** keep it.\n\nEvidence: arXiv:2401.00001.\n");

function run(id: string, board: Record<string, string>, ageMin: number) {
  const dir = join(cwd, "swarms", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "report.md"), `# ${id}\n\n**Task:** task of ${id}\n\n## Final answer (concluded)\n`);
  const payload = { board: Object.fromEntries(Object.entries(board).map(([k, text]) => [k, { text, by: "seat" }])) };
  writeFileSync(join(dir, "result.json"), JSON.stringify({ schemaVersion: 1, leadRoom: `${id}-room`, rooms: [{ name: `${id}-room`, payload }] }));
  const t = new Date(Date.now() - ageMin * 60_000);
  utimesSync(join(dir, "report.md"), t, t);
}
run("swarm-old", { "sources/2510.09462": "arXiv:2510.09462, adaptive attacks on monitors: agrees", "sources/recruiting": "CaptainAgent arXiv:2405.19425v2 and 10.1145/3586183.3606763", "sources/2401.00001": "already in the decision log", "findings/x": "mentions arXiv:2509.99999 in passing" }, 30);
run("swarm-new", { "sources/2510.09462": "read again here", "sources/ringelmann": "https://arxiv.org/abs/2606.02646" }, 5);

const text = settledAxes(cwd);
const block = text.slice(text.indexOf("SOURCES PRIOR RUNS READ"));
assert.ok(text.includes("SOURCES PRIOR RUNS READ"), `prior runs' sources are listed:\n${text}`);
assert.match(block, /2510\.09462/, "a source summarised on a prior run's board is listed");
assert.match(block, /2405\.19425/, "an entry keyed by area still yields its ids (version suffix dropped)");
assert.match(block, /10\.1145\/3586183\.3606763/, "DOIs too");
assert.match(block, /2606\.02646/, "an arxiv.org URL yields its id");
assert.match(block, /swarms\/swarm-old\/result\.json/, "it says where the summary is");
assert.match(block, /sources\/recruiting/, "...down to the board key");
assert.doesNotMatch(block, /2401\.00001/, "an id the decision log already lists is not repeated");
assert.doesNotMatch(block, /2509\.99999/, "only sources/* entries count: a passing mention is not a read source");
assert.equal(block.match(/2510\.09462 \(/g)?.length, 1, "an id two runs read is listed once, under the newer run");

console.log("prior-sources regression OK");
