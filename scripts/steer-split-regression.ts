/** Fixture-log census, blinded label accounting and the real CLI. No model calls or hub needed. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { collectSteers, labelAgreement, purposeCue, sampleSteers, summarizeLabels } from "./steer-split.js";
import { parseRoomLog } from "../src/run-metrics.js";
import { steerCount } from "../src/telemetry/steer-count.js";

const fixture = resolve("scripts/fixtures/steer-split.jsonl");
const events = parseRoomLog(readFileSync(fixture, "utf8"));
const rows = collectSteers([{ file: fixture, events }]);
assert.equal(rows.length, 7, "four initial chats, two inbox versions, one token chat; never injected copies");
assert.equal(rows.length, steerCount([events])[0].steers, "same population as existing steer-count");
assert.deepEqual(rows.map(r => r.kind), ["chat", "chat", "chat", "chat", "note", "correction", "chat"]);
assert.deepEqual(rows.map(r => r.proxy), ["reframe", "unblock", "both", "other", "unblock", "reframe", "unblock"]);
assert.equal(purposeCue(""), "uncertain");
assert.ok(rows.every(r => r.id.length === 64));
assert.equal(new Set(rows.map(r => r.id)).size, 7);
assert.equal(rows[6].text.includes("fixture_secret"), false, "packet redacts credentials");
assert.equal(rows[6].redacted, true);
assert.ok(rows[4].context.length <= 3);
assert.deepEqual(sampleSteers([...rows].reverse(), 3), sampleSteers(rows, 3), "hash sampling independent of file order");
assert.deepEqual(collectSteers([]), []);
const foreignChair = [{ type: "join", room: "other", p: { name: "visitor", role: "chair", agent: "claude" } }];
const foreignMessage = [{ type: "room", room: "child" }, { type: "message", msg: { seq: 8, kind: "chat", from: { name: "visitor", agent: "claude" }, content: "recruit" } }];
assert.equal(collectSteers([{ file: "parent", events: foreignChair }, { file: "child", events: foreignMessage }]).length, 1, "chair recognition crosses supplied logs");
const labels = [{ id: rows[0].id, label: "reframe" }, { id: rows[1].id, label: "unblock" }];
assert.deepEqual(summarizeLabels(rows, labels), { n: 2, reframe: 1, unblock: 1, both: 0, other: 0, uncertain: 0 });
const audit = [{ id: rows[0].id, label: "both" }, { id: rows[1].id, label: "unblock" }];
const agreement = labelAgreement(labels, audit);
assert.equal(agreement.n, 2);
assert.equal(agreement.exact, 1);
assert.equal(agreement.rate, 0.5);
assert.equal(agreement.disagreements[0].id, rows[0].id);
assert.throws(() => summarizeLabels(rows, [...labels, labels[0]]), /duplicate/);
assert.throws(() => summarizeLabels(rows, [{ id: "missing", label: "other" }]), /not in/);
assert.throws(() => summarizeLabels(rows, [{ id: rows[0].id, label: "invalid" }]), /label/);
assert.throws(() => labelAgreement(labels, [{ id: "unlabelled", label: "other" }]), /author label/);
const dir = mkdtempSync(join(tmpdir(), "steer-split-test-"));
try {
  const lp = join(dir, "labels.json"), ap = join(dir, "audit.json");
  writeFileSync(lp, JSON.stringify(labels)); writeFileSync(ap, JSON.stringify(audit));
  const raw = execFileSync(process.execPath, ["--import", "tsx", "scripts/steer-split.ts", fixture, "--json", "--sample", "30", "--labels", lp, "--audit", ap], { encoding: "utf8" });
  const out = JSON.parse(raw);
  assert.equal(out.totals.steers, 7);
  assert.equal(out.manual.n, 2);
  assert.equal(out.audit.exact, 1);
  assert.equal(out.sample.length, 7);
  assert.equal(raw.includes("fixture_secret"), false);
  assert.equal(out.inputs[0].sha256.length, 64);
  for (const args of [[], [fixture, "--sample", "-1"], [fixture, "--typo"], [fixture, "--labels", lp, "--audit"], [fixture, "--audit", ap]]) {
    const bad = spawnSync(process.execPath, ["--import", "tsx", "scripts/steer-split.ts", ...args], { encoding: "utf8" });
    assert.equal(bad.status, 2, `invalid args rejected: ${args}`);
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log("steer-split regression: ok (7 fixture steers; CLI, labels, blind agreement, redaction)");
