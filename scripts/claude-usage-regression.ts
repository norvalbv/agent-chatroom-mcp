#!/usr/bin/env node
/**
 * R4 usage-telemetry goal 2 regression: claude seats now report usage too.
 * RED before this change: `parseClaudeCliOutput` did not exist in src/result.ts, runClaude (src/swarm.ts)
 * never passed `--output-format json` and always resolved SeatOutcome.usage to null for every claude
 * seat (coverage would read "none" on every run now that claude seats are the main seats), and
 * SeatUsageRollup/UsageRollup had no room for claude's input_tokens/cache_read_input_tokens/
 * cache_creation_input_tokens/output_tokens fields alongside openrouter/codex's steps/prompt_tokens/
 * completion_tokens.
 * GREEN after: result.ts's rollup is extended (not forked) with optional claude-only fields, and
 * parseClaudeCliOutput turns a `claude -p --output-format json` stdout blob into {text, usage}. This
 * never calls the real `claude` binary or model: (c) below spawns a stub executable standing in for it.
 *
 *   npx tsx scripts/claude-usage-regression.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";

const { parseClaudeCliOutput, rollupUsage, renderRunReport } = await import("../src/result.js");

const dir = mkdtempSync(resolve(tmpdir(), "claude-usage-regression-"));
try {
  // (a) A real `claude -p --output-format json` blob: `result` is the seat's final text (unwrapped,
  // exactly what --output-format text would have printed), usage comes from usage.* + total_cost_usd.
  const blob = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "task done.\nWITH A SECOND LINE",
    total_cost_usd: 0.0123,
    usage: { input_tokens: 100, cache_read_input_tokens: 40, cache_creation_input_tokens: 10, output_tokens: 25 },
  });
  const parsed = parseClaudeCliOutput(blob);
  assert.equal(parsed.text, "task done.\nWITH A SECOND LINE", "(a) text is the unwrapped result field, not the raw JSON");
  assert.deepEqual(parsed.usage, { cost: 0.0123, input_tokens: 100, cache_read_input_tokens: 40, cache_creation_input_tokens: 10, output_tokens: 25 }, "(a) usage carries claude's fields, cost from total_cost_usd");

  // (b) Unknown stays distinct from zero: non-JSON stdout (crash, old CLI) and JSON missing a cost
  // figure both give usage:null, never a zero-filled usage object that would misreport a free run.
  const nonJson = parseClaudeCliOutput("not json at all");
  assert.equal(nonJson.text, "not json at all", "(b) non-JSON stdout: text falls back to the raw output");
  assert.equal(nonJson.usage, null, "(b) non-JSON stdout: usage is unknown, not zero");
  const noCost = parseClaudeCliOutput(JSON.stringify({ type: "result", result: "ok", usage: { input_tokens: 5 } }));
  assert.equal(noCost.text, "ok", "(b) JSON without total_cost_usd still yields the result text");
  assert.equal(noCost.usage, null, "(b) JSON without a cost figure: usage is unknown, not zero");
  const partialUsage = parseClaudeCliOutput(JSON.stringify({ type: "result", result: "ok", total_cost_usd: 0.01, usage: { input_tokens: 5 } }));
  assert.deepEqual(partialUsage.usage, { cost: 0.01, input_tokens: 5 }, "(b) a usage sub-object missing fields keeps only the fields it actually reported");

  // (c) Stub executable standing in for `claude`: a real subprocess, resolved off PATH by the bare
  // name "claude" exactly as runClaude spawns it, so the args it receives and the stdout it produces
  // round-trip through parseClaudeCliOutput correctly. No real model is ever invoked.
  const stubDir = resolve(dir, "bin");
  mkdirSync(stubDir);
  const stub = resolve(stubDir, "claude");
  writeFileSync(
    stub,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "if (!args.includes('--output-format') || args[args.indexOf('--output-format') + 1] !== 'json') { process.stderr.write('expected --output-format json\\n'); process.exit(1); }",
      "process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: 'stub seat final answer', total_cost_usd: 0.0007, usage: { input_tokens: 12, cache_read_input_tokens: 3, cache_creation_input_tokens: 0, output_tokens: 8 } }));",
      "",
    ].join("\n"),
  );
  chmodSync(stub, 0o755);
  const run = spawnSync("claude", ["-p", "do the task", "--mcp-config", "/tmp/mcp.json", "--strict-mcp-config", "--allowedTools", "Read,Edit", "--output-format", "json"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${stubDir}${delimiter}${process.env.PATH}` },
  });
  assert.equal(run.status, 0, `(c) stub claude exited nonzero: ${run.stderr}`);
  const seatOutcome = parseClaudeCliOutput(run.stdout.trim());
  assert.equal(seatOutcome.text, "stub seat final answer", "(c) real subprocess stdout parses to the seat's final text");
  assert.deepEqual(seatOutcome.usage, { cost: 0.0007, input_tokens: 12, cache_read_input_tokens: 3, cache_creation_input_tokens: 0, output_tokens: 8 }, "(c) real subprocess stdout parses to the expected usage");

  // (d) Extend the rollup, don't fork it: a claude seat and an openrouter seat roll up together, each
  // contributing only the fields its provider produces; an all-openrouter rollup's shape is untouched
  // (matches the existing telemetry-usage-regression assertions exactly, no extra keys).
  const mixed = [
    { name: "openrouter-1", text: "x", usage: { steps: 1, prompt_tokens: 10, completion_tokens: 5, cost: 0.001 } },
    { name: "claude-verifier", text: "y", usage: seatOutcome.usage },
  ];
  const rolled = rollupUsage(mixed)!;
  assert.equal(rolled.coverage, "complete", "(d) both seats reported usage => coverage complete");
  assert.equal(rolled.seats_with_usage, 2);
  assert.equal(rolled.prompt_tokens, 10, "(d) claude seat contributes nothing to prompt_tokens (it has none), not zero-filled elsewhere");
  assert.ok(Math.abs(rolled.cost_usd - 0.0017) < 1e-9, "(d) cost sums across providers");
  assert.equal(rolled.input_tokens, 12, "(d) claude-only field appears once a reporting seat has it");
  assert.equal(rolled.cache_read_input_tokens, 3);
  assert.equal(rolled.output_tokens, 8);

  const openrouterOnly = [{ name: "openrouter-1", text: "x", usage: { steps: 1, prompt_tokens: 10, completion_tokens: 5, cost: 0.001 } }];
  assert.deepEqual(rollupUsage(openrouterOnly), { steps: 1, prompt_tokens: 10, completion_tokens: 5, cost_usd: 0.001, seats: 1, seats_with_usage: 1, coverage: "complete" }, "(d) an all-openrouter rollup has no claude-only keys at all (shape unchanged)");

  // (e) renderRunReport surfaces the claude-only numbers: a claude-only run must not read as a free run
  // just because it has no steps/prompt_tokens/completion_tokens.
  const claudeOnlyArtifact = {
    schemaVersion: 1 as const,
    run: { id: "swarm-claude-only", startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:01:00Z", task: "t", doneWhen: "d" },
    project: { cwd: dir, canonicalPath: dir, git: null },
    leadRoom: "lead",
    rooms: [{ name: "lead", payload: { state: "concluded", conclusion: { text: "done" } }, error: null, transcript: { text: "t", sourceUrl: "u", error: null } }],
    verifier: { name: "verifier" as const, output: "ok" },
    reportPath: resolve(dir, "report.md"),
    artifactPath: resolve(dir, "result.json"),
    usage: rollupUsage([seatOutcome]),
  };
  const claudeOnlyReport = renderRunReport(claudeOnlyArtifact);
  assert.ok(claudeOnlyReport.includes("0 steps, 0 prompt + 0 completion tokens"), "(e) claude seats genuinely have no steps/prompt/completion counts");
  assert.ok(claudeOnlyReport.includes("12 input, 3 cache-read, 0 cache-creation, 8 output tokens"), "(e) but the real claude token counts are printed, not hidden");
  assert.ok(claudeOnlyReport.includes("$0.0007"), "(e) and the real cost is printed, not $0.0000");

  console.log("CLAUDE USAGE REGRESSION OK");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
