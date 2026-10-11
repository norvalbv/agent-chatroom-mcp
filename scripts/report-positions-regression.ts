/** A grouped run that stops before its groups conclude still reports what each group held: the report prints a
 * non-concluded group's `position` board entry where it used to print only "_no consensus_", and the lead room's latest
 * digest/<n>. The Polymarket room of 2026-10-10 lost seven hours to exactly this: nothing was voted when the hub went
 * down, so its report had no answer in it. npx tsx scripts/report-positions-regression.ts */
import assert from "node:assert/strict";
import { renderRunReport, type RunResult } from "../src/result.js";

const room = (name: string, payload: Record<string, unknown>) => ({ name, payload, error: null, transcript: { text: "T", sourceUrl: "u", error: null } });
const result: RunResult = {
  schemaVersion: 1, run: { id: "s", startedAt: "a", completedAt: "b", task: "t", doneWhen: "d" }, project: { cwd: ".", canonicalPath: ".", git: null },
  leadRoom: "s-leads",
  rooms: [
    room("s-leads", { state: "open", conclusion: null, board: {
      "digest/1": { by: "digest-1", text: '{"pass":1}\nfirst pass', updated_at: "2026-10-11T01:00:00Z" },
      "digest/2": { by: "digest-2", text: '{"pass":2}\nBUILD holds X; BREAK shows Y.\n## heading in a digest', updated_at: "2026-10-11T01:45:00Z" },
      "digest/10": { by: "digest-10", text: '{"pass":10}\nthe latest pass', updated_at: "2026-10-11T07:45:00Z" },
    } }),
    room("s-build", { state: "open", conclusion: null, board: { position: { by: "build-claude-2", text: "The rule passes at $2,500.\n# evidence\nshared/x.py", updated_at: "2026-10-11T07:50:00Z" }, ledger: { by: "build-claude-1", text: "12 tests" } } }),
    room("s-break", { state: "concluded", conclusion: { text: "BREAK CONCLUSION TEXT" }, board: { position: { by: "break-claude-1", text: "superseded position" } } }),
    room("s-idle", { state: "open", conclusion: null, board: { "claim/x": { by: "a", text: "{}" } } }),
  ],
  verifier: { name: "verifier", output: null }, reportPath: "r", artifactPath: "a",
};
const md = renderRunReport(result);
const section = (name: string) => md.slice(md.indexOf(`### ${name} `), md.indexOf("\n### ", md.indexOf(`### ${name} `) + 5) > 0 ? md.indexOf("\n### ", md.indexOf(`### ${name} `) + 5) : md.indexOf("## Result artifact"));

const build = section("s-build");
assert.match(build, /_no consensus_/, "it still says the group did not conclude");
assert.match(build, /Its last `position` \(build-claude-2, 2026-10-11T07:50:00Z\):/, "and prints the position with who wrote it and when");
assert.ok(build.includes("The rule passes at $2,500."));
assert.ok(build.includes("\\# evidence"), "a heading inside a position cannot break the report's structure");
assert.ok(!build.includes("12 tests"), "other board entries are not dumped");

const brk = section("s-break");
assert.ok(brk.includes("BREAK CONCLUSION TEXT") && !brk.includes("superseded position"), "a concluded group shows its conclusion, not its position");
assert.match(section("s-idle"), /_no consensus_\n\nNo `position` entry on its board\./, "a group that never wrote one says so");

const top = md.slice(0, md.indexOf("## Verifier"));
assert.match(top, /### Latest consolidation pass: digest\/10 \(digest-10\)/, "the lead room's latest digest is printed, by number not by text order");
assert.ok(top.includes("the latest pass") && !top.includes("first pass"), "only the latest");
// a flat run (one room, no digests, no position) is unchanged
const flat = renderRunReport({ ...result, leadRoom: "one", rooms: [room("one", { state: "open", conclusion: null, board: {} })] });
assert.ok(!flat.includes("consolidation pass") && !flat.includes("`position`"));
console.log("REPORT POSITIONS REGRESSION OK");
