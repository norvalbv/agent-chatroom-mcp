/**
 * A second hub on a taken port writes nothing into the rooms the first one serves (pack item 12 B6 neighbour, found by
 * backlog-a in decision/backlog-a, reproduced by claude-opus-5-5-1). A hub started on a port another hub holds, with
 * the same data directory, replayed every room, ran the boot sweep and announced a restart BEFORE it died at listen:
 * it appended a hub_restart event and "The hub restarted at ..., down for about 7 s" to the record of a room the first
 * hub was still serving (and the sweep would have marked any seat idle 10+ minutes as left). Telemetry that counts
 * restarts, and the electorate after a real restart, read those records. Now a hub that finds the pid file held by a
 * running hub that answers on the port stops before it loads a room, says why, and leaves the pid and alive files alone.
 * A stale pid file whose pid is some other process, with the port free, still starts normally.
 * Run: PORT=<free port> npx tsx scripts/second-hub-regression.ts (needs npm run build)
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = Number(process.env.PORT ?? 7816), DIR = `/tmp/second-hub-${PORT}`, room = "live-room";
rmSync(DIR, { recursive: true, force: true });
const env = { ...process.env, PORT: String(PORT), CHATROOM_DATA_DIR: DIR, CHATROOM_SPAWN_DRY: "1", CHATROOM_INSECURE_LOCAL: "1" };
const up = async () => { for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/rooms`)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); } throw new Error("hub did not start"); };

// 1. a live hub with a seat in a room
const first = spawn(process.execPath, ["dist/index.js"], { env, stdio: "ignore" });
let code = 1;
try {
  await up();
  const c = new Client({ name: "s", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
  await c.callTool({ name: "join_room", arguments: { room, name: "seat-1", agent: "claude" } });
  const log = () => readFileSync(`${DIR}/${room}.jsonl`, "utf8").split("\n").filter(Boolean);
  const before = log().length;
  const pidBefore = readFileSync(`${DIR}/hub-${PORT}.pid`, "utf8");
  const aliveBefore = readFileSync(`${DIR}/hub-${PORT}.alive`, "utf8");

  // 2. a second hub on the same port and data directory
  const second = spawnSync(process.execPath, ["dist/index.js"], { env, encoding: "utf8", timeout: 30_000 });
  const added = log().slice(before).map((l) => JSON.parse(l));
  console.log(`second hub exit ${second.status}; added to the live room's log: ${added.map((e) => e.type).join(", ") || "nothing"}`);
  assert.equal(added.length, 0, "the second hub writes nothing into a room the first one serves");
  assert.match(String(second.stderr), /already serves port|is running and answers/, "it says why it stopped");
  assert.equal(readFileSync(`${DIR}/hub-${PORT}.pid`, "utf8"), pidBefore, "the pid file stays the first hub's");
  assert.equal(readFileSync(`${DIR}/hub-${PORT}.alive`, "utf8"), aliveBefore, "and so does the alive file");
  const lc = readFileSync(`${DIR}/hub-${PORT}.lifecycle.log`, "utf8");
  assert.match(lc, /not loading any room/, "the lifecycle log records the refusal");
  const st = (await (await fetch(`http://127.0.0.1:${PORT}/rooms/${room}`)).json()) as { participants: { name: string; active: boolean }[] };
  assert.deepEqual(st.participants.map((p) => [p.name, p.active]), [["seat-1", true]], "the live hub is untouched");
  first.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 800));

  // 3. a stale pid file naming a running process that is not a hub, with the port free: the hub starts
  const dir2 = `${DIR}-stale`; rmSync(dir2, { recursive: true, force: true }); mkdirSync(dir2, { recursive: true });
  writeFileSync(`${dir2}/hub-${PORT}.pid`, `${process.pid}\n`); // this test's own pid: running, but not a hub
  const third = spawn(process.execPath, ["dist/index.js"], { env: { ...env, CHATROOM_DATA_DIR: dir2 }, stdio: "ignore" });
  try { await up(); console.log("stale pid file, free port: the hub started"); } finally { third.kill("SIGTERM"); }
  console.log("second-hub-regression OK"); code = 0;
} catch (e) { console.error(String(e).slice(0, 600)); } finally { first.kill("SIGTERM"); }
await new Promise((r) => setTimeout(r, 300));
process.exit(code);
