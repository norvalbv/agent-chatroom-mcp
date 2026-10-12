/**
 * Rank 3 (swarm-100622-6jdx peer-review plan): an author cannot self-freeze their own quality
 * baseline. RED on main today (no such guard exists: `guard:freeze` commits .devkit/baselines/**
 * with zero peer check — see commit 15d3717, docs/measurement-swarm-214936.md); GREEN after
 * scripts/guard-baseline-freeze.mjs + the .husky/pre-commit block that calls it.
 *
 * Drives a REAL hub (subprocess) so the "hub unreachable" path is genuinely exercised, and runs
 * the ACTUAL shell block from .husky/pre-commit (extracted by its own markers, executed with
 * /bin/sh) against a throwaway git repo, not a reimplementation of it. That block is checked to
 * be the guard alone before it runs, and runs in a process group with a deadline (sc-5346).
 *
 * Run: npx tsx scripts/baseline-freeze-guard-regression.ts
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { evaluate, HUB_URL_ENV, OVERRIDE_ENV } from "./guard-baseline-freeze.mjs";
import { runGrouped } from "./pool-mutation.ts";
import { SEAT_ENV_EXCLUSIONS, seatChildEnv } from "../src/env.js";

const PORT = Number(process.env.BASELINE_GUARD_PORT ?? 20_000 + Math.floor(Math.random() * 20_000)); // own port: seats run npm test side by side
const HTTP = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const dataDir = mkdtempSync(join(tmpdir(), "baseline-guard-hub-"));
const server = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: REPO_ROOT,
  env: { ...process.env, PORT: String(PORT), CHATROOM_DATA_DIR: dataDir, CHATROOM_SPAWN_DRY: "1" },
  stdio: ["ignore", "ignore", "inherit"],
});
let exiting = false;
process.on("exit", () => {
  if (exiting) return;
  exiting = true;
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
});

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${HTTP}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("hub did not start");
}

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "author-seat",
  GIT_AUTHOR_EMAIL: "author-seat@swarm.local",
  GIT_COMMITTER_NAME: "author-seat",
  GIT_COMMITTER_EMAIL: "author-seat@swarm.local",
};

function git(args: string[], cwd: string) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** A throwaway repo with one baseline file staged, so write-tree reflects a real change. */
function stageBaselineChange(fanoutValue: number) {
  const dir = mkdtempSync(join(tmpdir(), "baseline-guard-repo-"));
  git(["init", "-q", "-b", "main"], dir);
  mkdirSync(join(dir, ".devkit", "baselines"), { recursive: true });
  writeFileSync(join(dir, "f.txt"), "unrelated file");
  git(["add", "."], dir);
  git(["commit", "-q", "-m", "base"], dir);
  writeFileSync(join(dir, ".devkit", "baselines", "fanout.json"), JSON.stringify({ cap: fanoutValue }));
  git(["add", "."], dir);
  return dir;
}

let client: Client;
let call: (tool: string, args?: Record<string, unknown>) => Promise<any>;
const ROOM = "baseline-guard-test-room";

async function boardSetAs(name: string, key: string, text: string) {
  const c = new Client({ name, version: "0.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp`)));
  const invoke = async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await c.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    const text = res.content[0]?.text ?? "";
    if (res.isError) throw new Error(`${name}.${tool}: ${text}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  await invoke("join_room", { room: ROOM, name, agent: "test", topic: "baseline guard regression" });
  await invoke("board_set", { room: ROOM, key, text });
  await c.close().catch(() => {});
}

await waitForServer();

await test("no staged baseline/config change: guard is a no-op even with the hub down", async () => {
  const dir = mkdtempSync(join(tmpdir(), "baseline-guard-clean-"));
  git(["init", "-q", "-b", "main"], dir);
  writeFileSync(join(dir, "f.txt"), "unrelated file");
  git(["add", "."], dir);
  try {
    const result = await evaluate({ cwd: dir, env: { ...GIT_ENV, [HUB_URL_ENV]: "http://127.0.0.1:1" } });
    assert.equal(result.blocked, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("staged baseline change, no verify/baseline-* entry: BLOCKED", async () => {
  const dir = stageBaselineChange(4);
  try {
    const result = await evaluate({ cwd: dir, env: { ...GIT_ENV, [HUB_URL_ENV]: HTTP } });
    assert.equal(result.blocked, true);
    assert.match(result.reason, /verify\/baseline-/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("verify/baseline-* entry by a different seat naming the staged tree: ALLOWED", async () => {
  const dir = stageBaselineChange(5);
  try {
    const tree = git(["write-tree"], dir);
    await boardSetAs("reviewer-seat", "verify/baseline-fanout", `reviewed staged tree ${tree}: cap raise is justified, exit 0`);
    const result = await evaluate({ cwd: dir, env: { ...GIT_ENV, [HUB_URL_ENV]: HTTP } });
    assert.equal(result.blocked, false);
    assert.match(result.reason, /reviewer-seat/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("verify/baseline-* entry naming the WRONG tree hash: still BLOCKED", async () => {
  const dir = stageBaselineChange(6);
  try {
    await boardSetAs("reviewer-seat-2", "verify/baseline-fanout-2", "reviewed staged tree 0000000000000000000000000000000000000000: fine, exit 0");
    const result = await evaluate({ cwd: dir, env: { ...GIT_ENV, [HUB_URL_ENV]: HTTP } });
    assert.equal(result.blocked, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("verify/baseline-* entry authored by the SAME committer (self-verify): still BLOCKED", async () => {
  const dir = stageBaselineChange(7);
  try {
    const tree = git(["write-tree"], dir);
    await boardSetAs("author-seat", "verify/baseline-self", `reviewed staged tree ${tree}: looks fine, exit 0`);
    const result = await evaluate({ cwd: dir, env: { ...GIT_ENV, [HUB_URL_ENV]: HTTP } });
    assert.equal(result.blocked, true, "an author cannot freeze their own baseline by verifying it themselves");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("hub unreachable: fails CLOSED (blocked), not open", async () => {
  const dir = stageBaselineChange(8);
  try {
    const result = await evaluate({ cwd: dir, env: { ...GIT_ENV, [HUB_URL_ENV]: "http://127.0.0.1:1" }, timeoutMs: 500 });
    assert.equal(result.blocked, true);
    assert.match(result.reason, /unreachable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("maintainer override bypasses the guard even with no verify entry and hub unreachable", async () => {
  const dir = stageBaselineChange(9);
  try {
    const result = await evaluate({ cwd: dir, env: { ...GIT_ENV, [HUB_URL_ENV]: "http://127.0.0.1:1", [OVERRIDE_ENV]: "1" } });
    assert.equal(result.blocked, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test(".devkit/config.json alone (no baselines/ touch) is also covered", async () => {
  const dir = mkdtempSync(join(tmpdir(), "baseline-guard-config-"));
  git(["init", "-q", "-b", "main"], dir);
  mkdirSync(join(dir, ".devkit"), { recursive: true });
  writeFileSync(join(dir, "f.txt"), "unrelated");
  git(["add", "."], dir);
  git(["commit", "-q", "-m", "base"], dir);
  writeFileSync(join(dir, ".devkit", "config.json"), JSON.stringify({ review: { enabled: true } }));
  git(["add", "."], dir);
  try {
    const result = await evaluate({ cwd: dir, env: { ...GIT_ENV, [HUB_URL_ENV]: HTTP } });
    assert.equal(result.blocked, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("the maintainer override var is stripped from every seat's environment", () => {
  assert.ok(SEAT_ENV_EXCLUSIONS.includes(OVERRIDE_ENV), "SEAT_ENV_EXCLUSIONS must list the override var");
  const withOverride = { ...process.env, [OVERRIDE_ENV]: "1" };
  const seatEnv = seatChildEnv(withOverride, "some-seat");
  assert.equal(Object.hasOwn(seatEnv, OVERRIDE_ENV), false, "a seat's child env must never carry the override");
});

// ---- end-to-end: the ACTUAL .husky/pre-commit block, extracted by its own markers, run for real ----
const GUARD_OPEN = "# >>> baseline-freeze-guard >>>\n";
const GUARD_CLOSE = "# <<< baseline-freeze-guard <<<";
const DEVKIT_OPEN = "# >>> devkit-guards >>>";
const MAX_GUARD_LINES = 20;
const VERIFY_BASELINE = /verify\/baseline-/, DEVKIT_GATES_RAN = /Deterministic gates/;
const MOVED_INSIDE = /sc-5346/, GUARD_NOT_FIRST = /before the devkit-guards region/, DID_NOT_EXIT = /did not exit on its own/;

/** The text between the guard's markers, refused unless it is the guard alone: it is about to be executed. */
function extractGuardBlock(hook = readFileSync(join(REPO_ROOT, ".husky", "pre-commit"), "utf8")): string {
  const start = hook.indexOf(GUARD_OPEN);
  const end = hook.indexOf(GUARD_CLOSE, start);
  assert.ok(start >= 0 && end > start, ".husky/pre-commit must contain a baseline-freeze-guard marker block");
  const block = hook.slice(start + GUARD_OPEN.length, end);
  const moved = "devkit init/upgrade moved its region inside the baseline-freeze-guard markers of .husky/pre-commit (sc-5346): move the guard loop and its closing marker back above '# >>> devkit-guards >>>'";
  assert.ok(!block.includes("devkit-guards") && !block.includes("__dk_"), moved);
  const lines = block.split("\n").length;
  assert.ok(lines < MAX_GUARD_LINES, `the baseline-freeze-guard block is ${lines} lines, expected under ${MAX_GUARD_LINES}: it must hold the guard and nothing else (sc-5346)`);
  assert.ok(block.includes("node scripts/guard-baseline-freeze.mjs"), "the baseline-freeze-guard block must call scripts/guard-baseline-freeze.mjs");
  const devkit = hook.indexOf(DEVKIT_OPEN);
  assert.ok(devkit < 0 || end < devkit, "the baseline-freeze guard must run before the devkit-guards region (sc-5346)");
  return block;
}

const BLOCK_TIMEOUT_MS = 30_000;

/** Runs hook text with /bin/sh in a process group of its own, killed at the deadline and when this process dies by any
 * means (runGrouped's lifeline), so a block that never exits fails the test instead of outliving it. */
async function runGuardBlock(dir: string, env: NodeJS.ProcessEnv, block = extractGuardBlock(), timeoutMs = BLOCK_TIMEOUT_MS) {
  const r = await runGrouped(["sh", "-c", block], dir, timeoutMs, env);
  assert.ok(!r.timed_out && r.signal === null, `the hook block did not exit on its own (timed out at ${timeoutMs} ms: ${r.timed_out}, signal: ${r.signal}); it was killed. Output: ${r.output_tail}`);
  return r;
}

/** Live processes whose command line carries `marker`, a random string only this test's own processes carry. */
const withMarker = (marker: string) =>
  spawnSync("ps", ["-Ao", "pid=,command="], { encoding: "utf8" }).stdout.split("\n").filter((l) => l.includes(marker) && !l.includes("ps -Ao"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Waits up to `ms` for every marker process to be gone; returns what is left. */
async function settled(marker: string, ms: number) {
  const until = Date.now() + ms;
  while (withMarker(marker).length && Date.now() < until) await sleep(100);
  return withMarker(marker);
}
/** Cleanup when containment failed: SIGKILL what escaped (a spinning hook shell ignores SIGTERM). */
function stopEscaped(marker: string) {
  for (const l of withMarker(marker)) {
    try {
      process.kill(Number.parseInt(l, 10), "SIGKILL");
    } catch {}
  }
}
/** A shell loop that never exits, as the devkit region did under `sh -c`; the marker rides in the shell's own argv. */
const spinner = (marker: string) => `while :; do :; done # ${marker}`;

/** The hook's relative `node scripts/guard-baseline-freeze.mjs` only resolves if a repo has that file too. */
function installGuardScript(dir: string) {
  mkdirSync(join(dir, "scripts"), { recursive: true });
  cpSync(join(REPO_ROOT, "scripts", "guard-baseline-freeze.mjs"), join(dir, "scripts", "guard-baseline-freeze.mjs"));
}

await test("the real .husky/pre-commit block blocks an unreviewed baseline commit", async () => {
  const dir = stageBaselineChange(10);
  installGuardScript(dir);
  try {
    const r = await runGuardBlock(dir, { ...GIT_ENV, [HUB_URL_ENV]: HTTP, PATH: process.env.PATH });
    assert.notEqual(r.exit_code, 0, `expected the hook block to exit non-zero; got ${r.exit_code}, output: ${r.output_tail}`);
    assert.match(r.output_tail, /verify\/baseline-/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("the real .husky/pre-commit block allows a verified baseline commit", async () => {
  const dir = stageBaselineChange(11);
  installGuardScript(dir);
  try {
    const tree = git(["write-tree"], dir);
    await boardSetAs("reviewer-seat-3", "verify/baseline-e2e", `staged tree ${tree} reviewed, exit 0`);
    const r = await runGuardBlock(dir, { ...GIT_ENV, [HUB_URL_ENV]: HTTP, PATH: process.env.PATH });
    assert.equal(r.exit_code, 0, `expected the hook block to exit 0; got ${r.exit_code}, output: ${r.output_tail}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- sc-5346: the block is the guard alone, and no run of it can outlive this test ----
await test("a hook whose devkit region sits inside the guard markers is refused before anything runs", () => {
  const guard = "for __bfg in 1; do\n    node scripts/guard-baseline-freeze.mjs || exit 1\ndone\n";
  const devkit = `${DEVKIT_OPEN}\n__dk_gate() { :; }\n# <<< devkit-guards <<<\n`;
  // what `devkit upgrade` to v0.69.0 produced: the region between the guard's comment and its command
  assert.throws(() => extractGuardBlock(`#!/bin/sh\n${GUARD_OPEN}# why\n\n${devkit}\n${guard}${GUARD_CLOSE}\n`), MOVED_INSIDE);
  // the guard alone, but after the devkit gates
  assert.throws(() => extractGuardBlock(`#!/bin/sh\n${devkit}\n${GUARD_OPEN}${guard}${GUARD_CLOSE}\n`), GUARD_NOT_FIRST);
  assert.equal(extractGuardBlock(`#!/bin/sh\n${GUARD_OPEN}${guard}${GUARD_CLOSE}\n\n${devkit}`), guard);
  // a consumer that drops devkit keeps a guard-only hook: no devkit region is not a misplaced one
  assert.equal(extractGuardBlock(`#!/bin/sh\n${GUARD_OPEN}${guard}${GUARD_CLOSE}\nexit 0\n`), guard);
});

await test("a hook block that never exits is killed at the deadline and fails the test", async () => {
  const marker = `baseline-guard-spin-${randomBytes(6).toString("hex")}`;
  try {
    await assert.rejects(runGuardBlock(tmpdir(), process.env, spinner(marker), 1500), DID_NOT_EXIT);
    assert.deepEqual(await settled(marker, 3000), [], "the spinning shell outlived its deadline");
  } finally {
    stopEscaped(marker);
  }
});

await test("SIGKILL to a process running a hook block leaves no shell behind", async () => {
  const marker = `baseline-guard-orphan-${randomBytes(6).toString("hex")}`;
  const lib = JSON.stringify(join(REPO_ROOT, "scripts", "pool-mutation.ts"));
  const code = `import { runGrouped } from ${lib}; await runGrouped(["sh", "-c", ${JSON.stringify(spinner(marker))}], ${JSON.stringify(tmpdir())}, 120000, process.env);`;
  // what scripts/offline-runner.mjs does to a test at its time limit: SIGKILL to that one process, no handler runs
  const caller = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { cwd: REPO_ROOT, stdio: "ignore" });
  try {
    const until = Date.now() + 60_000;
    while (!withMarker(marker).some((l) => l.includes("sh -c")) && Date.now() < until) await sleep(100);
    assert.ok(withMarker(marker).some((l) => l.includes("sh -c")), "the shell started");
    caller.kill("SIGKILL");
    assert.deepEqual(await settled(marker, 5000), [], "a shell outlived the process that ran it");
  } finally {
    caller.kill("SIGKILL");
    stopEscaped(marker);
  }
});

await test("the pinned devkit's init/upgrade rewrite leaves the guard block whole and first", async () => {
  // The same call `devkit init` / `devkit upgrade` make: drop the devkit-guards region, re-insert it after the preamble.
  // The bare `if` the v0.69.0 upgrade split is not a fixed point of it; the loop is. Not a package export, so by file.
  const lib = join(REPO_ROOT, "node_modules", "@norvalbv", "devkit", "dist", "cli", "lib", "husky", "husky-block.mjs");
  const { extractGuardBlock: devkitBlock, replaceGuardBlock } = await import(pathToFileURL(lib).href);
  const hook = readFileSync(join(REPO_ROOT, ".husky", "pre-commit"), "utf8");
  const rewritten: string = replaceGuardBlock(hook, devkitBlock(hook));
  assert.equal(rewritten, hook, "a devkit init/upgrade would rewrite .husky/pre-commit (sc-5346)");
  extractGuardBlock(rewritten);
});

await test("the whole .husky/pre-commit, run as husky runs it (sh -e), refuses before any devkit gate", async () => {
  const dir = stageBaselineChange(12);
  installGuardScript(dir);
  try {
    const r = await runGrouped(["sh", "-e", join(REPO_ROOT, ".husky", "pre-commit")], dir, BLOCK_TIMEOUT_MS, { ...GIT_ENV, [HUB_URL_ENV]: HTTP, PATH: process.env.PATH });
    assert.equal(r.timed_out, false, `the hook did not exit on its own. Output: ${r.output_tail}`);
    assert.notEqual(r.exit_code, 0, `expected the hook to refuse; output: ${r.output_tail}`);
    assert.match(r.output_tail, VERIFY_BASELINE);
    assert.doesNotMatch(r.output_tail, DEVKIT_GATES_RAN, "a devkit gate ran before the baseline-freeze guard");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

server.kill();
exiting = true;
rmSync(dataDir, { recursive: true, force: true });
console.log("BASELINE FREEZE GUARD: OK");
