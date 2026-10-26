/**
 * What recruiting write seats costs the hub and what it tells the room (decision/machine-load). Starts a private hub
 * from a build, joins a room over MCP, recruits N write recruits whose worktrees are cut from a scratch repository, and
 * reports: how long request_agent took, how late the hub answered a ping sent every 50 ms meanwhile, the room's
 * machine_stall events and its MACHINE lines. `claude` is a stub on the hub's PATH that sleeps, so no model runs.
 * On research-swarm each breakout's 3 recruits held the hub 1.8-3.8 s ("every process on this machine stalls").
 * Run: npx tsx scripts/recruit-stall-probe.ts --port <free port> [--dist dist/index.js] [--recruits 3] [--files 6000] [--wait 65]
 * Never point --repo at a checkout you work in: the worktrees are made inside it and removed afterwards.
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1]! : fallback; };
const PORT = Number(arg("port", "0"));
if (!PORT) { console.error("--port <free port> is required"); process.exit(2); }
const DIST = resolve(arg("dist", "dist/index.js"));
const N = Number(arg("recruits", "3"));
const FILES = Number(arg("files", "6000"));
const WAIT_S = Number(arg("wait", "65"));
const HTTP = `http://127.0.0.1:${PORT}`;

const work = mkdtempSync(join(tmpdir(), "recruit-stall-probe-"));
const repo = join(work, "repo");
const git = (...a: string[]) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
mkdirSync(repo);
git("init", "-q");
// a tree of FILES small files, like a project checkout (this repository's is 18,808 files, 113 MB)
for (let d = 0; d < Math.ceil(FILES / 200); d++) {
  mkdirSync(join(repo, `d${d}`));
  for (let f = 0; f < Math.min(200, FILES - d * 200); f++) writeFileSync(join(repo, `d${d}`, `f${f}.txt`), `${d}/${f} `.repeat(400));
}
git("add", "-A");
spawnSync("git", ["-C", repo, "-c", "user.name=probe", "-c", "user.email=probe@localhost", "commit", "-q", "-m", "tree"], { encoding: "utf8" });
const stub = join(work, "bin");
mkdirSync(stub);
writeFileSync(join(stub, "claude"), "#!/bin/sh\ncat >/dev/null\nsleep 20\n");
chmodSync(join(stub, "claude"), 0o755);

const data = join(work, "data");
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CHATROOM_")));
const hub = spawn(process.execPath, [DIST], { env: { ...env, PORT: String(PORT), PATH: `${stub}:${process.env.PATH}`, CHATROOM_DATA_DIR: data, CHATROOM_LOG_DIR: join(work, "logs"), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_RECRUIT_AGENT: "claude", CHATROOM_RECRUIT_MODEL: "claude-opus-5-5" }, stdio: ["ignore", "ignore", "inherit"] });
const stop = () => { try { hub.kill(); } catch {} };
process.on("exit", stop);
for (let i = 0; i < 120; i++) { try { await fetch(`${HTTP}/`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

const client = new Client({ name: "probe", version: "0.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp`)));
const call = async (tool: string, args: Record<string, unknown>) => {
  const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  if (res.isError) throw new Error(res.content[0]?.text);
  return JSON.parse(res.content[0]!.text);
};
const room = "stall-probe";
await call("join_room", { room, name: "seat-1", agent: "claude", topic: "probe: recruit write seats", expected_participants: 1 });
await new Promise((r) => setTimeout(r, 1500));

// the hub's responsiveness: a ping every 50 ms, each timed from send to answer, from before the request to well after
let pinging = true;
const pings: number[] = [];
const pinger = (async () => {
  while (pinging) {
    const t = Date.now();
    try { await fetch(`${HTTP}/`); } catch {}
    pings.push(Date.now() - t);
    await new Promise((r) => setTimeout(r, 50));
  }
})();
await new Promise((r) => setTimeout(r, 500));
const t0 = Date.now();
const reply = await call("request_agent", { room, brief: "stub recruit for a stall probe; do nothing", count: N, can_edit: true, cwd: repo, agent: "claude", model: "claude-opus-5-5" });
const requestMs = Date.now() - t0;
await new Promise((r) => setTimeout(r, 8000));
pinging = false;
await pinger;

await new Promise((r) => setTimeout(r, Math.max(0, WAIT_S * 1000 - 8000)));
const log = readFileSync(join(data, `${room}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const stalls = log.filter((e) => e.type === "machine_stall").map((e) => ({ event: e.event, cause: e.cause, drift_ms: e.drift_ms ?? e.max_drift_ms, hub_cpu: e.hub_cpu, ref_ms: e.ref_drift_ms ?? e.ref_max_drift_ms }));
const lines = log.filter((e) => e.type === "message" && e.msg.kind === "system" && /^MACHINE:/.test(e.msg.content)).map((e) => e.msg.content.slice(0, 160));
const made = log.filter((e) => e.type === "worktree").map((e) => ({ seat: e.seat, ms: e.ms, ok: e.ok, async: e.async }));
const sorted = [...pings].sort((a, b) => a - b);
console.log(JSON.stringify({
  dist: DIST, recruits: N, files: FILES, workspaces: (reply.workspaces ?? []).length,
  request_agent_ms: requestMs, hub_ping: { n: pings.length, p50: sorted[Math.floor(sorted.length / 2)], worst: sorted.at(-1) },
  worktree_events: made, machine_stall: stalls, machine_lines: lines,
}, null, 1));
await client.close().catch(() => {});
stop();
await new Promise((r) => setTimeout(r, 500));
if (existsSync(repo)) for (const l of git("worktree", "list", "--porcelain").stdout.split("\n")) if (l.startsWith("worktree ") && l.slice(9) !== repo) git("worktree", "remove", "--force", l.slice(9));
rmSync(work, { recursive: true, force: true });
process.exit(0);
