#!/usr/bin/env node
/**
 * R4 usage-telemetry regression (goal 5, lobby draft/r4-failing-test-spec).
 * RED on main (c0cf5a3): the seat never writes a <name>.usage.json sidecar (seat.ts:419-421
 * accumulates usage and openrouter.ts:130 writes only result.final to stdout, so usage dies at
 * the process boundary), RunResult has no usage field, and the launcher rollup helper does not
 * exist. GREEN only after the seat writes the sidecar (seat.ts usageSidecar option +
 * openrouter.ts --usage-sidecar) and result.ts/swarm.ts carry it into artifact.usage.
 *
 *   npm run build && npx tsx scripts/telemetry-usage-regression.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const { rollupUsage, readRunResult, writeRunResult, renderRunReport } = await import("../src/result.js");
const { runSeat } = await import("../src/seat.js");
import type { ChatProvider } from "../src/seat.js";
const dir = mkdtempSync(resolve(tmpdir(), "telemetry-usage-regression-"));
try {
  // (a) A seat invocation writes <name>.usage.json next to its .out with steps and prompt/completion
  // tokens, and stdout stays the seat's clean final text (runProc reads the whole .out as the text).
  const fake: ChatProvider = {
    label: "fake",
    async complete() {
      return { content: "task done.\nWITH A SECOND LINE", toolCalls: [], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 } };
    },
  };
  const sidecar = resolve(dir, "seat-a.usage.json");
  const seatResult = await runSeat(fake, { prompt: "finish the task", cwd: dir, maxSteps: 5, usageSidecar: sidecar });
  assert.ok(existsSync(sidecar), "(a) seat invocation must write <name>.usage.json sidecar next to its .out");
  const w = JSON.parse(readFileSync(sidecar, "utf8"));
  assert.equal(w.steps, 1, "(a) sidecar carries steps");
  assert.equal(w.prompt_tokens, 10, "(a) sidecar carries prompt_tokens");
  assert.equal(w.completion_tokens, 5, "(a) sidecar carries completion_tokens");
  assert.equal(w.cost, 0.001, "(a) sidecar carries cost (USD)");
  assert.equal(seatResult.final, "task done.\nWITH A SECOND LINE", "(a) stdout was not corrupted: the seat's full text is untouched");

  // (b) Launcher rollup produces artifact.usage with correct sums and coverage:"complete".
  const complete = [
    { name: "seat-1", text: "x", usage: { steps: 1, prompt_tokens: 10, completion_tokens: 5, cost: 0.001 } },
    { name: "seat-2", text: "y", usage: { steps: 1, prompt_tokens: 10, completion_tokens: 5, cost: 0.001 } },
  ];
  assert.deepEqual(rollupUsage(complete), { steps: 2, prompt_tokens: 20, completion_tokens: 10, cost_usd: 0.002, seats: 2, seats_with_usage: 2, coverage: "complete" });
  assert.deepEqual(rollupUsage([]), undefined, "no runs at all => no usage field");

  // (b2) One seat lacking usage => coverage:"partial" and the missing seat is NOT zero-filled.
  const partial = [
    { name: "seat-1", text: "x", usage: { steps: 1, prompt_tokens: 10, completion_tokens: 5, cost: 0.001 } },
    { name: "seat-2", text: "y", usage: null },
  ];
  const du = rollupUsage(partial)!;
  assert.equal(du.coverage, "partial", "(b2) one seat without usage => coverage partial");
  assert.equal(du.seats_with_usage, 1, "(b2) seats_with_usage reflects the reporting seat only");
  assert.equal(du.prompt_tokens, 10, "(b2) missing seat is NOT zero-filled: prompt_tokens stays 10, not 20");
  assert.equal(du.steps, 1, "(b2) unknown stays unknown, never zero");
  assert.equal(rollupUsage([{ name: "seat-1", text: "x", usage: null }, { name: "seat-2", text: "y", usage: null }])?.coverage, "none", "no seat reports usage => coverage none");

  // (c) writeRunResult/readRunResult round-trips usage; old (usage-less) artifacts stay valid at
  // schemaVersion 1; renderRunReport gains a Usage line.
  const artifact = {
    schemaVersion: 1 as const,
    run: { id: "swarm-telemetry", startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:01:00Z", task: "t", doneWhen: "d" },
    project: { cwd: dir, canonicalPath: dir, git: null },
    leadRoom: "lead",
    rooms: [{ name: "lead", payload: { state: "concluded", conclusion: { text: "done" } }, error: null, transcript: { text: "t", sourceUrl: "u", error: null } }],
    verifier: { name: "verifier" as const, output: "ok" },
    reportPath: resolve(dir, "report.md"),
    artifactPath: resolve(dir, "result.json"),
    usage: du,
  };
  writeRunResult(artifact.artifactPath, artifact);
  assert.deepEqual(readRunResult(artifact.artifactPath).usage, du, "(c) usage round-trips through the artifact");
  const report = renderRunReport(artifact);
  assert.ok(report.includes("10 prompt + 5 completion tokens") && report.includes("coverage: partial"), "(c) renderRunReport shows the usage rollup with real numbers and coverage");

  const legacy = { ...artifact, usage: undefined };
  writeRunResult(resolve(dir, "legacy.json"), legacy);
  assert.equal(readRunResult(resolve(dir, "legacy.json")).usage, undefined, "(c) schemaVersion 1 usage-less artifacts still read fine");

  console.log("TELEMETRY USAGE REGRESSION OK");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
