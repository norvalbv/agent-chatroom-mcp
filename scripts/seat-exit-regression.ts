/**
 * Dead, not "connected" (chair #640, swarm-202803-dpij): a killed CLI never sends an MCP DELETE, so the hub counted its
 * session as connected for SESSION_IDLE_MS (30 min) and replace_participant refused the dead seat as "alive inside a long
 * command" (swarm-130854-nmek: six refusals for seats the launcher had killed). Now the owning launcher posts an exit
 * receipt on child close (POST /heartbeat {seat_key, exited:true}); the hub closes every session that seat key opened and
 * the seat leaves with "seat process exited", so a successor can be registered at once.
 * Checks: the receipt makes the dead seat replaceable; a wrong key evicts nobody; a repeat receipt is a no-op; a seat with
 * no receipt keeps the conservative refusal. Throwaway hub on its own port (never 7717), dry spawns.
 * Run: npx tsx scripts/seat-exit-regression.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000));
assert.notEqual(PORT, 7717, "never the live hub");
const HTTP = `http://127.0.0.1:${PORT}`;
const ROOM = "seat-exit-room";
const server = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: "/tmp/chatroom-seat-exit-spawn", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: "" }, stdio: ["ignore", "ignore", "inherit"] });
process.on("exit", () => server.kill());
for (let i = 0; ; i++) {
  try { await fetch(`${HTTP}/`); break; } catch { if (i > 150) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); }
}

async function connect(seatKey: string) {
  const client = new Client({ name: seatKey, version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp?seat=${seatKey}`)));
  return async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    if (res.isError) return { error: res.content[0]?.text ?? "" };
    try { return JSON.parse(res.content[0]?.text ?? ""); } catch { return res.content[0]?.text; }
  };
}
const receipt = async (seat_key: string) =>
  (await (await fetch(`${HTTP}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat_key, exited: true, detail: "exit 143" }) })).json()) as { closed?: number };
const seat = async (name: string) =>
  ((await (await fetch(`${HTTP}/rooms/${ROOM}`)).json()) as { participants: { name: string; active: boolean; left_reason: string | null; liveness: { status: string } }[] })
    .participants.filter((p) => p.name === name).sort((a, b) => Number(b.active) - Number(a.active))[0];

// "dead" and "silent" are both killed CLIs: their clients just stop, no DELETE. Only dead's launcher sends a receipt.
const lead = await connect("key-lead"), dead = await connect("key-dead"), silent = await connect("key-silent");
await lead("join_room", { room: ROOM, name: "lead", agent: "test", expected_participants: 3 });
await dead("join_room", { room: ROOM, name: "dead", agent: "test" });
await silent("join_room", { room: ROOM, name: "silent", agent: "test" });
await dead("board_set", { room: ROOM, key: "claim/part-a", text: JSON.stringify({ owner: "dead" }) });

assert.equal((await receipt("key-nobody")).closed, 0, "an unknown key closes nothing");
assert.equal((await seat("dead")).active, true, "a wrong key evicts nobody");

assert.equal((await receipt("key-dead")).closed, 1, "the receipt closes the session that key opened");
const gone = await seat("dead");
assert.equal(gone.active, false);
assert.match(gone.left_reason ?? "", /seat process exited \(exit 143, launcher receipt\)/);
assert.equal(gone.liveness.status, "left", "an exited seat is not away");
assert.equal((await receipt("key-dead")).closed, 0, "a repeat receipt is a no-op");

const ok = await lead("replace_participant", { room: ROOM, target: "dead", reason: "its launcher reported the process exited" });
assert.ok(!ok?.error, `a seat whose process exited is replaceable at once: ${JSON.stringify(ok)}`);
assert.equal(ok.spawned.length, 1);

// no receipt: a just-silent seat is still protected, as before
const kept = await lead("replace_participant", { room: ROOM, target: "silent", reason: "quiet" });
assert.ok(kept?.error, "a silent seat with no receipt is not replaceable by a peer");
assert.equal((await seat("silent")).active, true);
console.log("seat-exit-regression: ok");
process.exit(0);
