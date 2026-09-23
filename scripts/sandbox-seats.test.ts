/**
 * --sandbox for seats (src/sandbox.ts): node --import tsx scripts/sandbox-seats.test.ts
 *
 * Sources: docs/reuse-survey-2026-09-23.md ("OS isolation for claude seats", "OS isolation for OpenRouter seats", and the
 * skeptic's missed risks: node_modules symlink writes, per-command sandbox scope); todo/sandbox-seats.md, whose done-when
 * is "a regression test shows a sandboxed seat's pkill cannot kill a process outside it".
 *
 * The OpenRouter path is tested for real here with no model: the seat's own run_command, wrapped by
 * @anthropic-ai/sandbox-runtime (macOS Seatbelt). `/usr/bin/pkill -f <marker>` is used because the LETHAL regex does not
 * catch a path-qualified pkill, so only the OS boundary stands between it and a dummy process outside the sandbox; the
 * control case runs the same command unsandboxed and shows it does kill, so this test would catch a regression. Only
 * dummies this test starts, each with a unique random marker, are ever targeted. The claude path needs a real seat:
 * scripts/sandbox-claude-live.ts (gated, not in the offline suite).
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { claudeArgs } from "../src/claude-args.ts";
import { claudeSandbox, hubPortOf, nodeModulesCaches, srtSeatConfig } from "../src/sandbox.ts";
import { localTools, seatSandbox } from "../src/seat.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const PKILL_FAILED = /pkill-exit=[1-9]/;
const EPERM = /Operation not permitted/;
const EPERM_ANY = /EPERM|not permitted/i;
const PID = /pid=(\d+)/;
const SAME_OK = /same-exit=0/;
const COMMITTED = /committed/;
const CACHED = /cached/;
const REFUSED_UNSANDBOXED = /REFUSED --sandbox: .*refusing to run unsandboxed/;
const macOnly = process.platform === "darwin" ? {} : { skip: "sandbox-runtime's Seatbelt path is macOS-only" };
/** Every temp directory this file creates, removed when it ends. */
const made: string[] = [];
const tempDir = (prefix: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
};
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

/** A repo with a linked worktree (a seat's shape: .git outside the cwd) and node_modules linked from outside it. */
function fixture() {
  const base = tempDir("sandbox-seats-");
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
  return { base, repo, wt, mods, git, commonDir: realpathSync(join(repo, ".git")) };
}
const marker = () => `SBXSEAT_${Math.random().toString(36).slice(2, 10)}`;
/** A process outside any sandbox whose argv carries `tag`; the only kind of process this test ever signals. */
function dummy(tag: string) {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1e9)", tag], { detached: true, stdio: "ignore" });
  child.unref();
  if (child.pid === undefined) throw new Error("dummy did not start");
  return child.pid;
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const stop = (...pids: number[]) => { for (const p of pids) try { process.kill(p, "SIGKILL"); } catch {} };
const settle = () => new Promise((r) => setTimeout(r, 300));

// ---------- the settings (pure) ----------
test("claudeSandbox: strict, fail-closed, npm/GitHub/hub allowlist, local binding; a read-only seat's cwd is denied", () => {
  const f = fixture();
  const ro = claudeSandbox({ cwd: f.wt, write: false, hubPort: 7717 });
  assert.equal(ro.enabled, true);
  assert.equal(ro.allowUnsandboxedCommands, false);
  assert.equal(ro.failIfUnavailable, true);
  assert.equal(ro.network.allowLocalBinding, true);
  for (const d of ["registry.npmjs.org", "github.com", "localhost:7717", "127.0.0.1:7717"]) assert.ok(ro.network.allowedDomains.includes(d), d);
  assert.deepEqual(ro.filesystem.denyWrite, [f.wt]);
  const rw = claudeSandbox({ cwd: f.wt, write: true, hubPort: 7717 });
  assert.equal(rw.filesystem.denyWrite, undefined, "a write seat keeps its worktree");
  assert.deepEqual(rw.filesystem.allowWrite, [join(f.mods, ".cache"), join(f.mods, ".vite")], "only the shared node_modules' cache dirs are opened");
  assert.equal(hubPortOf("http://127.0.0.1:43123/mcp?seat=x"), 43123);
});

test("nodeModulesCaches: nothing for a real node_modules or none at all", () => {
  const dir = tempDir("sandbox-mods-");
  assert.deepEqual(nodeModulesCaches(dir), []);
  mkdirSync(join(dir, "node_modules"));
  assert.deepEqual(nodeModulesCaches(dir), []);
});

test("srtSeatConfig: a worktree seat may write its worktree and the shared .git, never its config or hooks; read-only writes nothing", () => {
  const f = fixture();
  const rw = srtSeatConfig({ cwd: f.wt, write: true, hubPort: 7717 });
  assert.deepEqual(rw.filesystem.allowWrite, [f.wt, f.commonDir, join(f.mods, ".cache"), join(f.mods, ".vite")]);
  assert.deepEqual(rw.filesystem.denyWrite, [join(f.commonDir, "config"), join(f.commonDir, "hooks")]);
  assert.equal(rw.network.allowLocalBinding, true);
  assert.deepEqual(srtSeatConfig({ cwd: f.wt, write: false }).filesystem.allowWrite, []);
});

test("claudeArgs: no sandbox unless asked; merged into --settings when asked, lean or --claude-full", () => {
  const settingsOf = (args: string[]) => JSON.parse(args[args.indexOf("--settings") + 1]);
  assert.equal(settingsOf(claudeArgs({ mcpJson: "/m.json", tools: ["Bash"] })).sandbox, undefined);
  const sandbox = claudeSandbox({ cwd: "/fixture", write: false, hubPort: 7717 });
  const lean = settingsOf(claudeArgs({ mcpJson: "/m.json", tools: ["Bash"], sandbox, settings: JSON.stringify({ hooks: { PreToolUse: [] } }) }));
  assert.deepEqual(lean.sandbox, sandbox);
  assert.equal(lean.autoMemoryEnabled, false, "lean additions unchanged");
  assert.ok(lean.hooks, "the heartbeat hook is kept");
  const full = settingsOf(claudeArgs({ mcpJson: "/m.json", tools: ["Bash"], full: true, sandbox }));
  assert.deepEqual(full.sandbox, sandbox);
  assert.ok(!("autoMemoryEnabled" in full), "--claude-full still leaves memory alone");
});

// ---------- the OpenRouter seat's run_command under sandbox-runtime (real, no model) ----------
const runCommand = (tools: ReturnType<typeof localTools>) => {
  const t = tools.find((x) => x.def.function.name === "run_command");
  if (!t) throw new Error("no run_command");
  return (command: string) => Promise.resolve(t.run({ command }));
};

test("a sandboxed seat's pkill cannot kill a process outside it; the same command unsandboxed does", macOnly, async () => {
  const f = fixture();
  const here = process.cwd();
  const inside = marker();
  const outside = dummy(inside);
  const control = marker();
  const controlPid = dummy(control);
  const sandbox = await seatSandbox(f.wt, true, 7717);
  try {
    const run = runCommand(localTools(f.wt, true, true, (s) => s, sandbox));
    const out = await run(`/usr/bin/pkill -f ${inside}; echo pkill-exit=$?`);
    assert.ok(!out.startsWith("Refused"), `the regex does not catch a path-qualified pkill, so this reaches the OS: ${out}`);
    assert.match(out, PKILL_FAILED, `pkill fails inside the sandbox: ${out}`);
    await settle();
    assert.ok(alive(outside), "the process outside the sandbox survived the seat's pkill");
    const kill = await run(`kill ${outside}; echo kill-exit=$?`);
    assert.match(kill, EPERM, `kill by pid of an outside process is refused by the OS: ${kill}`);
    assert.ok(alive(outside), "and it is still alive");
    // control: the very same command with no sandbox kills its dummy, so the assertions above can fail
    const bare = runCommand(localTools(f.wt, true, true, (s) => s));
    await bare(`/usr/bin/pkill -f ${control}; echo pkill-exit=$?`);
    await settle();
    assert.ok(!alive(controlPid), "unsandboxed, the same pkill kills its target (the test detects the failure mode)");
  } finally {
    stop(outside, controlPid);
    await sandbox.reset();
    process.chdir(here);
  }
});

test("each command is its own sandbox: a background process cannot be stopped from a later command, only from the same one", macOnly, async () => {
  const f = fixture();
  const here = process.cwd();
  const tag = marker();
  const sandbox = await seatSandbox(f.wt, true, 7717);
  let bg = 0;
  try {
    const run = runCommand(localTools(f.wt, true, true, (s) => s, sandbox));
    const started = await run(`nohup ${process.execPath} -e "setInterval(()=>{},1e9)" ${tag} >/dev/null 2>&1 & echo pid=$!`);
    bg = Number(PID.exec(started)?.[1]);
    assert.ok(bg > 0 && alive(bg), `started in one command: ${started}`);
    const later = await run(`kill ${bg}; echo kill-exit=$?`);
    assert.match(later, EPERM, `a later command cannot signal it: ${later}`);
    assert.ok(alive(bg));
    // the form devHubRule(cwd, true) tells seats to use: start and stop in one command
    const same = await run(`nohup ${process.execPath} -e "setInterval(()=>{},1e9)" ${tag}_same >/dev/null 2>&1 & H=$!; sleep 0.3; kill $H; echo same-exit=$?`);
    assert.match(same, SAME_OK, same);
  } finally {
    if (bg) stop(bg);
    await sandbox.reset();
    process.chdir(here);
  }
});

test("a sandboxed worktree seat commits, cannot write the shared .git config, and writes only the cache dirs of the linked node_modules", macOnly, async () => {
  const f = fixture();
  const here = process.cwd();
  const configBefore = readFileSync(join(f.commonDir, "config"), "utf8");
  const sandbox = await seatSandbox(f.wt, true, 7717);
  try {
    const run = runCommand(localTools(f.wt, true, true, (s) => s, sandbox));
    assert.match(await run("echo b > b.txt && git add b.txt && git -c user.name=seat -c user.email=seat@swarm.local commit -qm seat && echo committed"), COMMITTED);
    assert.equal(f.git(f.wt, "log", "-1", "--format=%s"), "seat");
    assert.match(await run(`echo '[x]' >> ${join(f.commonDir, "config")}; echo exit=$?`), EPERM);
    assert.equal(readFileSync(join(f.commonDir, "config"), "utf8"), configBefore, ".git/config unchanged");
    assert.match(await run("echo x > node_modules/installed.txt; echo exit=$?"), EPERM);
    assert.ok(!existsSync(join(f.mods, "installed.txt")), "the shared node_modules is not writable");
    assert.match(await run("mkdir -p node_modules/.cache/tool && echo cached"), CACHED);
    assert.ok(existsSync(join(f.mods, ".cache", "tool")), "its .cache is");
  } finally {
    await sandbox.reset();
    process.chdir(here);
  }
});

test("a read-only sandboxed seat cannot write even with a command the MUTATING regex misses", macOnly, async () => {
  const f = fixture();
  const here = process.cwd();
  const sandbox = await seatSandbox(f.wt, false, 7717);
  try {
    const run = runCommand(localTools(f.wt, false, true, (s) => s, sandbox));
    const out = await run(`${process.execPath} -e "require('fs').writeFileSync('ro.txt','x')"; echo exit=$?`);
    assert.ok(!out.includes("Refused"), `the regex lets it through: ${out}`);
    assert.match(out, EPERM_ANY, out);
    assert.ok(!existsSync(join(f.wt, "ro.txt")));
  } finally {
    await sandbox.reset();
    process.chdir(here);
  }
});

test("a seat that asked for a sandbox and cannot get one refuses to start (macOS does not nest Seatbelt sandboxes)", macOnly, () => {
  const f = fixture();
  const script = `import(${JSON.stringify(join(repoRoot, "src", "seat.ts"))}).then((m) => m.seatSandbox(${JSON.stringify(f.wt)}, true)).then(() => console.log("STARTED"), (e) => console.log("REFUSED " + e.message))`;
  const r = spawnSync("sandbox-exec", ["-p", "(version 1)(allow default)", process.execPath, "--import", "tsx", "-e", script], { cwd: repoRoot, encoding: "utf8", timeout: 60_000 });
  assert.match(r.stdout, REFUSED_UNSANDBOXED, `${r.stdout}\n${r.stderr}`);
});
