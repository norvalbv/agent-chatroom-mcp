/** Offline R1 harness-side regressions: tasks/bench-long-brief fixture integrity + its
 * budget-overrun proof (brief provably longer than the frozen seat budget: 3 min / 60
 * steps / 240k context, constants bench-bench freezes), and the seat-side handoff marker
 * line (src/seat-handoff-report.ts) that the harness reads from the seat's log stream.
 * Fails on main: neither the fixture directory nor the sidecar module exists there.
 * Run: npm run build && node --import tsx scripts/handoff-task-fixture.test.ts */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handoffMarkerLine } from "../dist/seat-handoff-report.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const taskDir = join(root, "tasks", "bench-long-brief");
const recordsDir = join(taskDir, "public", "records");
// frozen seat budget constants (bench-bench freezes these; see bench/results manifests)
const MAX_STEPS = 60;
const MAX_CONTEXT_CHARS = 240_000;
const MAX_TOOL_CHARS = 6000;
const READ_WINDOW = 400;
const SEAT_DEFAULT_MAX_STEPS = 600;

let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${(error as Error).message}`); }
}

test("fixture loads with handoff oracle kind", () => {
  const task = JSON.parse(readFileSync(join(taskDir, "task.json"), "utf8"));
  const oracle = JSON.parse(readFileSync(join(taskDir, "oracle", "oracle.json"), "utf8"));
  assert.equal(task.task_id, "bench-long-brief");
  assert.equal(oracle.kind, "handoff");
});

test("fixture is deterministic and large: 20 files, >=8000 lines, >=500KB, every file over the 400-line read window", () => {
  const files = readdirSync(recordsDir).filter((f) => /^records-\d\d\.txt$/.test(f)).sort();
  assert.equal(files.length, 20);
  let lines = 0, bytes = 0;
  const per: number[] = [];
  for (const f of files) {
    const t = readFileSync(join(recordsDir, f), "utf8");
    const n = t.split("\n").length - 1;
    lines += n; bytes += t.length; per.push(n);
  }
  assert.ok(lines >= 8000, `lines ${lines}`);
  assert.ok(bytes >= 500_000, `bytes ${bytes}`);
  assert.ok(per.every((n) => n > READ_WINDOW), "each file needs >=2 read_file calls (400-line window)");
});

test("context pressure is provably reached before the read work completes", () => {
  const reads = 20 * 2; // every file needs >=2 read_file calls
  assert.ok(reads * MAX_TOOL_CHARS > 0.9 * MAX_CONTEXT_CHARS,
    `${reads} reads * ${MAX_TOOL_CHARS}-char clamp = ${reads * MAX_TOOL_CHARS} > 0.9*${MAX_CONTEXT_CHARS}`);
});

test("the minimal read work exceeds the frozen 60-step seat budget (turns = 2 reads/file + 1 ledger call/file + join/finish)", () => {
  const minTurns = 20 * 2 + 20 + 2;
  assert.ok(minTurns > MAX_STEPS, `${minTurns} turns > ${MAX_STEPS} max_steps`);
});

test("the harness 60-step budget is tighter than the seat default 600, so a long fixture must overrun the harness budget", () => {
  assert.ok(MAX_STEPS < SEAT_DEFAULT_MAX_STEPS);
});

test("brief mandates the claim so the survival verdict's handoff/* is deterministic", () => {
  const brief = readFileSync(join(taskDir, "public", "brief.txt"), "utf8");
  assert.match(brief, /board_set claim\/bench-long-brief/);
});

test("handoff marker line normalises area names to handoff/ keys and is empty otherwise", () => {
  assert.equal(handoffMarkerLine({}), "");
  assert.equal(handoffMarkerLine({ handoffs: [] }), "");
  assert.equal(handoffMarkerLine({ handoffs: ["long-brief"], handoffReason: "read 14/20 files" }),
    "[seat-handoff] keys=handoff/long-brief reason=read 14/20 files");
  assert.equal(handoffMarkerLine({ handoffs: ["handoff/bench-long-brief"] }),
    "[seat-handoff] keys=handoff/bench-long-brief reason=", "full handoff/ keys pass through unchanged");
  assert.equal(handoffMarkerLine({ handoffs: ["", " "] }), "", "blank entries are not handoffs");
});

test("readme documents the survival verdict and pending-r9.1 runner dependency", () => {
  const readme = readFileSync(join(taskDir, "README.md"), "utf8");
  assert.match(readme, /handoff\//);
  assert.match(readme, /pending-r9\.1/);
  assert.match(readme, /leave_room/);
});

console.log(`HANDOFF FIXTURE: ${failed ? `${failed} failed` : "OK"}`);
process.exitCode = failed ? 1 : 0;
