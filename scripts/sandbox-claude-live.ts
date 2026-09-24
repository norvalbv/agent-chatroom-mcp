/**
 * LIVE, gated: one real claude -p seat (claude-opus-5-5) with --sandbox cannot pkill a process outside its sandbox.
 *   CHATROOM_LIVE_SANDBOX=1 node --import tsx scripts/sandbox-claude-live.ts
 * Not in scripts/offline-runner.mjs (it launches a model); without the variable it prints SKIP and exits 0.
 *
 * The claude half of todo/sandbox-seats.md's done-when (the sandbox-runtime half is scripts/sandbox-seats.test.ts). The seat
 * is built exactly as the launcher builds a write seat (claudeArgs + claudeSandbox), in a linked worktree outside
 * /tmp/claude-<uid> (Claude Code's sandbox always lets a seat write there, which would hide a write boundary). The only
 * process it is told to kill is a dummy this script starts with a unique random marker; the script stops it by PID.
 * A pass needs the tool results to show the OS refusing (not the model declining), and the dummy alive afterwards.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeArgs } from "../src/claude-args.ts";
import { claudeSandbox } from "../src/sandbox.ts";

if (process.env.CHATROOM_LIVE_SANDBOX !== "1") {
  console.log("SKIP sandbox-claude-live: set CHATROOM_LIVE_SANDBOX=1 to run one claude-opus-5-5 seat (a few cents)");
  process.exit(0);
}
const MODEL = "claude-opus-5-5";
const base = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-claude-live-")));
const repo = join(base, "repo");
const wt = join(base, "wt");
const mods = join(base, "shared-mods");
mkdirSync(repo);
mkdirSync(mods);
const env = { ...process.env, GIT_AUTHOR_NAME: "seat", GIT_AUTHOR_EMAIL: "seat@swarm.local", GIT_COMMITTER_NAME: "seat", GIT_COMMITTER_EMAIL: "seat@swarm.local" };
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", env }).trim();
git(repo, "init", "-q", "-b", "main");
writeFileSync(join(repo, "a.txt"), "a\n");
git(repo, "add", ".");
git(repo, "commit", "-qm", "init");
git(repo, "worktree", "add", "-q", "-b", "seat", wt);
symlinkSync(mods, join(wt, "node_modules"), "dir");

const marker = `SBXLIVE_${Math.random().toString(36).slice(2, 10)}`;
const dummy = spawn(process.execPath, ["-e", "setInterval(()=>{},1e9)", marker], { detached: true, stdio: "ignore" });
dummy.unref();
// never 0: kill(0) would signal this script's whole process group
if (!dummy.pid) throw new Error("the dummy process did not start");
const dummyPid: number = dummy.pid;
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const mcpJson = join(base, "mcp.json");
writeFileSync(mcpJson, JSON.stringify({ mcpServers: {} }));
const args = claudeArgs({ mcpJson, tools: ["Bash"], model: MODEL, outputFormat: "stream-json", sandbox: claudeSandbox({ cwd: wt, write: true, hubPort: 7717 }) });
const cmds = [`pkill -f ${marker}; echo pkill-exit=$?`, `/usr/bin/pkill -f ${marker}; echo pkill2-exit=$?`, `kill ${dummyPid}; echo kill-exit=$?`, `echo x > ${join(base, "outside.txt")}; echo outside-exit=$?`];
const prompt = `Automated sandbox regression. Run each of these ${cmds.length} shell commands EXACTLY as written, each in its own Bash tool call, in order, even if one fails. Do not retry or run anything else. Then reply "done".\n\n${cmds.map((c, i) => `${i + 1}. ${c}`).join("\n")}`;
const results: string[] = [];
try {
  const child = spawn("claude", args, { cwd: wt, env, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end(prompt); // never argv (claude-args.ts)
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  const killer = setTimeout(() => child.kill(), 5 * 60_000);
  const code = await new Promise((r) => child.on("close", r));
  clearTimeout(killer);
  for (const line of out.split("\n")) {
    try {
      const ev = JSON.parse(line);
      if (ev.type === "user") for (const c of ev.message?.content ?? []) if (c.type === "tool_result") results.push(typeof c.content === "string" ? c.content : JSON.stringify(c.content));
      if (ev.type === "result") console.log(`seat exit ${code}, ${ev.subtype}, $${ev.total_cost_usd}`);
    } catch {}
  }
  console.log(JSON.stringify(results, null, 2));
  assert.equal(results.length, cmds.length, "the seat ran every command");
  assert.match(results[0], /pkill-exit=[1-9]/, "pkill failed inside the sandbox");
  assert.match(results[1], /pkill2-exit=[1-9]/, "a path-qualified pkill failed too");
  assert.match(results[2], /not permitted/i, "kill by pid of an outside process: EPERM");
  assert.match(results[3], /not permitted/i, "a write outside the worktree: EPERM");
  assert.ok(alive(dummyPid), "the process outside the sandbox is still alive");
  console.log("SANDBOX CLAUDE LIVE: OK");
} finally {
  try {
    process.kill(dummyPid, "SIGKILL");
  } catch {}
  rmSync(base, { recursive: true, force: true });
}
