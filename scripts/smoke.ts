/**
 * End-to-end smoke test: starts the server, connects two MCP clients (as two
 * agents would), and walks through join -> blind openings -> chat -> propose ->
 * vote -> consensus, asserting each step. Run: npm run smoke
 */
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = 7733;
const URL_ = `http://127.0.0.1:${PORT}/mcp`;

const server = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "inherit", "inherit"] });
const stop = () => server.kill();
process.on("exit", stop);

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("server did not start");
}

async function connect(name: string) {
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(URL_)));
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    const text = res.content[0]?.text ?? "";
    if (res.isError) throw new Error(`${name}.${tool}: ${text}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  return { client, call };
}

await waitForServer();
const a = await connect("claude");
const b = await connect("codex");
const room = "smoke";

const tools = (await a.client.listTools()).tools.map((t) => t.name).sort();
console.log("tools:", tools.join(", "));
assert.deepEqual(tools, ["join_room", "leave_room", "list_rooms", "propose", "read_messages", "room_status", "send_message", "submit_opening", "vote", "wait_for_messages"]);

const ja = await a.call("join_room", { room, name: "claude-1", agent: "claude", topic: "Tabs or spaces?", expected_participants: 2 });
assert.equal(ja.you_are, "claude-1");

// A waits before B has joined: should time out with no messages.
const t0 = Date.now();
const empty = await a.call("wait_for_messages", { room, timeout_ms: 300 });
assert.equal(empty.messages.length, 0);
assert.ok(Date.now() - t0 >= 280, "should have waited");

const jb = await b.call("join_room", { room, name: "codex-1", agent: "codex" });
assert.equal(jb.room.active_count, 2);

// Blind openings: A's is held until B submits.
const oa = await a.call("submit_opening", { room, content: "Spaces: consistent rendering everywhere." });
assert.equal(oa.revealed, false);
assert.deepEqual(oa.waiting_on, ["codex-1"]);
const before = await b.call("read_messages", { room });
assert.ok(!before.some((m: string) => m.includes("[OPENING]")), "opening leaked early");

// A drains the "codex-1 joined" notice, then long-polls; B's submission should wake it up.
const drained = await a.call("wait_for_messages", { room, timeout_ms: 0 });
assert.ok(drained.messages.some((m: string) => m.includes("joined")));
const wakeP = a.call("wait_for_messages", { room, timeout_ms: 10_000 });
const ob = await b.call("submit_opening", { room, content: "Tabs: accessible, user-configurable width." });
assert.equal(ob.revealed, true);
const woke = await wakeP;
assert.ok(woke.messages.some((m: string) => m.includes("[OPENING] Tabs")), "A did not receive B's opening");
assert.ok(!woke.messages.some((m: string) => m.includes("[OPENING] Spaces")), "own messages must not be echoed back");
const log = await a.call("read_messages", { room });
assert.ok(log.some((m: string) => m.includes("[OPENING] Spaces")), "own opening should be in the log");

// Free chat + reply.
const s1 = await a.call("send_message", { room, content: "Could we compromise: spaces in this repo, editor-configurable via .editorconfig?" });
const got = await b.call("wait_for_messages", { room, timeout_ms: 2000 });
assert.ok(got.messages.some((m: string) => m.includes("compromise")));
await b.call("send_message", { room, content: "Works for me.", reply_to: s1.id });

// Propose + vote -> unanimous consensus.
const pr = await b.call("propose", { room, text: "Use spaces (2), enforce via .editorconfig and formatter." });
assert.equal(pr.status, "open");
assert.deepEqual(pr.waiting_on, ["claude-1"]);
await assert.rejects(a.call("propose", { room, text: "a competing proposal" }), /already open/);
const pending = await a.call("wait_for_messages", { room, timeout_ms: 2000 });
assert.equal(pending.proposals_awaiting_your_vote.length, 1);
const v = await a.call("vote", { room, proposal_id: pr.id, vote: "agree", reason: "fine", confidence: 0.8 });
assert.equal(v.room_state, "concluded");
assert.match(v.conclusion.text, /spaces/);

// Sending after conclusion is rejected.
await assert.rejects(a.call("send_message", { room, content: "one more" }), /concluded/);

// Human endpoints.
const rooms = (await (await fetch(`http://127.0.0.1:${PORT}/rooms`)).json()) as { name: string; state: string }[];
assert.equal(rooms[0].state, "concluded");
const transcript = await (await fetch(`http://127.0.0.1:${PORT}/rooms/${room}/transcript`)).text();
assert.match(transcript, /CONSENSUS REACHED/);

// Round-robin room with turn enforcement.
await a.call("join_room", { room: "rr", name: "claude-1", agent: "claude", mode: "round_robin", max_rounds: 2 });
await b.call("join_room", { room: "rr", name: "codex-1", agent: "codex" });
await assert.rejects(b.call("send_message", { room: "rr", content: "me first" }), /turn/);
await a.call("send_message", { room: "rr", content: "hello" });
const rb = await b.call("wait_for_messages", { room: "rr", timeout_ms: 500 });
assert.equal(rb.your_turn, true);
await b.call("send_message", { room: "rr", content: "hi" });
await a.call("send_message", { room: "rr", content: "round 2" });
await b.call("send_message", { room: "rr", content: "round 2 too" });
const st = await a.call("room_status", { room: "rr" });
assert.equal(st.state, "stalled");

// One MCP connection hosting two identities (subagents sharing a session) must pass participant_id.
const j1 = await a.call("join_room", { room: "shared", name: "sub-1", agent: "claude" });
const j2 = await a.call("join_room", { room: "shared", name: "sub-2", agent: "claude" });
assert.match(j2.hint, /participant_id/);
await assert.rejects(a.call("send_message", { room: "shared", content: "who am I?" }), /several participants/);
const sm = await a.call("send_message", { room: "shared", content: "hi from sub-1", participant_id: j1.participant_id });
assert.match(sm.sent, /sub-1/);
const heard = await a.call("wait_for_messages", { room: "shared", timeout_ms: 200, participant_id: j2.participant_id });
assert.ok(heard.messages.some((m: string) => m.includes("hi from sub-1")));
await a.call("leave_room", { room: "shared", participant_id: j2.participant_id });
await a.call("send_message", { room: "shared", content: "alone now, no id needed" });

await a.call("leave_room", { room: "rr" });
await b.call("leave_room", { room: "rr" });
await a.client.close();
await b.client.close();
console.log("\nTRANSCRIPT:\n" + transcript);
console.log("SMOKE OK");
stop();
process.exit(0);
