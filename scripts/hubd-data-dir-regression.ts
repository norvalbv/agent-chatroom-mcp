/** A hub started by hand under the supervisor (`npm run hubd -- --port N`) keeps its rooms on disk, so the restart the
 * supervisor exists for does not wipe them. hubd passed its own environment through, and the hub persists only when
 * CHATROOM_DATA_DIR is set; the launcher sets it, a person typing the documented command does not, and the room was
 * then held in memory and lost at the first restart (found in review, swarm-003601-tky5). Default: <checkout>/data,
 * the directory the launcher already uses. PORT=<free port> npx tsx scripts/hubd-data-dir-regression.ts */
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let nextPort = Number(process.env.PORT) || 0;
const freePort = () => new Promise<number>((done) => { const s = createServer(); s.listen(nextPort ? nextPort++ : 0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => done(p)); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (ok: () => boolean | Promise<boolean>, ms: number) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (await ok()) return true; return false; };
const listener = (port: number) => Number(spawnSync("lsof", [`-ti:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.trim().split("\n")[0]) || 0;

const port = await freePort();
const room = `hubd-data-dir-${port}-${Date.now()}`;
const logs = mkdtempSync(resolve(tmpdir(), "hubd-data-"));
const dataDir = resolve(process.cwd(), "data");
const { CHATROOM_SEAT_KEY: _k, CHATROOM_HEARTBEAT_URL: _h, CHATROOM_DATA_DIR: _d, CHATROOM_LAUNCHER_TOKEN: _t, ...rest } = process.env;
let sup: ChildProcess | undefined;
try {
  // exactly the documented command, with no CHATROOM_DATA_DIR in the environment
  sup = spawn(process.execPath, ["--import", "tsx", "src/hubd.ts", "--port", String(port), "--always"], { env: { ...rest, CHATROOM_INSECURE_LOCAL: "1", CHATROOM_SPAWN_DRY: "1", CHATROOM_HUBD_LOG_DIR: logs }, stdio: "ignore" });
  assert.equal(await until(() => listener(port) > 0, 30_000), true, "the supervised hub starts");
  const c = new Client({ name: "seat", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  await c.callTool({ name: "join_room", arguments: { room, name: "a", topic: "kept across a restart" } });
  await c.close().catch(() => {});
  const first = listener(port);
  process.kill(first, "SIGKILL");
  assert.equal(await until(() => { const p = listener(port); return p > 0 && p !== first; }, 30_000), true, "the supervisor restarts the hub");
  const rooms = (await (await fetch(`http://127.0.0.1:${port}/rooms`)).json()) as { name: string }[] | { rooms?: { name: string }[] };
  const names = (Array.isArray(rooms) ? rooms : rooms.rooms ?? []).map((r) => r.name);
  assert.ok(names.includes(room), `the room survives the restart (rooms after restart: ${names.length})`);
  assert.equal(existsSync(resolve(dataDir, `${room}.jsonl`)), true, "it was written to <checkout>/data");
} finally {
  if (sup && sup.exitCode === null) { sup.kill("SIGTERM"); await until(() => sup!.exitCode !== null, 8_000); }
  const left = listener(port);
  if (left) process.kill(left, "SIGKILL");
  rmSync(resolve(dataDir, `${room}.jsonl`), { force: true });
  rmSync(resolve(dataDir, `hub-${port}.lifecycle.log`), { force: true });
}
console.log("HUBD DATA DIR REGRESSION OK");
process.exit(0);
