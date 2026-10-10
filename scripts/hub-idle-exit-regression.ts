/** A hub the launcher started stops itself once nobody has used it for CHATROOM_IDLE_EXIT_MIN minutes; dev hubs were
 * left running after every dev room in swarm-000525-jcz8 and had to be found and killed by PID. A hub without the
 * variable (every operator hub) never exits on its own. npx tsx scripts/hub-idle-exit-regression.ts */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as env from "../src/env.js";

// PORT=<first of your range> makes the hubs take PORT, PORT+1, ... (seats on a shared machine keep to their own ports)
let nextPort = Number(process.env.PORT) || 0;
const freePort = () => new Promise<number>((done) => { const s = createServer(); s.listen(nextPort ? nextPort++ : 0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => done(p)); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hub(idleMin?: string): Promise<{ port: number; child: ChildProcess; exited: () => boolean }> {
  const port = await freePort();
  const { CHATROOM_SEAT_KEY: _k, CHATROOM_HEARTBEAT_URL: _h, CHATROOM_DATA_DIR: _d, ...rest } = process.env;
  const child = spawn("npx", ["tsx", "src/index.ts"], { env: { ...rest, PORT: String(port), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: "/tmp/hub-idle-exit-logs", ...(idleMin === undefined ? {} : { CHATROOM_IDLE_EXIT_MIN: idleMin }) }, stdio: "ignore" });
  let gone = false;
  child.on("exit", () => { gone = true; });
  for (let i = 0; i < 100 && !gone; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await sleep(200); } }
  return { port, child, exited: () => gone };
}
const waitExit = async (h: { exited: () => boolean }, ms: number) => { for (let t = 0; t < ms && !h.exited(); t += 200) await sleep(200); return h.exited(); };

// the launcher's env for a hub it starts: the rule only when it started the hub, never when it reuses one
assert.equal(typeof (env as Record<string, unknown>).ownHubEnv, "function", "env.ts exports ownHubEnv");
assert.deepEqual(env.ownHubEnv(20), { CHATROOM_IDLE_EXIT_MIN: "20" });
assert.deepEqual(env.ownHubEnv(0), {}, "0 (or --keep-hub) means never");
// the operator's default hub (7717, started when no --port is given) is the dashboard hub: it never stops itself (-6)
assert.deepEqual(env.ownHubEnv(120, 7717), {}, "the operator's hub never gets an idle exit");
assert.deepEqual(env.ownHubEnv(120, 7874), { CHATROOM_IDLE_EXIT_MIN: "120" });

// a reused hub must run this build: a seat's dev room on a leftover hub would test someone else's code (-5's attack)
assert.equal(typeof (env as Record<string, unknown>).reusedHubProblem, "function", "env.ts exports reusedHubProblem");
const mine = { root: "/w/seat-7", head: "aaaa1111" };
assert.equal(env.reusedHubProblem({ root: "/w/seat-7", head: "aaaa1111" }, mine), null, "same build: fine");
assert.match(env.reusedHubProblem({ root: "/w/seat-2", head: "aaaa1111" }, mine) ?? "", /seat-2/, "another checkout's build is named");
assert.match(env.reusedHubProblem({ root: "/w/seat-7", head: "bbbb2222" }, mine) ?? "", /bbbb2222.*aaaa1111/, "an older build of this checkout is named");
assert.match(env.reusedHubProblem(undefined, mine) ?? "", /does not report its build/, "a hub that predates the build field is unknown, not fine");

const hubs: ChildProcess[] = [];
try {
  // (a) idle: exits by itself shortly after its last request (0.05 min = 3 s)
  const a = await hub("0.05"); hubs.push(a.child);
  assert.equal(await waitExit(a, 12_000), true, "an idle hub with CHATROOM_IDLE_EXIT_MIN exits by itself");

  // (b) a request every second keeps it up past the window; once they stop, it exits
  const b = await hub("0.05"); hubs.push(b.child);
  for (let i = 0; i < 6; i++) { await fetch(`http://127.0.0.1:${b.port}/rooms`); await sleep(1000); }
  assert.equal(b.exited(), false, "requests keep it up");
  assert.equal(await waitExit(b, 12_000), true, "and it exits once they stop");

  // (c) an open long poll is use: a seat waiting 8 s on wait_for_messages holds a 3 s window open
  const c = await hub("0.05"); hubs.push(c.child);
  const client = new Client({ name: "seat", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${c.port}/mcp`)));
  const joined = JSON.parse(((await client.callTool({ name: "join_room", arguments: { room: "idle", name: "seat", topic: "t" } })) as { content: { text: string }[] }).content[0].text);
  const started = Date.now();
  await client.callTool({ name: "wait_for_messages", arguments: { room: "idle", participant_id: joined.participant_id, timeout_ms: 8000 } }).catch(() => undefined);
  assert.ok(Date.now() - started >= 7000, "the long poll ran to its timeout");
  assert.equal(c.exited(), false, "an open long poll keeps the hub up");
  await client.close().catch(() => undefined);
  assert.equal(await waitExit(c, 12_000), true);

  // the hub reports the build it was started from, which a later commit in its checkout does not change
  const info = await fetch(`http://127.0.0.1:${(await (async () => { const h = await hub(); hubs.push(h.child); return h.port; })())}/`).then((r) => r.json()) as { build?: { root?: string; head?: string } };
  assert.equal(info.build?.root, process.cwd(), "GET / names the checkout the hub was built from");
  assert.match(info.build?.head ?? "", /^[0-9a-f]{7,}$/);

  // (d) without the variable (every operator hub) it never exits on its own
  const d = await hub(); hubs.push(d.child);
  await sleep(6000);
  assert.equal(d.exited(), false, "no CHATROOM_IDLE_EXIT_MIN: never exits by itself");
} finally {
  for (const h of hubs) if (h.exitCode === null && h.signalCode === null) h.kill();
}
console.log("HUB IDLE EXIT REGRESSION OK");
process.exit(0);
