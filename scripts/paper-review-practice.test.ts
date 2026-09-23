/** Offline tests for the review-practice generators: node --import tsx scripts/paper-review-practice.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { agreement, buildReport, classify, extractHeads, type Codes, type HeadRow } from "./paper-verify-practice.ts";
import { tally } from "./paper-review-audit.ts";

const row = (id: string, extra: Partial<HeadRow> = {}): HeadRow => ({ id, room: "swarm-x", key: "verify/a", by: "b", proposal: "prop_1", proposer: "a", exit_code: 0, commit_named: false, schema_valid: true, command: "npm test", text: "", ...extra });
const codes = (final: Record<string, string>, a: Record<string, string> = final, b: Record<string, string> = final): Codes => ({
  coder_a: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { class: v as never, reason: "" }])),
  coder_b: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, { class: v as never, reason: "" }])),
  final: Object.fromEntries(Object.entries(final).map(([k, v]) => [k, { class: v as never, reason: "", basis: a[k] === b[k] ? "agreed" as const : "adjudicated" as const }])),
});

test("an entry's class is its final code, and an uncoded or unknown-class entry fails the report", () => {
  assert.equal(classify(row("r#0"), codes({ "r#0": "scripted_smoke" })), "scripted_smoke");
  assert.throws(() => classify(row("r#1"), codes({})), /no final code for r#1/);
  assert.throws(() => classify(row("r#2"), codes({ "r#2": "vibes" })), /unknown class/);
});

test("coder agreement is raw agreement plus Cohen's kappa", () => {
  const rows = [row("r#0"), row("r#1"), row("r#2"), row("r#3")];
  const c = codes({ "r#0": "existing_tests", "r#1": "own_check", "r#2": "existing_tests", "r#3": "own_check" },
    { "r#0": "existing_tests", "r#1": "own_check", "r#2": "existing_tests", "r#3": "own_check" },
    { "r#0": "existing_tests", "r#1": "own_check", "r#2": "own_check", "r#3": "own_check" });
  const g = agreement(rows, c);
  assert.deepEqual({ n: g.coded_by_both, agreed: g.agreed }, { n: 4, agreed: 3 });
  assert.equal(g.kappa, 0.5);
});

test("extraction keeps JSON heads only, reads a commands array, checks the schema, binds the proposer and shortens the home path", () => {
  const log = [
    { type: "proposal", proposal: { id: "prop_1", by: { name: "author" } } },
    { type: "board", key: "verify/prose", entry: { by: "x", text: "looks fine" } },
    { type: "board", key: "verify/json", entry: { by: "rev", text: '{"proposal":"prop_1","command":"cd /home/me/repo && npm test","cwd":".","exit_code":0,"output_tail":"ok","commit":"abc"}\nran it in a browser too' } },
    { type: "board", key: "verify/multi", entry: { by: "rev", text: '{"proposal":"prop_1","commands":["npx tsc","npm test"],"exit_code":0}' } },
    { type: "board", key: "claim/x", entry: { by: "rev", text: "{}" } },
  ].map((e) => JSON.stringify(e)).join("\n");
  const rows = extractHeads(log, "swarm-x", "/home/me");
  assert.equal(rows.length, 2);
  assert.deepEqual({ id: rows[0].id, proposer: rows[0].proposer, commit: rows[0].commit_named, valid: rows[0].schema_valid, command: rows[0].command },
    { id: "swarm-x#1", proposer: "author", commit: true, valid: true, command: "cd ~/repo && npm test" });
  assert.match(rows[0].text, /ran it in a browser too/);
  assert.deepEqual({ command: rows[1].command, valid: rows[1].schema_valid }, { command: "npx tsc && npm test", valid: false });
});

test("the report counts exit codes, commits, schema validity, classes by room kind and non-author entries", () => {
  const rows = [row("r#0"), row("r#1", { exit_code: 1, commit_named: true, schema_valid: false }), row("r#2", { by: "a" })];
  const t = buildReport(rows, { "swarm-x": "hub" }, codes({ "r#0": "existing_tests", "r#1": "scripted_smoke", "r#2": "existing_tests" }));
  assert.deepEqual(t.exit_code, { zero: 2, nonzero: 1, missing: 0 });
  assert.deepEqual({ commit: t.commit_named, valid: t.schema_valid }, { commit: 1, valid: 2 });
  assert.equal(t.by_kind.hub.existing_tests, 2);
  assert.equal(t.non_author.heads, 2);
  assert.throws(() => buildReport(rows, {}, codes({})), /has no kind|no final code/);
});

test("the audit tally counts acts and defects per method and rejects an unknown method", () => {
  const t = tally([{ room: "swarm-083203-kooz", review_acts: [{ method: "read_diff_only", found_defect: true }, { method: "reran_author_command", found_defect: false }] }]);
  assert.equal(t.total.n, 2);
  assert.equal(t.total.found, 1);
  assert.equal(t.yield.read_diff_only, 1);
  assert.equal(t.rooms[0].label, "Hub room A");
  assert.throws(() => tally([{ room: "r", review_acts: [{ method: "vibes" as never, found_defect: false }] }]), /unknown method/);
});
