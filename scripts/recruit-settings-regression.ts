/** A recruit runs with the settings of the run that launched its room, not the hub's (server-chair note 7, decision/recruit-settings,
 * swarm-005940-77tu-room). A launched seat's environment is the launcher's (src/swarm.ts runProc) and a recruit's was the hub's
 * (src/spawner.ts), so on a hub the run did not start (7717 here, the server's systemd hub) recruits ran at the hub's effort
 * and compaction window: hub 7717 gave recruits effort high while the launcher's seats ran xhigh. Now the launcher sends its
 * seats' settings with the room (POST /rooms/<room>/create seat_settings), break-outs inherit them through `parent`, they
 * survive a hub restart, a room with none behaves as before, and every recruit's effective settings are one recruit_spawn event.
 * A stub `claude` on PATH records the environment, argv and prompt each recruit is started with; no model is called.
 * PORT=<free port> npx tsx scripts/recruit-settings-regression.ts */
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { applySeatFlags, launcherSeatSettings, parseSeatSettings } from "../src/env.js";
import { WorktreeMaker } from "../src/spawner/worktrees.js";

let nextPort = Number(process.env.PORT) || 0;
const freePort = () => new Promise<number>((done) => { const s = createServer(); s.listen(nextPort ? nextPort++ : 0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => done(p)); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- the launcher side: what its Claude seats actually get, as the room's seat_settings ---
assert.deepEqual(
  launcherSeatSettings({ CLAUDE_CODE_EFFORT_LEVEL: "xhigh", CHATROOM_SEAT_COMPACT_WINDOW: "300000" }, { seatHooksOff: true, claudeFull: false, sandbox: false, web: false, carry: false, models: ["claude-opus-5-5"] }),
  { effort: "xhigh", compact_window: 300000, ai_gates: "off", seat_hooks: "off", claude_full: false, sandbox: false, web: false, carry: false, models: ["claude-opus-5-5"] },
);
// no effort set: the seats run at Claude Code's default, so their recruits must too (not the hub's level)
assert.equal(launcherSeatSettings({}, {}).effort, "default");
// no window set: the seats compact at the 300000 default; --claude-full / "off": Claude Code's own default
assert.equal(launcherSeatSettings({}, {}).compact_window, 300000);
assert.equal(launcherSeatSettings({ CHATROOM_SEAT_COMPACT_WINDOW: "off" }, {}).compact_window, "off");
// --claude-full sets CHATROOM_SEAT_COMPACT_WINDOW=off in the launcher (src/swarm.ts COMPACT_AT)
assert.equal(launcherSeatSettings({ CHATROOM_SEAT_COMPACT_WINDOW: "off" }, { claudeFull: true }).compact_window, "off");
// an inherited CLAUDE_CODE_AUTO_COMPACT_WINDOW passes through to the seats, so it is theirs
assert.equal(launcherSeatSettings({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: "450000" }, {}).compact_window, 450000);
assert.equal(launcherSeatSettings({ CHATROOM_SEAT_AI_GATES: "on" }, {}).ai_gates, "on");
// closed sets only: a room's settings never carry free environment
assert.throws(() => parseSeatSettings({ effort: "ultra" }), /effort/);
assert.throws(() => parseSeatSettings({ env: { PATH: "/x" } }), /unknown/);
assert.throws(() => parseSeatSettings({ compact_window: 5 }), /compact_window/);
assert.deepEqual(parseSeatSettings({ effort: "high", sandbox: true }), { effort: "high", sandbox: true });
// the launcher's --effort and --compact-at (src/swarm.ts): set in its env for its seats, refused outside their sets
{
  const env: NodeJS.ProcessEnv = {};
  assert.deepEqual(applySeatFlags(env, { effort: "xhigh", compactAt: "400000" }), { warnings: [] });
  assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL, "xhigh");
  assert.equal(launcherSeatSettings(env, {}).compact_window, 400000);
  assert.match(applySeatFlags({}, { effort: "ultra" }).error ?? "", /--effort takes one of low, medium, high, xhigh, max, auto/);
  assert.match(applySeatFlags({}, { effort: "default" }).error ?? "", /--effort/);
  assert.match(applySeatFlags({}, { compactAt: "200k" }).error ?? "", /--compact-at takes a whole number/);
  assert.match(applySeatFlags({}, { compactAt: "150000" }).warnings[0] ?? "", /Autocompact is thrashing/);
}

// --- a write recruit's worktree, made off the event loop (WorktreeMaker): the run's --seat-hooks off reaches it, with the hub's unset ---
{
  const git = (cwd: string, ...args: string[]) => spawnSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "recruit-settings-wt-")));
  assert.equal(git(repo, "init", "-q").status, 0);
  // written into the scratch repository's own config file; no `git config` is run
  appendFileSync(join(repo, ".git", "config"), "[core]\n\thooksPath = .husky/_\n");
  mkdirSync(join(repo, ".husky", "_"), { recursive: true });
  writeFileSync(join(repo, ".husky", "_", "pre-commit"), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(repo, "a.txt"), "a\n");
  git(repo, "add", "a.txt");
  assert.equal(git(repo, "commit", "-q", "-m", "base").status, 0);
  const maker = new WorktreeMaker();
  const ws = (n: string) => ({ root: repo, worktree: join(repo, ".swarm-worktrees", "r", n), branch: `swarm/r/${n}` });
  const off = await maker.make(ws("off"), undefined, undefined, true);
  assert.equal(off && maker.hooksIn.get(off)?.hooks, "off", "the run's --seat-hooks off reaches a write recruit's worktree");
  const on = await maker.make(ws("on"), undefined, undefined, false);
  assert.equal(on && maker.hooksIn.get(on)?.hooks, "copied", "a run with hooks on gets them copied, as before");
  rmSync(repo, { recursive: true, force: true });
}

// --- the hub side, end to end ---
const scratch = mkdtempSync(join(tmpdir(), "recruit-settings-"));
const bin = join(scratch, "bin");
const out = join(scratch, "out");
const data = join(scratch, "data");
mkdirSync(bin); mkdirSync(out); mkdirSync(data);
// $3 is the --mcp-config path, <logDir>/<name>.mcp.json (src/claude-args.ts), so the stub knows which recruit it is
writeFileSync(join(bin, "claude"), `#!/bin/sh
n=$(basename "$3" .mcp.json)
{ echo "EFFORT=\${CLAUDE_CODE_EFFORT_LEVEL-unset}"; echo "COMPACT=\${CLAUDE_CODE_AUTO_COMPACT_WINDOW-unset}"; echo "GUARD=\${GUARD_NO_REVIEW-unset}"; echo "ARGS=$*"; } > "$STUB_OUT/$n.env"
cat > "$STUB_OUT/$n.prompt"
echo '{"type":"result","result":"stub","usage":{}}'
`);
chmodSync(join(bin, "claude"), 0o755);

const LAUNCHER = "launcher-secret";
const { CHATROOM_SEAT_KEY: _k, CHATROOM_HEARTBEAT_URL: _h, CHATROOM_MCP_URL: _u, CHATROOM_DATA_DIR: _d, CHATROOM_DEFAULT_CWD: _c, CHATROOM_SEAT_AI_GATES: _g, CHATROOM_SEAT_HOOKS: _s, CHATROOM_CLAUDE_FULL: _f, CHATROOM_SANDBOX: _x, CHATROOM_NO_RECRUIT: _n, CLAUDE_CODE_AUTO_COMPACT_WINDOW: _w, GUARD_NO_REVIEW: _r, ...rest } = process.env;
// the hub's own environment, as on hub 7717: effort high, a 500000 window
const hubEnv = { ...rest, PATH: `${bin}:${process.env.PATH}`, STUB_OUT: out, CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: data, CHATROOM_LOG_DIR: join(scratch, "logs"), CHATROOM_LAUNCHER_TOKEN: LAUNCHER, CHATROOM_RECRUIT_AGENT: "claude", CHATROOM_RECRUIT_MODEL: "claude-opus-5-5", CLAUDE_CODE_EFFORT_LEVEL: "high", CHATROOM_SEAT_COMPACT_WINDOW: "500000" };
let port = await freePort();
let hub: ChildProcess | undefined;
const startHub = async () => {
  hub = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { ...hubEnv, PORT: String(port) }, stdio: "ignore" });
  for (let i = 0; i < 150; i++) { try { await fetch(`http://127.0.0.1:${port}/`); return; } catch { await sleep(200); } }
  throw new Error("hub did not start");
};
const stopHub = async () => { if (hub && hub.exitCode === null && hub.signalCode === null) { hub.kill("SIGKILL"); await new Promise((r) => hub!.once("exit", r)); } };
type Result = { isError?: boolean; content: { text: string }[] };
const connect = async (seat: string) => {
  const c = new Client({ name: "seat", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp?seat=${seat}`)));
  return async (name: string, args: Record<string, unknown>) => {
    const r = (await c.callTool({ name, arguments: args })) as Result;
    const text = r.content[0]?.text ?? "";
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(text); } catch {}
    return { error: !!r.isError, text, data: parsed };
  };
};
const create = (room: string, body: Record<string, unknown>) =>
  fetch(`http://127.0.0.1:${port}/rooms/${room}/create`, { method: "POST", headers: { "content-type": "application/json", "x-chatroom-launcher-token": LAUNCHER }, body: JSON.stringify({ topic: "t", ...body }) });
/** what the stub recorded for one recruit, once its process has run */
const seen = async (name: string) => {
  for (let i = 0; i < 100 && !existsSync(join(out, `${name}.env`)); i++) await sleep(100);
  const env = Object.fromEntries(readFileSync(join(out, `${name}.env`), "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  for (let i = 0; i < 50 && !existsSync(join(out, `${name}.prompt`)); i++) await sleep(100);
  return { ...env, prompt: readFileSync(join(out, `${name}.prompt`), "utf8") } as Record<string, string>;
};
const events = (room: string) => readFileSync(join(data, `${room}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, any>).filter((e) => e.type === "recruit_spawn");
const recruit = async (call: Awaited<ReturnType<typeof connect>>, args: Record<string, unknown>) => {
  const r = await call("request_agent", { brief: "Read the README and report back what it says.", ...args });
  assert.equal(r.error, false, r.text);
  return r;
};

const RUN = { effort: "xhigh", compact_window: 300000, ai_gates: "off", seat_hooks: "on", claude_full: false, sandbox: false, web: false, carry: false, models: ["claude-opus-5-5"] };
try {
  await startHub();
  const made = await create("run-room", { seat_settings: RUN });
  assert.equal(made.status, 201, await made.clone().text());
  const reported = ((await made.json()) as { seat_settings?: unknown }).seat_settings;
  assert.equal((await create("plain-room", {})).status, 201);

  const a = await connect("ka");
  assert.equal((await a("join_room", { room: "run-room", name: "seat-1" })).error, false);

  // 1. a recruit of the run's room: the run's effort and window, not the hub's; --no-web and --no-carry reach it too
  await recruit(a, { room: "run-room", name: "r-run" });
  const r1 = await seen("r-run");
  assert.equal(r1.EFFORT, "xhigh", `recruit effort follows the run, not the hub's high (got ${r1.EFFORT})`);
  assert.equal(r1.COMPACT, "300000", `recruit compacts at the run's window, not the hub's 500000 (got ${r1.COMPACT})`);
  assert.ok(!/WebSearch|WebFetch/.test(r1.ARGS), `the run's seats have no web tools, so neither does its recruit: ${r1.ARGS}`);
  assert.match(r1.ARGS, /--model claude-opus-5-5/);
  assert.ok(!r1.prompt.includes("SETTLED AXES"), "the run's seats start without the settled axes (--no-carry), so does its recruit");
  assert.deepEqual(reported, RUN, "the room reports the run's seat settings");
  assert.equal((await create("bad-room", { seat_settings: { effort: "ultra" } })).status, 400, "a setting outside the closed sets is refused");

  // 2. a break-out opened from the run's room inherits through parent (join_room parent=, and request_agent new_room=)
  assert.equal((await a("join_room", { room: "run-room-bk1", name: "seat-1", parent: "run-room" })).error, false);
  await recruit(a, { room: "run-room-bk1", name: "r-bk" });
  assert.equal((await seen("r-bk")).EFFORT, "xhigh", "a break-out's recruit inherits the parent room's run settings");
  await recruit(a, { room: "run-room", name: "r-new", new_room: "run-room-bk2", count: 1 });
  assert.equal((await seen("r-new")).EFFORT, "xhigh", "a recruit spawned into a new break-out inherits too");

  // 2b. a room of the same run that a seat's join created (a group room the launcher did not pre-create): the run's settings
  assert.equal((await create("swarm-010101-abcd-leads", { seat_settings: RUN })).status, 201);
  assert.equal((await a("join_room", { room: "swarm-010101-abcd-speed", name: "seat-1" })).error, false);
  await recruit(a, { room: "swarm-010101-abcd-speed", name: "r-group" });
  assert.equal((await seen("r-group")).EFFORT, "xhigh", "a room of the same run inherits the run's settings");

  // 3. a room no launcher configured: exactly as before, the hub's own environment
  const b = await connect("kb");
  await b("join_room", { room: "plain-room", name: "walk-in" });
  await recruit(b, { room: "plain-room", name: "r-plain" });
  const r3 = await seen("r-plain");
  assert.equal(r3.EFFORT, "high");
  assert.equal(r3.COMPACT, "500000");
  assert.match(r3.ARGS, /WebSearch/);
  assert.ok(r3.prompt.includes("SETTLED AXES"), "a room with no run settings carries the settled axes as before");

  // 4. telemetry: one recruit_spawn event per recruit, with each setting's value and where it came from
  const [ev] = events("run-room").filter((e) => e.name === "r-run");
  assert.ok(ev, "a recruit_spawn event for r-run");
  assert.equal(ev.requested_by, "seat-1");
  assert.equal(ev.kind, "in-room");
  assert.equal(ev.agent, "claude");
  assert.equal(ev.model, "claude-opus-5-5");
  assert.equal(ev.effort, "xhigh");
  assert.equal(ev.compact_window, 300000);
  assert.equal(ev.web, false);
  assert.equal(ev.carry, false);
  assert.equal(ev.source.effort, "run");
  assert.deepEqual(ev.run_models, ["claude-opus-5-5"]);
  const [plain] = events("plain-room");
  assert.equal(plain.effort, "high");
  assert.equal(plain.source.effort, "hub");
  assert.equal(plain.compact_window, 500000);
  assert.equal(plain.source.compact_window, "hub");
  assert.equal(events("run-room-bk2").find((e) => e.name === "r-new")?.kind, "breakout");
  const listed = await a("list_agents", { room: "run-room" });
  assert.match(listed.text, /"effort":"xhigh"/, "list_agents shows a recruit's effective settings");

  // 5. after a hub restart the room still carries the run's settings (replayed from its log)
  await stopHub();
  await startHub();
  const a2 = await connect("ka");
  await a2("join_room", { room: "run-room", name: "seat-1" });
  await recruit(a2, { room: "run-room", name: "r-after" });
  assert.equal((await seen("r-after")).EFFORT, "xhigh", "the run's settings survive a hub restart");

  // 6. effort "default": the run's seats had no level, so the recruit gets none either (Claude Code's own default), not the hub's
  await create("default-room", { seat_settings: { effort: "default" } });
  const c = await connect("kc");
  await c("join_room", { room: "default-room", name: "seat-d" });
  await recruit(c, { room: "default-room", name: "r-default" });
  assert.equal((await seen("r-default")).EFFORT, "unset");
} finally {
  await stopHub();
}
console.log("RECRUIT SETTINGS REGRESSION OK");
process.exit(0);
