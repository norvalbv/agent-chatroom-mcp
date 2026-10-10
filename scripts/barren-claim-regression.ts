/**
 * Claims without findings hold the first proposal once (swarm-000525-jcz8, research-depth R3).
 * In 38 of 154 past rooms the first proposal opened while a seat still in the room owned a claim/* and had put nothing
 * else on the board, and 33 of those 53 seats posted findings later: the room proposed before the area reported
 * (scripts/barren-claims-measure.py). Now the first propose in such a room is refused once, naming the claims, and the
 * hub asks their owners in the room. The second propose goes through whatever the board looks like, so it cannot hold
 * a room; the proposer's own claim never counts; a room where every claim has findings is not touched.
 * Run: npx tsx scripts/barren-claim-regression.ts (PORT= to pin the throwaway hub's port)
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000));
assert.notEqual(PORT, 7717, "never the live hub");
const HTTP = `http://127.0.0.1:${PORT}`;
const server = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: "/tmp/chatroom-barren-claim-spawn", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: "" }, stdio: ["ignore", "ignore", "inherit"] });
process.on("exit", () => server.kill());
for (let i = 0; ; i++) {
  try { await fetch(`${HTTP}/`); break; } catch { if (i > 100) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); }
}

async function seat(room: string, name: string, first = false) {
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp`)));
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: { room, ...args } })) as { isError?: boolean; content: { text: string }[] };
    if (res.isError) throw new Error(res.content[0]?.text);
    try { return JSON.parse(res.content[0]?.text ?? ""); } catch { return res.content[0]?.text; }
  };
  await call("join_room", { name, agent: "claude", ...(first ? { expected_participants: 0, require_challenge: false } : {}) });
  return call;
}
const messages = async (room: string) => (await (await fetch(`${HTTP}/rooms/${room}/messages`)).json()) as { kind: string; content: string }[];
const state = async (room: string) => ((await (await fetch(`${HTTP}/rooms/${room}`)).json()) as { state: string; proposals: unknown[] });

// 1. A seat claimed an area and reported nothing; another seat proposes. Refused once, naming the claim; the owner is asked.
const a = await seat("barren", "proposer", true);
const b = await seat("barren", "quiet");
const c = await seat("barren", "done");
await a("board_set", { key: "claim/mine", text: '{"owner":"proposer","area":"mine"}' });
await b("board_set", { key: "claim/sources", text: '{"owner":"quiet","area":"sources"}' });
await c("board_set", { key: "claim/code", text: '{"owner":"done","area":"code"}' });
await c("board_set", { key: "evidence/code", text: "read propose(); four refusals" });
await assert.rejects(a("propose", { text: "We have enough to conclude." }), (e: Error) => {
  assert.match(e.message, /CLAIMS WITHOUT FINDINGS: claim\/sources \(quiet\)\./);
  assert.doesNotMatch(e.message, /claim\/code|claim\/mine/, "a claim with findings, and the proposer's own, are not named");
  assert.match(e.message, /once per room/);
  return true;
});
assert.equal((await state("barren")).proposals.length, 0);
const asked = (await messages("barren")).filter((m) => m.kind === "system" && m.content.includes("@quiet") && m.content.includes("claim/sources"));
assert.equal(asked.length, 1, "the owner is asked in the room, once");
assert.match((await b("wait_for_messages", { timeout_ms: 0 })).messages.join("\n"), /your claim has no findings on the board \(claim\/sources \(quiet\)\)/);

// 2. It is given once: the second propose goes through with the board unchanged, so the gate cannot hold a room.
const pr = await a("propose", { text: "We have enough to conclude." });
assert.ok(pr.id);
assert.equal((await messages("barren")).filter((m) => m.content.includes("is ready to propose")).length, 1);

// 3. A room where every claim has findings beside it, or was cleared, proposes at the first try.
const d = await seat("reported", "proposer", true);
const e = await seat("reported", "worker");
const f = await seat("reported", "changed-mind");
await e("board_set", { key: "claim/sources", text: '{"owner":"worker","area":"sources"}' });
await e("board_set", { key: "findings/sources", text: "three papers, one refutes the premise" });
await f("board_set", { key: "claim/later", text: '{"owner":"changed-mind","area":"later"}' });
await f("board_set", { key: "claim/later", text: "" });
assert.ok((await d("propose", { text: "Everyone who claimed has reported." })).id);

// 4. A claim whose owner has left the room holds nothing.
const g = await seat("left", "proposer", true);
const h = await seat("left", "gone");
const i = await seat("left", "stays");
await h("board_set", { key: "claim/abandoned", text: '{"owner":"gone","area":"abandoned"}' });
await h("leave_room", { reason: "handing off; nothing found" }).catch(() => h("leave_room", { reason: "handing off; nothing found" }));
await i("room_status");
assert.ok((await g("propose", { text: "The departed seat's claim does not hold us." })).id);

console.log("BARREN CLAIM OK");
process.exit(0);
