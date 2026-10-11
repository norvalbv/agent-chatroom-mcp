/** A recruit works in its recruiter's project, not in the hub's checkout. The hub gave every recruit without a cwd the
 * hub's own working directory (src/spawner.ts: req.cwd ?? defaultCwd). A hub started from the agent-chatroom-mcp
 * checkout for a Polymarket room (kit/polymarket/launch.sh starts it there) would have put a builder recruit's git
 * worktree in agent-chatroom-mcp, on a branch of the wrong repository (found in review, swarm-003601-tky5). Now: the
 * recruiter's own worktree says which project (its seat key binds it), and a launcher that starts the hub tells it
 * the run's --cwd. PORT=<free port> npx tsx scripts/recruit-home-regression.ts */
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let nextPort = Number(process.env.PORT) || 0;
const freePort = () => new Promise<number>((done) => { const s = createServer(); s.listen(nextPort ? nextPort++ : 0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => done(p)); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const git = (cwd: string, ...args: string[]) => { const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };

// a project of its own, with one launched seat's worktree in it, as src/swarm.ts makes them
const project = realpathSync(mkdtempSync(join(tmpdir(), "recruit-home-project-")));
git(project, "init", "-q");
writeFileSync(join(project, "README.md"), "lab\n");
git(project, "add", "README.md");
git(project, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
const seatTree = join(project, ".swarm-worktrees", "run-1", "seat-1");
mkdirSync(join(project, ".swarm-worktrees", "run-1"), { recursive: true });
git(project, "worktree", "add", "-q", "-b", "swarm/run-1/seat-1", seatTree);

const port = await freePort();
const logs = mkdtempSync(join(tmpdir(), "recruit-home-logs-"));
const { CHATROOM_SEAT_KEY: _k, CHATROOM_HEARTBEAT_URL: _h, CHATROOM_DATA_DIR: _d, CHATROOM_DEFAULT_CWD: _c, CHATROOM_RECRUIT_AGENT: _a, CHATROOM_RECRUIT_MODEL: _m, ...rest } = process.env;
// the hub runs from this checkout (agent-chatroom-mcp), as it does when the owner starts it there
const hub: ChildProcess = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { ...rest, PORT: String(port), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: logs }, stdio: "ignore" });
type Result = { isError?: boolean; content: { text: string }[] };
const connect = async (query: string) => {
  const c = new Client({ name: "seat", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp${query}`)));
  return async (name: string, args: Record<string, unknown>) => {
    const r = (await c.callTool({ name, arguments: args })) as Result;
    const text = r.content[0]?.text ?? "";
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text); } catch {}
    return { error: !!r.isError, text, data };
  };
};
try {
  for (let i = 0; i < 150; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await sleep(200); } }
  // a launched builder seat: its MCP URL carries its seat key and its worktree
  const seat = await connect(`?seat=k1&worktree=${encodeURIComponent(seatTree)}`);
  assert.equal((await seat("join_room", { room: "lab", name: "seat-1", topic: "t" })).error, false);
  const r = await seat("request_agent", { room: "lab", brief: "Build the scorer and commit it on your branch.", name: "builder", can_edit: true });
  assert.equal(r.error, false, r.text);
  assert.equal(r.data.cwd, project, `the recruit works in the recruiter's project, not the hub's checkout (got ${r.data.cwd})`);
  const ws = (r.data.workspaces as { worktree?: string }[] | undefined)?.[0]?.worktree ?? "";
  assert.ok(ws.startsWith(join(project, ".swarm-worktrees")), `and its worktree is in that project (got ${ws})`);

  // a cwd the recruiter names still wins
  const named = await seat("request_agent", { room: "lab", brief: "Read the hub's README and report.", name: "reader", cwd: process.cwd() });
  assert.equal(named.data.cwd, process.cwd());

  // a seat with no worktree (read-only, or joined by hand): the hub's default, as before
  const plain = await connect("");
  await plain("join_room", { room: "lab", name: "walk-in" });
  const p = await plain("request_agent", { room: "lab", brief: "Read the hub's README and report back.", name: "reader-2" });
  assert.equal(p.data.cwd, process.cwd(), "no worktree to go by: the hub's default directory");
} finally {
  if (hub.exitCode === null && hub.signalCode === null) hub.kill("SIGKILL");
}
console.log("RECRUIT HOME REGRESSION OK");
process.exit(0);
