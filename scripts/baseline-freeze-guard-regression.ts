/**
 * Rank 3 (swarm-100622-6jdx peer-review plan): an author cannot self-freeze their own quality
 * baseline. RED on main today (no such guard exists: `guard:freeze` commits .devkit/baselines/**
 * with zero peer check — see commit 15d3717, docs/measurement-swarm-214936.md); GREEN after
 * scripts/guard-baseline-freeze.mjs + the .husky/pre-commit block that calls it.
 *
 * Drives a REAL hub (subprocess) so the "hub unreachable" path is genuinely exercised, and runs
 * the ACTUAL shell block from .husky/pre-commit (extracted by its own markers, executed with
 * /bin/sh) against a throwaway git repo, not a reimplementation of it.
 *
 * Run: npx tsx scripts/baseline-freeze-guard-regression.ts
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { evaluate, HUB_URL_ENV, OVERRIDE_ENV } from "./guard-baseline-freeze.mjs";
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
function extractGuardBlock(): string {
  const hook = readFileSync(join(REPO_ROOT, ".husky", "pre-commit"), "utf8");
  const m = /# >>> baseline-freeze-guard >>>\n([\s\S]*?)# <<< baseline-freeze-guard <<</.exec(hook);
  assert.ok(m, ".husky/pre-commit must contain a baseline-freeze-guard marker block");
  return m![1];
}

/** The hook's relative `node scripts/guard-baseline-freeze.mjs` only resolves if a repo has that file too. */
function installGuardScript(dir: string) {
  mkdirSync(join(dir, "scripts"), { recursive: true });
  cpSync(join(REPO_ROOT, "scripts", "guard-baseline-freeze.mjs"), join(dir, "scripts", "guard-baseline-freeze.mjs"));
}

await test("the real .husky/pre-commit block blocks an unreviewed baseline commit", async () => {
  const dir = stageBaselineChange(10);
  installGuardScript(dir);
  const block = extractGuardBlock();
  try {
    const r = spawnSync("sh", ["-c", block], { cwd: dir, encoding: "utf8", env: { ...GIT_ENV, [HUB_URL_ENV]: HTTP, PATH: process.env.PATH } });
    assert.notEqual(r.status, 0, `expected the hook block to exit non-zero; got ${r.status}, stderr: ${r.stderr}`);
    assert.match(r.stderr, /verify\/baseline-/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("the real .husky/pre-commit block allows a verified baseline commit", async () => {
  const dir = stageBaselineChange(11);
  installGuardScript(dir);
  const block = extractGuardBlock();
  try {
    const tree = git(["write-tree"], dir);
    await boardSetAs("reviewer-seat-3", "verify/baseline-e2e", `staged tree ${tree} reviewed, exit 0`);
    const r = spawnSync("sh", ["-c", block], { cwd: dir, encoding: "utf8", env: { ...GIT_ENV, [HUB_URL_ENV]: HTTP, PATH: process.env.PATH } });
    assert.equal(r.status, 0, `expected the hook block to exit 0; got ${r.status}, stderr: ${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

server.kill();
exiting = true;
rmSync(dataDir, { recursive: true, force: true });
console.log("BASELINE FREEZE GUARD: OK");
