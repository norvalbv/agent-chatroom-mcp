/** Project-owned catalogues are loaded afresh and delivered with original status/provenance.
 * Run: node --import tsx scripts/source-feed-regression.ts. No agents or remote data are used. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, after } from "node:test";
import { loadSourceFeed, mergeSourceResources } from "../src/launch/source-feed.js";

const root = mkdtempSync(join(tmpdir(), "source-feed-"));
after(() => rmSync(root, { recursive: true, force: true }));
let serial = 0;
const record = (overrides: Record<string, unknown> = {}) => ({
  id: "facts/old-through", path: "facts/old-through.md", title: "Old trade through classification",
  kind: "fact", status: "superseded", summary: "The old count conflated two fill classes; use the replacement.",
  measured: "2026-10-26", superseded_by: "methods/fill-classes", sources: ["raw/checked-events.json"], ...overrides,
});
function fixture(entries = [record()]) {
  const dir = join(root, String(serial++));
  mkdirSync(join(dir, "lake"), { recursive: true });
  writeFileSync(join(dir, "swarm.sources.json"), JSON.stringify({ version: 1, sources: [{ id: "case", path: "lake/index.json" }] }));
  const index = join(dir, "lake", "index.json");
  writeFileSync(index, JSON.stringify({ count: entries.length, entries }));
  return { dir, index };
}

test("registered project data arrives without a per-launch resources argument, with statuses intact", () => {
  const { dir, index } = fixture();
  const feed = loadSourceFeed(dir);
  assert.ok(feed, "a configured source feed must not be silently omitted");
  assert.equal(feed.receipt.sources.length, 1);
  const source = feed.receipt.sources[0]!;
  assert.equal(source.records, 1);
  assert.equal(source.sha256, createHash("sha256").update(readFileSync(index)).digest("hex"));
  assert.equal(source.path, index);
  assert.equal(source.statusCounts.superseded, 1);
  assert.ok(feed.entries.every((e) => e.text.length <= 8000));
  const pages = feed.entries.filter((e) => e.key !== "resource/source-case").map((e) => e.text).join("\n");
  assert.match(pages, /"status":"superseded"/);
  assert.match(pages, /"measured":"2026-10-26"/);
  assert.match(pages, /"superseded_by":"methods\/fill-classes"/);
  assert.match(pages, /The old count conflated two fill classes; use the replacement\./);
  assert.match(feed.entries[0]!.text, /snapshot|loaded/i);
});

test("same registration reads the changed source next launch; delivery time is not measured time", () => {
  const { dir, index } = fixture();
  const old = loadSourceFeed(dir)!;
  writeFileSync(index, JSON.stringify({ count: 1, entries: [record({ status: "verified", summary: "Corrected conclusion", measured: "2026-10-27", superseded_by: [] })] }));
  const fresh = loadSourceFeed(dir)!;
  assert.notEqual(fresh.receipt.sources[0]!.sha256, old.receipt.sources[0]!.sha256);
  assert.equal(fresh.receipt.sources[0]!.statusCounts.verified, 1);
  assert.ok(fresh.entries.some((e) => e.text.includes("Corrected conclusion")));
  assert.ok(!fresh.entries.some((e) => e.text.includes("The old count")));
});

test("default absence is optional, explicit absence and malformed declared sources are errors", () => {
  assert.equal(loadSourceFeed(root), undefined);
  assert.throws(() => loadSourceFeed(root, join(root, "missing.json")), /cannot read|cannot be read/i);
  const { dir, index } = fixture();
  rmSync(index);
  assert.throws(() => loadSourceFeed(dir), /case|index\.json/);
  writeFileSync(index, "not json");
  assert.throws(() => loadSourceFeed(dir), /JSON|json/);
  writeFileSync(index, JSON.stringify({ count: 2, entries: [record()] }));
  assert.throws(() => loadSourceFeed(dir), /count/);
});

test("relative paths resolve at the registry, and other projects do not inherit it", () => {
  const { dir } = fixture();
  const elsewhere = join(root, "elsewhere"); mkdirSync(elsewhere, { recursive: true });
  assert.equal(loadSourceFeed(elsewhere), undefined);
  assert.equal(loadSourceFeed(elsewhere, join(dir, "swarm.sources.json"))!.receipt.sources[0]!.records, 1);
});

test("ambiguous identity, invalid status and escaping record paths fail visibly", () => {
  for (const entries of [[record(), record()], [record({ status: "maybe" })], [record({ path: "../private.md" })], [record({ path: "/etc/passwd" })]]) {
    const { dir } = fixture(entries);
    assert.throws(() => loadSourceFeed(dir), /duplicate|status|path|catalog/i);
  }
  const { dir } = fixture();
  writeFileSync(join(dir, "swarm.sources.json"), JSON.stringify({ version: 1, sources: [{ id: "case", path: "lake/index.json" }, { id: "case", path: "lake/index.json" }] }));
  assert.throws(() => loadSourceFeed(dir), /duplicate/i);
});

test("large raw evidence is projected, but summaries are never clipped to fit", () => {
  const { dir } = fixture([record({ sources: ["x".repeat(160_000)], summary: "Final caveat must survive intact." })]);
  const feed = loadSourceFeed(dir)!;
  assert.ok(feed.entries.some((e) => e.text.includes("Final caveat must survive intact.")));
  assert.ok(Buffer.byteLength(JSON.stringify({ entries: feed.entries })) < 100_000);
  const huge = fixture([record({ summary: "文".repeat(8000) })]);
  assert.throws(() => loadSourceFeed(huge.dir), /large|cap|8000|limit/i);
});

test("merge preserves manual items and refuses collisions or UTF-8 payload overflow", () => {
  const feed = loadSourceFeed(fixture().dir)!;
  const manual = [{ key: "item/audit", text: "Audit the data" }];
  assert.equal(mergeSourceResources(manual, feed)[0]!.key, "item/audit");
  assert.throws(() => mergeSourceResources([{ key: feed.entries[0]!.key, text: "collision" }], feed), /duplicate|collision/);
  const many = Array.from({ length: 7 }, (_, i) => ({ key: `resource/large-${i}`, text: "文".repeat(6000) }));
  assert.throws(() => mergeSourceResources(many, feed), /bytes|100|large|limit/i);
});
