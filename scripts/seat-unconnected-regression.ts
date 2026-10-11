/**
 * A seat still working but with no MCP session at the hub is said, once (idea/client-side-disconnects step 2). Claude
 * Code fires no hook for a chatroom call after its MCP server disconnects (the call fails "No such tool available ... has
 * disconnected"), but the seat's local tool calls keep heartbeating; in 1,383 transcripts at least 211 chatroom calls
 * failed this way and no room log shows one. So: a /heartbeat from a seat key with no live MCP transport, while the seat
 * holds a place in an open room, records seat_unconnected and one room line; a new session for the key ends the episode
 * with seat_reconnected. The case below is the common one: the hub restarted under the seat.
 * Served hubs on their own port (never 7717), stopped by pid. Run: npx tsx scripts/seat-unconnected-regression.ts
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ownHubPort } from "./lib/own-hub.js";

const PORT = await ownHubPort(Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000)));
assert.notEqual(PORT, 7717, "never the live hub");
const HTTP = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "seat-unconnected-"));
let hub: ChildProcess | undefined;
const start = async () => {
  hub = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { ...process.env, PORT: String(PORT), CHATROOM_DATA_DIR: dir, CHATROOM_INSECURE_LOCAL: "1", CHATROOM_SPAWN_DRY: "1", CHATROOM_HEALTH_MS: "0", CHATROOM_NUDGE_MS: "0", CHATROOM_UNCONNECTED_GRACE_MS: process.env.GRACE ?? "3000" }, stdio: "ignore" });
  for (let i = 0; ; i++) { try { await fetch(`${HTTP}/`); return; } catch { if (i > 300) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); } }
};
const stop = async () => { if (!hub) return; hub.kill("SIGTERM"); await new Promise((r) => hub!.once("exit", r)); hub = undefined; };
process.on("exit", () => { hub?.kill(); rmSync(dir, { recursive: true, force: true }); });
const ROOM = "unconnected-room";
const KEY = "seat-key-unconnected-1";
const seat = async (key?: string) => {
  const c = new Client({ name: "s", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp${key ? `?seat=${key}` : ""}`)));
  return c;
};
const beat = (tool = "Bash") => fetch(`${HTTP}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat_key: KEY, tool, detail: "python3 score.py" }) });
const events = () => readFileSync(join(dir, `${ROOM}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const lines = () => events().filter((e) => e.type === "message" && e.msg.kind === "system").map((e) => String(e.msg.content)).filter((c) => /MCP session/.test(c));

await start();
const a = await seat(KEY);
await a.callTool({ name: "join_room", arguments: { room: ROOM, name: "worker-1", agent: "claude" } });
const b = await seat();
await b.callTool({ name: "join_room", arguments: { room: ROOM, name: "worker-2", agent: "claude" } });
// connected: a heartbeat says nothing about connection
assert.equal((await beat()).status, 200);
assert.equal(events().filter((e) => e.type === "seat_unconnected").length, 0, "a seat with a live session is not unconnected");

// the hub restarts under the seat; the seat's process keeps working and heartbeating, its MCP client is gone
await stop();
await start();
assert.equal((await beat()).status, 200);
await beat("Read");
const un = events().filter((e) => e.type === "seat_unconnected");
assert.equal(un.length, 1, "one event per episode, not per heartbeat");
assert.deepEqual({ seat: un[0].seat, tool: un[0].tool }, { seat: "worker-1", tool: "Bash" });
// review/d4370fd9: right after a restart every seat is briefly unconnected and the hub's restart line says why, so the
// room line waits out the grace (3 s here, 60 s by default) and comes only if the seat is still unconnected after it
assert.equal(lines().length, 0, "no line inside the grace after the hub started");
await new Promise((r) => setTimeout(r, 3200));
await beat();
assert.equal(events().filter((e) => e.type === "seat_unconnected").length, 1, "still one event");
assert.match(lines()[0], /^worker-1 is working \(Bash\) but has no MCP session with this hub/);

// step 3: room_status reads the seat as disconnected, not idle or suspected_dead, for as long as the episode lasts
const live = async () => ((await (await fetch(`${HTTP}/rooms/${ROOM}`)).json()) as { participants: { name: string; liveness: { status: string; disconnected_s?: number } }[] }).participants.find((p) => p.name === "worker-1")!.liveness;
assert.equal((await live()).status, "disconnected");
assert.ok(typeof (await live()).disconnected_s === "number");
// the seat's client reconnects: the episode ends
const a2 = await seat(KEY);
await a2.callTool({ name: "room_status", arguments: { room: ROOM } });
const back = events().filter((e) => e.type === "seat_reconnected");
assert.equal(back.length, 1);
assert.equal(back[0].seat, "worker-1");
assert.ok(typeof back[0].away_s === "number" && back[0].away_s >= 0);
await beat();
assert.equal(events().filter((e) => e.type === "seat_unconnected").length, 1, "connected again: no new episode");
assert.notEqual((await live()).status, "disconnected", "back: no longer disconnected");

// a heartbeat from a key that holds no seat anywhere says nothing
await fetch(`${HTTP}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat_key: "seat-key-nobody-here", tool: "Bash" }) });
assert.equal(events().filter((e) => e.type === "seat_unconnected").length, 1);
await a2.close().catch(() => {});
await stop();
console.log("seat-unconnected-regression OK");
process.exit(0);
