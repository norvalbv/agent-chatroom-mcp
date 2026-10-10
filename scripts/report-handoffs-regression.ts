/** A run that stops without a conclusion is judged by what it left on the board: the report prints the handoff/*
 * entries (and names the other findings) under the cause, instead of leaving them inside the transcript dump.
 * npx tsx scripts/report-handoffs-regression.ts */
import assert from "node:assert/strict";
import { classifyOutcome, renderRunReport, type RunResult } from "../src/result.js";

const board = {
  "claim/parser": { by: "a", text: "{}" },
  "handoff/parser": { by: "a", text: "Parser done on branch x at abc123.\n\n## Next\nwire it into the CLI", updatedAt: "2026-10-10T00:30:00Z" },
  "handoff/cli": { by: "b", text: "Nothing built. Next: read src/cli.ts:40." },
  "evidence/parser": { by: "a", text: "numbers" },
  "verify/parser": { by: "b", text: "{}" },
  "draft/b": { by: "b", text: "private draft" },
};
const mk = (payload: Record<string, unknown>): RunResult => ({
  schemaVersion: 1, run: { id: "s", startedAt: "a", completedAt: "b", task: "t", doneWhen: "d" }, project: { cwd: ".", canonicalPath: ".", git: null },
  leadRoom: "lead", rooms: [{ name: "lead", payload, error: null, transcript: { text: "T", sourceUrl: "u", error: null } }],
  verifier: { name: "verifier", output: null }, reportPath: "r", artifactPath: "a",
  outcome: classifyOutcome(payload, { timedOut: true }),
});
const open = renderRunReport(mk({ state: "open", conclusion: null, proposals: [], participants: [], board }));
assert.ok(open.includes("## Left on the board"), "a non-concluded run lists what it left");
assert.ok(open.includes("### handoff/parser (a)"), "each handoff is printed under its key and author");
assert.ok(open.includes("Parser done on branch x at abc123."));
assert.ok(open.includes("\\## Next"), "a heading inside an entry cannot break the report's own structure");
assert.ok(open.includes("### handoff/cli (b)"));
assert.match(open, /Other entries: evidence\/parser \(a\), verify\/parser \(b\)/, "other findings are named, not dumped; claims and drafts are left out");
assert.ok(open.indexOf("## Left on the board") < open.indexOf("## Verifier"), "it is the first thing after the cause");
// a run with nothing handed over says so in one line
const empty = renderRunReport(mk({ state: "open", conclusion: null, proposals: [], participants: [], board: { "claim/x": { by: "a", text: "{}" } } }));
assert.match(empty, /## Left on the board\n\nNo handoff\/\* entry and no findings: nothing recoverable was written down\./);
// a concluded run is unchanged: its conclusion is the answer
const done = renderRunReport(mk({ state: "concluded", conclusion: { text: "done" }, proposals: [], participants: [], board }));
assert.ok(!done.includes("## Left on the board"));
console.log("REPORT HANDOFFS REGRESSION OK");
