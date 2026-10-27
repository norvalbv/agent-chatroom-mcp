/** Flat seats open on distinct targets: PORT=<free port> npx tsx scripts/seat-targets-regression.ts (needs npm run build)
 * In swarm-082539-kns2, 5 of 7 flat workers opened on item 1 of a 4-item brief: every flat seat got a byte-identical
 * brief, so one model picked one target at t≈0 (settled axis flat-seats-capped-per-model: distinct targets per seat).
 * The launcher is run for real with stub claude binaries on PATH, and each seat's prompt is read from what the stub
 * received on stdin. No model is called. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, writeFakeBins } from "./seat-launch-fixture.ts";
import { briefSeeds, seatTarget } from "../src/seat-targets.ts";
import * as targeting from "../src/seat-targets.ts";

import { parseResources } from "../src/resources.ts";

const PORT = process.env.PORT ?? String(await freePort());

const TASK = [
  "Improve the widget service.",
  "SEEDS, a start and not a boundary:",
  "1. Telemetry. Every run should leave a record of what its agents did.",
  "2. Measurement. Every effect needs a before and after.",
  "3. Round 1's REMAINING list. Three branches wait to merge.",
  "Go well beyond these.",
].join("\n");

test("briefSeeds takes the first numbered list, one label per item", () => {
  assert.deepEqual(briefSeeds(TASK), ["Telemetry", "Measurement", "Round 1's REMAINING list"]);
  assert.deepEqual(briefSeeds("no list here\n1. only one item"), []);
  assert.deepEqual(briefSeeds("a\n1) one\n2) two\nlater\n1. other\n2. list\n3. longer"), ["one", "two"]);
});

test("seatTarget gives each of k seats its own item, then second angles with lenses", () => {
  const lenses = ["L1", "L2"];
  const t = [1, 2, 3, 4, 5].map((i) => seatTarget(TASK, i, lenses));
  assert.equal(new Set(t).size, 5, "five distinct sentences");
  assert.match(t[0], /item 1 .*"Telemetry"/);
  assert.match(t[2], /item 3 .*"Round 1's REMAINING list"/);
  assert.match(t[3], /second angle on item 1 .*"L1"/);
  assert.equal(seatTarget("no numbered list", 1, lenses), "");
});

const RULES = "Research the winning examples and reuse prior data.\nTHIS ROOM'S OWN RULES:\n1. Make one final proposal.\n2. Review every commit.";
const ITEM_FILE = "## item: Explain winners\nCompare observed winners to the tested window.\n\n## item: Reuse data\nIdentify what the prior run already established.\n";

test("explicit resources override numbered operating rules in worker prompts", () => {
  const workers = launchWorkers("explicit", [], RULES, ITEM_FILE);
  assert.match(workers[0], /Your starting area: item\/(explain-winners|reuse-data)/);
  for (const worker of workers) assert.doesNotMatch(worker, /Your starting area:[^\n]*Make one final proposal/);
  assert.equal(workers.filter((w) => w.includes('starting area: item/explain-winners')).length, 1);
  assert.equal(workers.filter((w) => w.includes('starting area: item/reuse-data')).length, 1);
  assertTargetReceipt("explicit");
  const result = JSON.parse(readFileSync(join(base, "explicit", "result.json"), "utf8"));
  assert.equal(result.sizing.brief_items, 2);
  assert.equal(result.seatTargets.source, "item");
  assert.deepEqual(result.seatTargets.items.map((x: { key: string }) => x.key), ["item/explain-winners", "item/reuse-data"]);
  const receipts = result.seatTargets.assignments;
  assert.equal(receipts.filter((x: { source: string }) => x.source === "item").length, 3);
  assert.equal(receipts.find((x: { seat: string }) => x.seat === "verifier").source, "none");
});

test("explicit resources remain coverage inputs when targets are disabled", () => {
  const workers = launchWorkers("explicit-off", ["--no-seat-targets"], RULES, ITEM_FILE);
  for (const worker of workers) assert.ok(!worker.includes("Your starting area"));
  const result = JSON.parse(readFileSync(join(base, "explicit-off", "result.json"), "utf8"));
  assert.equal(result.seatTargets.source, "none");
  assert.equal(result.sizing.brief_items, 0);
  assert.equal(result.rooms[0].payload.board["item/explain-winners"].text.includes("Compare observed winners"), true);
});

test("one explicit item and repeated titles retain their coverage identities", () => {
  const one = targeting.selectTargets(RULES, parseResources("## archive\nread data here\n## item: Check evidence\nCompare observations to claims"));
  assert.equal(one.source, "item");
  assert.deepEqual(one.items, [{ key: "item/check-evidence", label: "Check evidence" }]);
  assert.match(seatTarget(RULES, 2, ["independent"], one), /second angle on item\/check-evidence/);
  const two = targeting.selectTargets(RULES, parseResources("## item: Same title\nFirst task\n## item: Same title\nDifferent task"));
  assert.deepEqual(two.items.map((x) => x.key), ["item/same-title", "item/same-title-2"]);
  assert.match(seatTarget(RULES, 2, [], two), /Read item\/same-title-2 on the board/);
});

test("fallback exposes numbered provenance and selected labels without claiming they are objectives", () => {
  const fallback = targeting.selectTargets(RULES, parseResources("## archive\nOnly informational data"));
  assert.equal(fallback.source, "numbered");
  assert.match(targeting.targetSelectionNote(fallback), /WARNING.*operating rules.*Make one final proposal.*## item:/);
  assert.equal(targeting.selectTargets("Only bullets\n- alpha\n- beta").source, "none");
});

const base = realpathSync(mkdtempSync(join(tmpdir(), "seat-targets-")));
/** The launcher leaves the hub it started running (detached); stop only that hub: this checkout's dist/index.js on PORT. */
function stopOurHub() {
  for (const pid of spawnSync("lsof", ["-ti", `:${PORT}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean)) {
    const args = spawnSync("ps", ["-o", "args=", "-p", pid], { encoding: "utf8" }).stdout;
    if (args.includes(join(process.cwd(), "dist", "index.js"))) process.kill(Number(pid));
  }
}
after(() => { stopOurHub(); rmSync(base, { recursive: true, force: true }); });

/** The worker prompts the stub claude received from one real launch (verifier left out). Extra flags go before the task,
 * so a boolean flag missing from BOOL_FLAGS would swallow the task as its value. */
function launchWorkers(tag: string, extra: string[], task = TASK, resources?: string): string[] {
  const [bin, records, data] = ["bin", "records", "data"].map((d) => join(base, tag, d));
  for (const d of [bin, records, data]) mkdirSync(d, { recursive: true });
  writeFakeBins(bin);
  if (resources) { const file = join(base, tag, "resources.md"); writeFileSync(file, resources); extra = [...extra, "--resources", file]; }
  const r = spawnSync(process.execPath, ["dist/swarm.js", ...extra, task, "--flat", "--agents", "4", "--no-carry", "--timeout", "1", "--port", PORT!, "--result-path", join(base, tag, "result.json")], {
    encoding: "utf8",
    timeout: 90_000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_RECORD_DIR: records, CHATROOM_INSECURE_LOCAL: "1", CHATROOM_NO_RECRUIT: "1", CHATROOM_DATA_DIR: data },
  });
  stopOurHub();
  const stdins = readdirSync(records).map((f) => (JSON.parse(readFileSync(join(records, f), "utf8")) as { stdin: string }).stdin);
  const workers = stdins.filter((s) => !s.includes("You are verifier"));
  assert.equal(workers.length, 3, `three worker prompts recorded (launcher exit ${r.status}; stderr tail: ${String(r.stderr).slice(-600)})`);
  return workers;
}

function assertTargetReceipt(tag: string): void {
  const artifact = JSON.parse(readFileSync(join(base, tag, "result.json"), "utf8"));
  const receipt = JSON.parse(readFileSync(join(process.cwd(), "swarms", artifact.run.id, "seat-targets.json"), "utf8"));
  assert.deepEqual(receipt, artifact.seatTargets, "dispatch receipt survives into the final artifact");
  assert.ok(receipt.assignments.every((x: { stage: string }) => x.stage === "dispatch-planned"), "receipts do not claim actual execution");
}

test("the launcher hands each flat worker a different starting item", () => {
  const workers = launchWorkers("on", []);
  const items = workers.map((s) => /Your starting area: item (\d+)/.exec(s)?.[1]);
  assert.deepEqual([...items].sort(), ["1", "2", "3"], `each worker opens on its own item: got ${JSON.stringify(items)}`);
});

test("--no-seat-targets launches the old byte-identical brief (the A arm)", () => {
  const workers = launchWorkers("off", ["--no-seat-targets"]);
  for (const w of workers) assert.ok(!w.includes("Your starting area"), "no starting item");
});
