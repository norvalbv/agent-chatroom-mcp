/**
 * Seat commits run the repository's deterministic gates but not its AI reviewer gates (owner ruling #985, benji:
 * "don't run full llms reviewers here, the whole point is to peer review. you *can* use deterministc gates, but
 * bypass ai"). Run: npx tsx scripts/seat-ai-gates-regression.ts
 *
 * c3d2d088 gave seat worktrees the repo's hooks; in devkit that pre-commit runs the deterministic gates AND an LLM
 * reviewer fleet, completeness judge, decisions LLM and qavis vision route (evidence/seat-hooks-cost-and-bypass).
 * devkit already has a documented off switch for each AI gate; the seat's environment sets them.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seatChildEnv } from "../src/env.js";

// devkit-correctness-swarm: gate-engine/config.mts envVar (GUARD_ or FRINK_ prefix), review/cli.mts, completeness.mts,
// qavis-advisory/check.mts, sentry/check-sentry.mts
const AI_OFF = ["GUARD_DECISION_NO_LLM", "GUARD_NO_REVIEW", "GUARD_NO_COMPLETENESS", "GUARD_NO_QAVIS_ADVISORY", "GUARD_NO_SENTRY_JUDGE"];

const git = (cwd: string, env: NodeJS.ProcessEnv, ...args: string[]) =>
  spawnSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env });

/** A husky-style repo whose pre-commit has one deterministic gate (refuses BLOCKED) and one "AI" gate that leaves a marker when it runs. */
function repo(): string {
  const r = realpathSync(mkdtempSync(join(tmpdir(), "seat-ai-gates-")));
  git(r, process.env, "init", "-q");
  appendFileSync(join(r, ".git", "config"), "[core]\n\thooksPath = .husky/_\n");
  mkdirSync(join(r, ".husky", "_"), { recursive: true });
  writeFileSync(join(r, ".husky", "_", "pre-commit"), [
    "#!/bin/sh",
    "[ -f BLOCKED ] && { echo 'deterministic gate: refused' >&2; exit 1; }",
    "[ -n \"$GUARD_NO_REVIEW\" ] || [ -n \"$GUARD_DECISION_NO_LLM\" ] || touch \"$(git rev-parse --git-dir)/AI_REVIEWER_RAN\"",
    "exit 0", ""].join("\n"));
  chmodSync(join(r, ".husky", "_", "pre-commit"), 0o755);
  writeFileSync(join(r, "a.txt"), "a\n");
  git(r, process.env, "add", "a.txt");
  return r;
}

const made: string[] = [];
const bare = { PATH: process.env.PATH, HOME: process.env.HOME };
const cases: [string, () => void][] = [
  ["a seat's environment turns every devkit AI gate off", () => {
    const env = seatChildEnv(bare);
    for (const k of AI_OFF) assert.equal(env[k], "1", `${k} set for the seat`);
  }],
  ["an operator's explicit setting wins (CHATROOM_SEAT_AI_GATES=on or a GUARD_ value already exported)", () => {
    const on = seatChildEnv({ ...bare, CHATROOM_SEAT_AI_GATES: "on" });
    for (const k of AI_OFF) assert.equal(on[k], undefined, `${k} left unset when the run keeps AI gates`);
    assert.equal(on.CHATROOM_SEAT_AI_GATES, undefined, "the switch itself is not handed to the seat");
    assert.equal(seatChildEnv({ ...bare, GUARD_NO_REVIEW: "0" }).GUARD_NO_REVIEW, "0");
  }],
  ["a seat commit still runs the deterministic gate and skips the AI one", () => {
    const r = repo(); made.push(r);
    const env = { ...process.env, ...seatChildEnv(bare) };
    writeFileSync(join(r, "BLOCKED"), "x\n");
    git(r, env, "add", "BLOCKED");
    assert.equal(git(r, env, "commit", "-q", "-m", "refused").status, 1, "the deterministic gate refuses");
    git(r, env, "rm", "-q", "--cached", "BLOCKED");
    rmSync(join(r, "BLOCKED"));
    assert.equal(git(r, env, "commit", "-q", "-m", "ok").status, 0);
    assert.ok(!existsSync(join(r, ".git", "AI_REVIEWER_RAN")), "the AI reviewer gate did not run for the seat");
  }],
  ["the fixture's AI gate does run without the seat environment (the test can fail)", () => {
    const r = repo(); made.push(r);
    const env = { ...process.env };
    for (const k of AI_OFF) delete env[k];
    assert.equal(git(r, env, "commit", "-q", "-m", "ok").status, 0);
    assert.ok(existsSync(join(r, ".git", "AI_REVIEWER_RAN")));
  }],
  ["the launcher and recruit logs say so", async () => {
    const { aiGatesLine } = await import("../src/env.js");
    assert.match(aiGatesLine(seatChildEnv(bare)), /AI reviewer gates off for seat commits \(.*GUARD_NO_REVIEW.*\); deterministic gates still run/);
    assert.match(aiGatesLine(seatChildEnv({ ...bare, CHATROOM_SEAT_AI_GATES: "on" })), /AI reviewer gates ON/);
  }],
];

let failed = 0;
for (const [name, test] of cases) {
  try { await test(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message.split("\n")[0] : error}`); }
}
for (const dir of made) rmSync(dir, { recursive: true, force: true });
if (failed) { console.error(`SEAT AI GATES: ${failed}/${cases.length} failed`); process.exitCode = 1; }
else console.log(`SEAT AI GATES OK (${cases.length} cases)`);
