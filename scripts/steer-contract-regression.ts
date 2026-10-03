/**
 * Steering contract (swarm-181144-uxtr, claim/steer-contract): an @-mention reaches a seat that is busy mid-turn
 * without the seat calling wait_for_messages or read_messages.
 * - POST /heartbeat {seat_key} (and /rooms/:room/heartbeat {participant_id}) answer with `pending`: authored asks
 *   addressed to that seat and not yet delivered. A PEEK: repeated peeks return the same asks; nothing is consumed.
 * - POST /steer/ack {seat_key, ids} (or /rooms/:room/steer/ack {participant_id, ids}) after the consumer injected
 *   them: they count as delivered, so the next wait does not re-send their bodies and the next peek is empty.
 * - peek:true skips recording a step (a PostToolUse hook after the PreToolUse beat).
 * - Fallback for every seat kind: any other hub tool result carries pending asks as addressed_to_you_meanwhile, and
 *   counts as their delivery. A reply still settles the ask exactly as before (no new debt rules).
 * Throwaway hub on its own port (never 7717), stopped by pid.
 * Run: npx tsx scripts/steer-contract-regression.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { seatBeat } from "../src/env.js";

const PORT = Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000));
assert.notEqual(PORT, 7717, "never the live hub");
const HTTP = `http://127.0.0.1:${PORT}`;
const server = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: "/tmp/chatroom-steer-spawn", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: "" }, stdio: ["ignore", "ignore", "inherit"] });
process.on("exit", () => server.kill());
for (let i = 0; ; i++) {
  try { await fetch(`${HTTP}/`); break; } catch { if (i > 100) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); }
}

async function connect(url: string) {
  const client = new Client({ name: "steer", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    if (res.isError) throw new Error(`${tool}: ${res.content[0]?.text}`);
    try { return JSON.parse(res.content[0]?.text ?? ""); } catch { return res.content[0]?.text; }
  };
}
const post = async (path: string, body: unknown) => (await fetch(`${HTTP}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
type Item = { room: string; id: string; seq: number; from: string; text: string };

const busy = seatBeat(`${HTTP}/mcp`, "seat-busy");
const b = await connect(busy.mcpUrl);
const a = await connect(`${HTTP}/mcp`);
const c = await connect(`${HTTP}/mcp`);
const R = "steer";
const joinedB = await b("join_room", { room: R, name: "builder", agent: "claude", expected_participants: 0 });
await a("join_room", { room: R, name: "asker", agent: "codex" });
const joinedC = await c("join_room", { room: R, name: "third", agent: "openrouter" });
await b("wait_for_messages", { room: R, timeout_ms: 0 });
await c("wait_for_messages", { room: R, timeout_ms: 0 });

// 1. Nothing addressed: an empty peek.
let hb = await post("/heartbeat", { seat_key: "seat-busy", tool: "Bash", detail: "npm test" });
assert.equal(hb.marked, 1);
assert.deepEqual(hb.pending, []);

// 2. A mention while busy: the peek carries it (who, text, reply_to), and peeking again does not consume it.
await a("send_message", { room: R, content: "plain chatter, nobody named" });
const ask = await a("send_message", { room: R, content: "@builder which port is your dev hub on?", force: true });
hb = await post("/heartbeat", { seat_key: "seat-busy", tool: "Bash" });
assert.equal(hb.pending.length, 1, JSON.stringify(hb));
const item = hb.pending[0] as Item;
assert.equal(item.id, ask.id); assert.equal(item.from, "asker"); assert.equal(item.room, R);
assert.match(item.text, /which port is your dev hub on\?/);
assert.match(item.text, new RegExp(`reply_to="${ask.id}"`));
hb = await post("/heartbeat", { seat_key: "seat-busy", tool: "Read", peek: true });
assert.equal(hb.pending.length, 1, "peek is not consumption");
assert.equal(hb.marked, 0, "peek:true records no step");

// 3. Ack after injection: delivered. The next peek is empty; the next wait does not re-send the plain chatter's
//    predecessor ordering wrongly (chatter before the ask is still delivered) and does not lose anything.
const acked = await post("/steer/ack", { seat_key: "seat-busy", ids: [ask.id] });
assert.equal(acked.acked, 1);
hb = await post("/heartbeat", { seat_key: "seat-busy", tool: "Bash" });
assert.deepEqual(hb.pending, []);
const w = await b("wait_for_messages", { room: R, timeout_ms: 0 });
const joined = (w.messages as string[]).join("\n");
assert.match(joined, /plain chatter/, "earlier unseen chatter is still delivered after an ack");
// the ask itself stays the focused ask until answered (same debt rules as a delivered ask), never lost, but its body
// is not sent twice: the wait names it as already shown
assert.match(String(w.hint ?? ""), new RegExp(ask.id));
assert.doesNotMatch(joined, /which port is your dev hub on/, "acked body is not re-sent");
assert.match(joined, new RegExp(`shown to you mid-turn; still owed: reply_to="${ask.id}"`));

// 4. A reply settles it as before.
await b("send_message", { room: R, content: "7801", reply_to: ask.id, force: true });
hb = await post("/heartbeat", { seat_key: "seat-busy", tool: "Bash" });
assert.deepEqual(hb.pending, []);

// 5. Participant-id routes (src/seat.ts knows its id, no seat key): peek + ack.
const ask2 = await a("send_message", { room: R, content: "@third please review #3", force: true });
let rh = await post(`/rooms/${R}/heartbeat`, { participant_id: joinedC.participant_id, tool: "step", peek: true });
assert.equal(rh.pending.length, 1); assert.equal(rh.pending[0].id, ask2.id);
assert.equal((await post(`/rooms/${R}/steer/ack`, { participant_id: joinedC.participant_id, ids: [ask2.id] })).acked, 1);
rh = await post(`/rooms/${R}/heartbeat`, { participant_id: joinedC.participant_id, tool: "step" });
assert.deepEqual(rh.pending, []);
// an unknown id is refused, so a guessed participant id cannot read someone's asks
const bad = await fetch(`${HTTP}/rooms/${R}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participant_id: "p_nothere", peek: true }) });
assert.equal(bad.status, 400);

// 6. Universal fallback: a mention lands; the busy seat's next hub call of any other kind (board_get) carries it.
const ask3 = await a("send_message", { room: R, content: "@builder are you blocked?", force: true });
const bg = await b("board_get", { room: R });
assert.ok(Array.isArray(bg.addressed_to_you_meanwhile), JSON.stringify(bg));
assert.match(bg.addressed_to_you_meanwhile[0], /are you blocked\?/);
// carried once: it counts as delivered, so neither the next tool result nor a peek repeats it
const st = await b("room_status", { room: R });
assert.equal(st.addressed_to_you_meanwhile, undefined);
assert.deepEqual((await post("/heartbeat", { seat_key: "seat-busy", peek: true })).pending, []);
// wait/read deliver for themselves and never carry the extra field
await a("send_message", { room: R, content: "@builder and one more", force: true });
const w2 = await b("wait_for_messages", { room: R, timeout_ms: 0 });
assert.equal(w2.addressed_to_you_meanwhile, undefined);
void ask3; void joinedB;

// 7. A long ask is injected whole, last word included (chat is capped at the source): a seat must not answer half an
//    ask, and the next wait names it rather than sending it again.
const long = await a("send_message", { room: R, content: `@builder ${"x".repeat(900)} nonce=END-7`, force: true });
const lp = (await post("/heartbeat", { seat_key: "seat-busy", peek: true })).pending as Item[];
assert.equal(lp.length, 1);
assert.match(lp[0].text, /x{900} nonce=END-7/);
await post("/steer/ack", { seat_key: "seat-busy", ids: [long.id] });
const after = JSON.stringify(await b("wait_for_messages", { room: R, timeout_ms: 0 }));
assert.doesNotMatch(after, /x{900}/, "acked long body is not re-sent");

console.log("STEER CONTRACT OK");
process.exit(0);
