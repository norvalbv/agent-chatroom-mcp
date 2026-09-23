/** Offline tests for the review-practice generators: node --import tsx scripts/paper-review-practice.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport, candidateOf, classify, extractHeads, type HeadRow } from "./paper-verify-practice.ts";
import { tally } from "./paper-review-audit.ts";

const row = (id: string, command: string, extra: Partial<HeadRow> = {}): HeadRow => ({ id, room: "swarm-x", key: "verify/a", by: "b", proposal: "prop_1", proposer: "a", exit_code: 0, commit_named: false, command, ...extra });

test("a verify head's command is classed as smoke, existing tests, or a candidate that needs a hand label", () => {
  assert.equal(classify(row("r#0", "npx tsc --noEmit && PORT=1 npx tsx scripts/smoke.ts"), {}), "scripted_smoke");
  assert.equal(classify(row("r#1", "npx tsc --noEmit && npm test"), {}), "existing_tests");
  assert.equal(candidateOf("node dist/swarm.js brief --port 9"), "real_agents");
  assert.equal(candidateOf("npx playwright test"), "browser");
  assert.equal(candidateOf("python3 - <<'PY'\nprint(1)\nPY"), "own_probe");
  assert.throws(() => classify(row("r#2", "npx vite build"), {}), /unlabelled candidate r#2/);
  assert.equal(classify(row("r#2", "npx vite build"), { "r#2": { class: "existing_tests", note: "build only" } }), "existing_tests");
});

test("extraction keeps only JSON heads, numbers every verify write, binds the proposer and shortens the home path", () => {
  const log = [
    { type: "proposal", proposal: { id: "prop_1", by: { name: "author" } } },
    { type: "board", key: "verify/prose", entry: { by: "x", text: "looks fine" } },
    { type: "board", key: "verify/json", entry: { by: "rev", text: '{"proposal":"prop_1","command":"cd /home/me/repo && npm test","cwd":".","exit_code":0,"output_tail":"ok","commit":"abc"}\nprose' } },
    { type: "board", key: "claim/x", entry: { by: "rev", text: "{}" } },
  ].map((e) => JSON.stringify(e)).join("\n");
  const rows = extractHeads(log, "swarm-x", "/home/me");
  assert.equal(rows.length, 1);
  assert.deepEqual({ id: rows[0].id, by: rows[0].by, proposer: rows[0].proposer, commit: rows[0].commit_named, command: rows[0].command },
    { id: "swarm-x#1", by: "rev", proposer: "author", commit: true, command: "cd ~/repo && npm test" });
});

test("the report counts exit codes, commits, classes by room kind and non-author entries", () => {
  const rows = [row("r#0", "npm test"), row("r#1", "npx tsx scripts/smoke.ts", { exit_code: 1, commit_named: true }), row("r#2", "npm test", { by: "a" })];
  const t = buildReport(rows, { "swarm-x": "hub" }, {});
  assert.deepEqual(t.exit_code, { zero: 2, nonzero: 1, missing: 0 });
  assert.equal(t.commit_named, 1);
  assert.equal(t.by_kind.hub.existing_tests, 2);
  assert.equal(t.non_author.heads, 2);
  assert.throws(() => buildReport(rows, {}, {}), /has no kind/);
});

test("the audit tally counts acts and defects per method and rejects an unknown method", () => {
  const t = tally([{ room: "swarm-083203-kooz", review_acts: [{ method: "read_diff_only", found_defect: true }, { method: "reran_author_command", found_defect: false }] }]);
  assert.equal(t.total.n, 2);
  assert.equal(t.total.found, 1);
  assert.equal(t.yield.read_diff_only, 1);
  assert.equal(t.rooms[0].label, "Hub room A");
  assert.throws(() => tally([{ room: "r", review_acts: [{ method: "vibes" as never, found_defect: false }] }]), /unknown method/);
});
