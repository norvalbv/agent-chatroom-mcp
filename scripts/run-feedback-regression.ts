/** A concluded room may miss its task target. Feedback must name observed gaps without inventing a task verdict. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderRunReport, writeRunResult, type RunResult, type RoomSnapshot } from "../src/result.js";
import { runMetrics } from "../src/run-metrics.js";

const room = (name: string, payload: Record<string, any> | null): RoomSnapshot => ({ name, payload, error: null, transcript: { text: "", sourceUrl: "offline", error: null } });
const result = (...rooms: RoomSnapshot[]): RunResult => ({ schemaVersion: 1, run: { id: "feedback", startedAt: "", completedAt: "", task: "test the known winner", doneWhen: "frozen oracle passes" }, project: { cwd: ".", canonicalPath: ".", git: null }, leadRoom: rooms[0]?.name ?? "lead", rooms, verifier: { name: "verifier", output: null }, reportPath: "report.md", artifactPath: "result.json" });
const negative = { state: "concluded", conclusion: { text: "No tested replica meets the target. Known winners exist." }, board: {} };
const need = result(room("lead", { ...negative, board: { "needs/data": { text: "Owner already declined this; retained for audit." } } }));

// The old report prints the consensus and descriptive counters but gives the root no evidence-linked next step.
assert.match(renderRunReport(need), /## Next run/, "the root automatically receives next-run triage in the report");
const { runFeedback, renderFeedback, collectRoomMetrics } = await import("../src/telemetry/feedback.js");
const feedback = runFeedback(need);
assert.equal(feedback.taskOutcome, "unassessed");
assert.deepEqual(feedback.recommendations.map(r => r.id), ["review-needs"]);
assert.match(feedback.recommendations[0].action, /review|confirm/i);
assert.ok(!/blocked|failure caused by/i.test(feedback.recommendations[0].observation), "a still-listed need does not prove an active blocker");
assert.equal(feedback.recommendations[0].evidence[0].room, "lead");
assert.equal(feedback.recommendations[0].evidence[0].path, "board.needs/data");
assert.match(feedback.recommendations[0].evidence[0].sha256!, /^[a-f0-9]{64}$/);
assert.ok(feedback.unknowns.some(s => /lead.*metrics/i.test(s)));
assert.match(renderFeedback(feedback), /task attainment.*unassessed/i);

const clean = runFeedback(result(room("lead", negative)));
assert.equal(clean.recommendations.length, 0, "negative prose is not classified as failure");
assert.equal(clean.taskOutcome, "unassessed");
const history = [{ key: "needs/data", text: "need the missing source" }];
const fromHistory = (writes: typeof history) => {
  const board: Record<string, { text: string }> = {};
  for (const write of writes) { if (write.text) board[write.key] = { text: write.text }; else delete board[write.key]; }
  return runFeedback(result(room("lead", { ...negative, board })));
};
const beforeClear = fromHistory(history);
const afterClear = fromHistory([...history, { key: "needs/data", text: "" }]);
assert.equal(beforeClear.recommendations.length, 1);
assert.equal(afterClear.recommendations.length, 0, "same history plus clearing write retires the recommendation");
assert.notEqual(beforeClear.source.sha256, afterClear.source.sha256);
assert.notEqual(beforeClear.recommendations[0].evidence[0].sha256, fromHistory([{ key: "needs/data", text: "different need" }]).recommendations[0].evidence[0].sha256);

const uncovered = runFeedback(result(room("lead", { ...negative, coverage: { open: ["item/counterexample"], rows: [{ key: "item/counterexample", state: "unowned", owners: [] }] } })));
assert.deepEqual(uncovered.recommendations.map(r => r.id), ["cover-open-items"]);
assert.match(uncovered.recommendations[0].observation, /1/);
assert.equal(runFeedback(result(room("lead", { ...negative, coverage: { open: [], rows: [{ key: "item/counterexample", state: "done", owners: ["a"] }] } }))).recommendations.length, 0);

const missing = result(room("lead", null));
missing.collectionErrors = ["lead payload: HTTP 503"];
assert.ok(runFeedback(missing).recommendations.some(r => r.id === "restore-capture"));
const preflight = result(room("lead", negative));
preflight.preflight = { cmd: "checks", ranAt: "", durationMs: 1, exitCode: 0, checks: [], fails: 1, warns: 0, ignoredLines: 0, error: "printed no check lines" };
assert.ok(runFeedback(preflight).recommendations.some(r => r.id === "validate-environment"));
const many = result(room("lead", { ...need.rooms[0].payload, coverage: { open: ["item/a"] } }));
many.preflight = preflight.preflight;
many.collectionErrors = ["transcript unavailable"];
const ranked = runFeedback(many);
assert.equal(ranked.recommendations.length, 4);
assert.equal(ranked.next.length, 3);
assert.deepEqual(ranked.next.slice(0, 2).map(r => r.category), ["capture", "environment"]);

const metric = (events: Record<string, any>[]) => runMetrics([{ type: "room", room: "lead", opts: {}, createdAt: "2026-10-27T08:00:00Z" }, ...events]);
const research = result(room("lead", negative));
research.metrics = metric([{ type: "work", cls: "web", tool: "Bash", target: "git clone https://github.com/example/bot /tmp/bot", prior: "fetch" }]);
assert.ok(runFeedback(research).recommendations.some(r => r.id === "exercise-fetched-code"));
research.metrics.research!.steps.run = 1;
assert.ok(!runFeedback(research).recommendations.some(r => r.id === "exercise-fetched-code"));
research.metrics.research!.steps.run = 0;
research.metrics.research!.tagged = false;
assert.ok(!runFeedback(research).recommendations.some(r => r.id === "exercise-fetched-code"), "truncated historical targets cannot establish outside code was not run");
assert.ok(runFeedback(research).unknowns.some(s => /legacy|untagged/i.test(s)));

const open = result(room("lead", { state: "open", board: {}, proposals: [{ id: "p", status: "open", blocked_by: ["verify missing"], waiting_on: ["a"] }] }));
assert.ok(runFeedback(open).recommendations.some(r => r.id === "resume-open-work"));
const badCases = [feedback, uncovered, runFeedback(missing), runFeedback(preflight), runFeedback(open)];
assert.equal(badCases.filter(f => f.recommendations.length).length, 5);
assert.equal(clean.recommendations.length, 0);

// All rooms are measured once; failure in one room stays unknown and does not erase its captured snapshot.
const grouped = result(room("lead", negative), room("child", negative), room("offline", null));
const requests: string[] = [];
const fakeFetch: typeof fetch = async input => {
  const url = String(input); requests.push(url);
  return url.endsWith("/offline/metrics") ? new Response("no log", { status: 404 }) : Response.json({ ...metric([]), room: url.includes("child") ? "child" : "lead" });
};
await collectRoomMetrics(grouped.rooms, "http://offline", { fetch: fakeFetch });
assert.equal(requests.length, 3);
assert.equal(new Set(requests).size, 3);
assert.equal(grouped.rooms[1].metrics?.room, "child");
assert.equal(grouped.rooms[2].metrics, undefined);
assert.deepEqual(runFeedback(grouped).rooms, { total: 3, captured: 2, withMetrics: 2 });
for (const invalid of [{ ...metric([]), room: "another" }, { room: "lead", seats: "invalid" }]) {
  const snapshot = room("lead", negative);
  await collectRoomMetrics([snapshot], "http://fixture", { fetch: async () => Response.json(invalid) });
  assert.equal(snapshot.metrics, undefined);
  assert.match(snapshot.metricsError!, /mismatch/);
}
const checkpoint = result();
checkpoint.collectionErrors = ["incremental checkpoint: 1/3 runs complete"];
assert.equal(runFeedback(checkpoint).recommendations.length, 0);
const stale = result(room("lead", negative));
stale.feedback = feedback;
assert.ok(!renderRunReport(stale).includes("**review-needs"), "renderer ignores poisoned/stale persisted feedback without a write");

// Saved feedback is telemetry, never a stale cache: removing the need removes its recommendation on the next write.
const dir = mkdtempSync(join(tmpdir(), "feedback-"));
try {
  const file = join(dir, "result.json");
  writeRunResult(file, need);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).feedback.recommendations[0].id, "review-needs");
  need.rooms[0].payload!.board = {};
  writeRunResult(file, need);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).feedback.recommendations.length, 0);
  const cliFile = join(dir, "legacy.json");
  writeRunResult(cliFile, result(room("lead", negative)));
  writeFileSync(join(dir, "lead.jsonl"), '{"type":"room","room":"lead","opts":{},"createdAt":"2026-10-27T08:00:00Z"}\nnull\nnot-json\n');
  const original = readFileSync(cliFile, "utf8");
  const replay = spawnSync(process.execPath, ["--import", "tsx", "scripts/run-feedback.ts", cliFile, "--logs", dir, "--json"], { encoding: "utf8" });
  assert.equal(replay.status, 0, replay.stderr);
  const replayed = JSON.parse(replay.stdout);
  assert.equal(replayed.rooms.withMetrics, 1);
  assert.ok(replayed.unknowns.some((s: string) => /2 unreadable.*partial/.test(s)));
  assert.equal(readFileSync(cliFile, "utf8"), original, "offline replay leaves the original artifact untouched");
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log("RUN FEEDBACK REGRESSION OK (5 diagnostic fixtures, 1 clean negative control; task quality unmeasured)");
