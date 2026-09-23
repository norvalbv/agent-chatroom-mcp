/** A seat's prompt never appears in its argv: node --import tsx scripts/seat-prompt-argv.test.ts
 * In pool run room15-rep2 (2026-09-23) one seat's `pkill -f "offline-runner"` matched the brief that the launcher had put
 * in every seat's argv and killed 14 of 15 seats. argv is visible host-wide; the prompt now goes to claude on stdin. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeArgs } from "../src/claude-args.ts";
import { runClaudeSeat } from "./bench-build-runtime.ts";

const BRIEF = "Implement h14: make scripts/offline-runner.mjs time out each command.";

test("claudeArgs puts no prompt in argv: -p is followed by a flag", () => {
  const args = claudeArgs({ mcpJson: "/m.json", tools: ["Bash"], model: "claude-opus-5-5", outputFormat: "stream-json" });
  const i = args.indexOf("-p");
  assert.ok(i >= 0, "print mode");
  assert.ok(args[i + 1]?.startsWith("--"), `argument after -p is a flag, not a prompt: ${args[i + 1]}`);
});

test("runClaudeSeat hands the brief to claude on stdin and keeps it out of argv", async () => {
  const dir = mkdtempSync(join(tmpdir(), "seat-prompt-"));
  const record = join(dir, "record.json");
  const fake = join(dir, "claude");
  writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const stdin = fs.readFileSync(0, 'utf8');
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), stdin }));
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0, usage: {} }) + '\\n');
`);
  chmodSync(fake, 0o755);
  const args = claudeArgs({ mcpJson: "/m.json", tools: ["Bash"], outputFormat: "stream-json" });
  await runClaudeSeat("seat-1", args, dir, 20_000, { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, stdin: BRIEF });
  const seen = JSON.parse(readFileSync(record, "utf8")) as { argv: string[]; stdin: string };
  assert.equal(seen.stdin, BRIEF);
  assert.ok(!seen.argv.some((a) => a.includes("offline-runner")), "a pkill -f pattern from the brief cannot match the seat's argv");
});
