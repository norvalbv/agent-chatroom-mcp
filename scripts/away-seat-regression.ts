/**
 * Departed is not dead (swarm-181144-uxtr): after a hub restart every seat is restored inactive while its process keeps
 * working, and request_agent(replacing=) accepted any inactive seat, so the verifier "replaced" 6-astra-3 while it was
 * mid-benchmark and a duplicate recruit had to be stopped by PID. The hub could not tell the two apart: the launcher's
 * seat-key heartbeats kept arriving but the key->session binding died with the old process, so they were dropped.
 *
 * Now a participant carries a persisted hash of its seat key; a heartbeat no live connection claims is recorded on the
 * seats that key joined as, room_status shows them liveness "away", and request_agent(replacing=) refuses an away seat
 * with that evidence. A departed seat with no heartbeat since is still replaceable (the control).
 * Throwaway hub on its own port and data dir (never 7717), restarted by pid.
 * Run: npx tsx scripts/away-seat-regression.ts
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000));
assert.notEqual(PORT, 7717, "never the live hub");
const HTTP = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), "away-seat-data-"));
const logDir = mkdtempSync(join(tmpdir(), "away-seat-spawn-"));
const ROOM = "away-room";
let server: ChildProcess | undefined;

async function startHub() {
  server = spawn("npx", ["tsx", "src/index.ts"], {
    env: { ...process.env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: logDir, CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: dataDir },
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let i = 0; ; i++) {
    try { await fetch(`${HTTP}/`); return; } catch { if (i > 150) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); }
  }
}
async function stopHub() {
  const s = server!;
  const exited = new Promise((r) => s.once("exit", r));
  s.kill("SIGTERM");
  await exited;
  for (let i = 0; i < 50; i++) { try { await fetch(`${HTTP}/`); await new Promise((r) => setTimeout(r, 100)); } catch { return; } }
}
async function connect(seatKey?: string) {
  const client = new Client({ name: "away", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp${seatKey ? `?seat=${seatKey}` : ""}`)));
  return async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    if (res.isError) return { error: res.content[0]?.text ?? "" };
    try { return JSON.parse(res.content[0]?.text ?? ""); } catch { return res.content[0]?.text; }
  };
}
const beat = (seat_key: string) => fetch(`${HTTP}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat_key, tool: "Bash", detail: "npm test" }) });
const liveness = async (name: string) =>
  ((await (await fetch(`${HTTP}/rooms/${ROOM}`)).json()) as { participants: { name: string; active: boolean; liveness: { status: string } }[] })
    .participants.filter((p) => p.name === name).sort((a, b) => Number(b.active) - Number(a.active))[0]?.liveness.status;

try {
  await startHub();
  const busy = await connect("seat-busy"), gone = await connect("seat-gone"), lead = await connect("seat-lead");
  await lead("join_room", { room: ROOM, name: "lead", agent: "test", expected_participants: 3 });
  await busy("join_room", { room: ROOM, name: "busy", agent: "test" });
  await gone("join_room", { room: ROOM, name: "gone", agent: "test" });

  // the hub restarts; all three processes outlive it, but only "busy" keeps working (its launcher heartbeats)
  await stopHub();
  await startHub();
  await beat("seat-busy");
  assert.equal(await liveness("busy"), "away", "a restored seat whose process heartbeats is away, not left");
  assert.equal(await liveness("gone"), "left", "a restored seat with no heartbeat since stays left");

  const lead2 = await connect("seat-lead");
  await lead2("join_room", { room: ROOM, name: "lead", agent: "test" });
  const refused = await lead2("request_agent", { room: ROOM, brief: "take over busy's claim", replacing: "busy" });
  assert.ok(refused?.error, `replacing an away seat must be refused, got ${JSON.stringify(refused)}`);
  assert.match(refused.error, /still running: it heartbeated \d+s ago/);
  assert.equal(await liveness("busy"), "away", "the refused replacement did not mark the seat replaced");

  const ok = await lead2("request_agent", { room: ROOM, brief: "take over gone's claim", replacing: "gone" });
  assert.ok(!ok?.error, `a departed seat with no heartbeat is still replaceable: ${JSON.stringify(ok)}`);
  assert.equal(ok.spawned.length, 1);

  // the busy seat comes back on its next hub call, as itself
  const busy2 = await connect("seat-busy");
  const back = await busy2("join_room", { room: ROOM, name: "busy", agent: "test" });
  assert.ok(!back?.error, JSON.stringify(back));
  assert.equal(await liveness("busy"), "active");
  console.log("away-seat-regression: ok");
} finally {
  if (server && server.exitCode === null) server.kill();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(logDir, { recursive: true, force: true });
}
process.exit(0);
