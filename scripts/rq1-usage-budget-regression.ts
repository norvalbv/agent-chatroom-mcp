#!/usr/bin/env node
/**
 * RQ1 harness items 2+3 (swarm-120129-s12h, claim/usage-budget): per-run result recording and arm A
 * budget matching.
 * RED before this change: scripts/rq1-usage-budget.ts does not exist, and parseClaudeCliOutput
 * (src/result.ts) does not surface num_turns/duration_ms/duration_api_ms from the claude CLI's
 * --output-format json envelope (only total_cost_usd/usage were parsed), so a per-run result cannot
 * carry a real turn count without external transcript parsing.
 * GREEN after: parseClaudeCliOutput additionally returns { numTurns, durationMs, durationApiMs } (undefined
 * when the envelope lacks them, never 0-filled), and scripts/rq1-usage-budget.ts exports buildRunResult
 * (assembles the agreed bench/results/rq1/*.json shape) and matchArmABudget (arm A's --max-budget-usd +
 * wall-clock cap derived from arm C's measured, paired, within-task/within-seed spend — the claude CLI has
 * no turn-ceiling flag, confirmed against `claude --help`: only --max-budget-usd exists, print-mode only).
 *
 *   npx tsx scripts/rq1-usage-budget-regression.ts
 */
import assert from "node:assert/strict";

const { parseClaudeCliOutput } = await import("../src/result.js");
const { buildRunResult, matchArmABudget } = await import("./rq1-usage-budget.js");

// (a) parseClaudeCliOutput surfaces num_turns/duration_ms/duration_api_ms from the same envelope that
// already carries total_cost_usd/usage (real shape confirmed by sonnet-4's Haiku probe, board key
// evidence/claude-json-envelope) -- no external transcript parsing needed for a claude seat's turn count.
{
  const blob = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "task done.",
    total_cost_usd: 0.0123,
    num_turns: 4,
    duration_ms: 5321,
    duration_api_ms: 4900,
    session_id: "sess-abc",
    usage: { input_tokens: 100, cache_read_input_tokens: 40, cache_creation_input_tokens: 10, output_tokens: 25 },
  });
  const parsed = parseClaudeCliOutput(blob);
  assert.equal(parsed.numTurns, 4, "(a) numTurns comes from the envelope's num_turns");
  assert.equal(parsed.durationMs, 5321, "(a) durationMs comes from the envelope's duration_ms (wall)");
  assert.equal(parsed.durationApiMs, 4900, "(a) durationApiMs comes from the envelope's duration_api_ms");

  // (a2) missing/non-numeric fields are undefined, never 0-filled (an old CLI without num_turns must not
  // read as "zero turns").
  const noTurns = parseClaudeCliOutput(JSON.stringify({ type: "result", result: "ok", total_cost_usd: 0.01, usage: {} }));
  assert.equal(noTurns.numTurns, undefined, "(a2) missing num_turns stays undefined, not 0");
  assert.equal(noTurns.durationMs, undefined, "(a2) missing duration_ms stays undefined, not 0");
}

// (b) buildRunResult assembles the shape pinned with sonnet-2/sonnet-3 in the room
// (bench/results/rq1/<task>-<arm>-seed<seed>.json): schemaVersion, task, arm, seed, model, outcome,
// comparable (matching the existing bench-compare.json field name and its timeout/infra/tamper
// exclusion), usage{per_seat[],summed}, turns{value,approximated}, wall_clock{started_at,completed_at},
// build{...}, argv[].
{
  const result = buildRunResult({
    task: "bench-fact-check",
    arm: "A",
    seed: 1,
    model: "claude-sonnet-5",
    outcome: "task_pass",
    seats: [
      { name: "solo", usage: { cost: 0.0123, input_tokens: 100, cache_read_input_tokens: 40, cache_creation_input_tokens: 10, output_tokens: 25 } },
    ],
    turns: { value: 4, approximated: false },
    startedAt: "2026-09-18T12:00:00.000Z",
    completedAt: "2026-09-18T12:01:00.000Z",
    build: { hub_entry_sha256: null, hub_build_sha256: null, hub_revision: "abc123", task_sha256: "task-hash", scorer_sha256: "scorer-hash" },
    argv: ["-p", "brief text", "--output-format", "json"],
  });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.task, "bench-fact-check");
  assert.equal(result.arm, "A");
  assert.equal(result.seed, 1);
  assert.equal(result.outcome, "task_pass");
  assert.equal(result.comparable, true, "(b) task_pass is comparable");
  assert.equal(result.usage.per_seat.length, 1);
  assert.equal(result.usage.per_seat[0].name, "solo");
  assert.equal(result.usage.summed.cost_usd, 0.0123, "(b) summed usage reuses the existing rollupUsage logic");
  assert.equal(result.usage.summed.coverage, "complete");
  assert.deepEqual(result.turns, { value: 4, approximated: false });
  assert.deepEqual(result.wall_clock, { started_at: "2026-09-18T12:00:00.000Z", completed_at: "2026-09-18T12:01:00.000Z" });
  assert.equal(result.build.hub_revision, "abc123");
  assert.deepEqual(result.argv, ["-p", "brief text", "--output-format", "json"]);

  // (b2) comparable excludes exactly timeout/infrastructure_error/tamper, matching bench-bench.ts's own
  // comparability rule -- task_fail and parse_failure stay comparable (measured failures, not voided runs).
  for (const outcome of ["task_fail", "parse_failure"]) {
    const r = buildRunResult({ task: "t", arm: "C", seed: 1, model: "m", outcome, seats: [], turns: { value: 0, approximated: false }, startedAt: "s", completedAt: "e", build: { hub_entry_sha256: null, hub_build_sha256: null, hub_revision: null, task_sha256: "x", scorer_sha256: "y" }, argv: [] });
    assert.equal(r.comparable, true, `(b2) ${outcome} stays comparable`);
  }
  for (const outcome of ["timeout", "infrastructure_error", "tamper"]) {
    const r = buildRunResult({ task: "t", arm: "C", seed: 1, model: "m", outcome, seats: [], turns: { value: 0, approximated: false }, startedAt: "s", completedAt: "e", build: { hub_entry_sha256: null, hub_build_sha256: null, hub_revision: null, task_sha256: "x", scorer_sha256: "y" }, argv: [] });
    assert.equal(r.comparable, false, `(b2) ${outcome} voids comparability`);
  }

  // (b3) a seat that never reported usage is not zero-filled: it counts in `seats` but not
  // `seats_with_usage`/the sums, and coverage reflects the gap -- matches src/result.ts's existing
  // rollupUsage contract exactly (unknown never zero).
  const partial = buildRunResult({
    task: "t", arm: "C", seed: 2, model: "m", outcome: "task_pass",
    seats: [
      { name: "a", usage: { cost: 0.01 } },
      { name: "b", usage: null },
    ],
    turns: { value: 1, approximated: false }, startedAt: "s", completedAt: "e",
    build: { hub_entry_sha256: null, hub_build_sha256: null, hub_revision: null, task_sha256: "x", scorer_sha256: "y" }, argv: [],
  });
  assert.equal(partial.usage.summed.seats, 2);
  assert.equal(partial.usage.summed.seats_with_usage, 1);
  assert.equal(partial.usage.summed.coverage, "partial");
  assert.equal(partial.usage.summed.cost_usd, 0.01, "(b3) only the reporting seat contributes to the sum");
}

// (c) matchArmABudget: arm A's --max-budget-usd is set to arm C's realized total cost_usd on the exact
// same (task, seed) -- a paired, within-task match, not a single number reused across tasks (protocol
// §2.1) -- and the wall-clock cap is arm C's realized wall-clock duration on that same run, since the
// claude CLI offers no turn-ceiling flag.
{
  const matched = matchArmABudget({ costUsd: 0.42, wallClockMs: 90000 });
  assert.equal(matched.maxBudgetUsd, 0.42);
  assert.equal(matched.wallClockCapMs, 90000);

  // (c2) a zero/negative/non-finite arm C cost or wall time cannot derive a meaningful budget for arm A
  // (arm C must have actually run and spent something measurable first) -- refuse rather than silently
  // producing a $0 or 0ms cap that would make arm A un-runnable.
  assert.throws(() => matchArmABudget({ costUsd: 0, wallClockMs: 90000 }), /positive/);
  assert.throws(() => matchArmABudget({ costUsd: 0.1, wallClockMs: 0 }), /positive/);
  assert.throws(() => matchArmABudget({ costUsd: -1, wallClockMs: 90000 }), /positive/);
}

console.log("rq1-usage-budget-regression: OK");
