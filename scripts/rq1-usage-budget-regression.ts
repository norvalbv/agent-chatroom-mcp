#!/usr/bin/env node
/**
 * RQ1 harness item 3 (swarm-120129-s12h, claim/usage-budget): arm A budget matching.
 * RED before this change: scripts/rq1-usage-budget.ts does not exist, and parseClaudeCliOutput
 * (src/result.ts) does not surface num_turns/duration_ms/duration_api_ms from the claude CLI's
 * --output-format json envelope (only total_cost_usd/usage were parsed).
 * GREEN after: parseClaudeCliOutput additionally returns { numTurns, durationMs, durationApiMs } (undefined
 * when the envelope lacks them, never 0-filled), and scripts/rq1-usage-budget.ts exports matchArmABudget
 * (arm A's --max-budget-usd + wall-clock cap derived from arm C's measured, paired, within-task/within-seed
 * spend -- the claude CLI has no turn-ceiling flag, confirmed against `claude --help`: only
 * --max-budget-usd exists, print-mode only) and isComparable (the shared outcome->comparable rule, so
 * item 5's table/grid readers don't each redeclare it).
 *
 * Item 2 (per-run result recording) is fulfilled directly by scripts/bench-rq1.ts's own result.json
 * assembly (board key `result-schema`), not duplicated here -- see scripts/rq1-run-pair-regression.ts for
 * the end-to-end proof against that real harness.
 *
 *   npx tsx scripts/rq1-usage-budget-regression.ts
 */
import assert from "node:assert/strict";

const { parseClaudeCliOutput } = await import("../src/result.js");
const { matchArmABudget, isComparable } = await import("./rq1-usage-budget.js");

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

// (b) isComparable: matches bench-bench.ts's own comparability rule exactly -- excludes only
// timeout/infrastructure_error/tamper; task_fail and parse_failure stay comparable (measured failures,
// not voided runs).
{
  for (const outcome of ["task_pass", "task_fail", "parse_failure"]) assert.equal(isComparable(outcome), true, `(b) ${outcome} stays comparable`);
  for (const outcome of ["timeout", "infrastructure_error", "tamper"]) assert.equal(isComparable(outcome), false, `(b) ${outcome} voids comparability`);
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
