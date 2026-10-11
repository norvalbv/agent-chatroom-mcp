/** A run's result.json names each Claude seat's transcript (telemetry gap G17: scripts/claude-room-usage.py globbed
 * ~/.claude and found 5 of 20 tky5 seats, because seats inherit the launcher's CLAUDE_CONFIG_DIR, a per-session
 * directory under Frink Dev/claude-sessions; evidence/refusals-by-guard-from-transcripts). Run: npx tsx scripts/seat-transcript-regression.ts */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseClaudeCliOutput, seatScorecard, transcriptPath } from "../src/result.js";

const SID = "042d003e-4f13-4ba3-a1b6-83764850902d";
assert.equal(parseClaudeCliOutput(JSON.stringify({ result: "done", session_id: SID, total_cost_usd: 1.5, usage: {} })).sessionId, SID, "claude -p's json carries the session id");
assert.equal(parseClaudeCliOutput("not json").sessionId, undefined);

const cfg = mkdtempSync(join(tmpdir(), "seat-transcript-"));
try {
  // Claude Code keeps a session's transcript at <config>/projects/<cwd with every non-alphanumeric as "-">/<session>.jsonl
  const cwd = "/Users/x/Desktop/Personal and learning/repo/.swarm-worktrees/run/seat-1";
  const dir = join(cfg, "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${SID}.jsonl`), "{}\n");
  assert.equal(transcriptPath(SID, cwd, cfg), join(dir, `${SID}.jsonl`), "found where Claude Code wrote it");
  // a cwd whose slug Claude Code spells differently is still found by the session id
  const other = join(cfg, "projects", "-somewhere-else");
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, "abc-123.jsonl"), "{}\n");
  assert.equal(transcriptPath("abc-123", "/does/not/match", cfg), join(other, "abc-123.jsonl"));
  assert.equal(transcriptPath("missing", cwd, cfg), undefined, "absent: unknown, never a guessed path");
  assert.equal(transcriptPath(undefined, cwd, cfg), undefined);
} finally { rmSync(cfg, { recursive: true, force: true }); }

// the scorecard carries it per seat
const snap = { name: "r", payload: { participants: [{ name: "seat-1", role: "worker", agent: "claude", messages: 1, active: false, left_reason: "done" }], board: {}, proposals: [] } } as any;
const [score] = seatScorecard([snap], { "seat-1": { exitCode: 0, transcript: "/x/projects/y/s.jsonl" } });
assert.equal(score.transcript, "/x/projects/y/s.jsonl");
console.log("seat-transcript-regression OK");
