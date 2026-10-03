/**
 * room_status size (swarm-181144-uxtr, issue 2; src/hub/status-view.ts): a seat's room_status no longer repeats the
 * whole room topic, every seat's full last command or four fields per board key. What a seat acts on stays whole: the
 * open proposal's text, votes and challenges, liveness, the board keys with author and reviewer. join_room and
 * list_rooms still carry the full topic.
 * Throwaway hub on its own port (never 7717), stopped with the process.
 * Run: npx tsx scripts/room-status-size-regression.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { seatBeat } from "../src/env.js";

const PORT = Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000));
assert.notEqual(PORT, 7717, "never the live hub");
const HTTP = `http://127.0.0.1:${PORT}`;
const server = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: "/tmp/chatroom-status-spawn", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: "" }, stdio: ["ignore", "ignore", "inherit"] });
process.on("exit", () => server.kill());
for (let i = 0; ; i++) {
  try { await fetch(`${HTTP}/`); break; } catch { if (i > 100) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); }
}

async function connect(url: string) {
  const client = new Client({ name: "status", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    if (res.isError) throw new Error(`${tool}: ${res.content[0]?.text}`);
    const text = res.content[0]?.text ?? "";
    return { text, data: JSON.parse(text) };
  };
}

const R = "status";
const TOPIC = `Brief: ${"build the thing carefully. ".repeat(200)}END-OF-TOPIC`;
const beat = seatBeat(`${HTTP}/mcp`, "seat-status");
const a = await connect(beat.mcpUrl);
const b = await connect(`${HTTP}/mcp`);
const joined = await a("join_room", { room: R, name: "builder", agent: "claude", topic: TOPIC, expected_participants: 0 });
await b("join_room", { room: R, name: "peer", agent: "codex" });
// join_room (and list_rooms) keep the whole topic: that is where a seat reads it
assert.match(joined.data.room.topic, /END-OF-TOPIC$/);
await a("board_set", { room: R, key: "claim/x", text: "{\"owner\":\"builder\",\"area\":\"x\"}" });
await b("board_set", { room: R, key: "evidence/y", text: "y".repeat(2000) });
const PROPOSAL = `We conclude: ${"a long and careful conclusion. ".repeat(60)}PROPOSAL-END`;
await a("propose", { room: R, text: PROPOSAL });

// the builder's last step is a long local command (hub calls record steps too, so it goes last)
await fetch(`${HTTP}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat_key: "seat-status", tool: "Bash", detail: `cd /very/long/worktree/path && ${"npm run build && ".repeat(15)}npx tsx scripts/smoke.ts` }) });
const st = await b("room_status", { room: R });
const s = st.data;
// 1. the topic is cut to its opening, says how long it was and where it is whole
assert.ok(s.topic.length < 400, `topic cut: ${s.topic.length}`);
assert.ok(s.topic.startsWith("Brief: build the thing carefully."));
assert.match(s.topic, new RegExp(`${TOPIC.length} chars; list_rooms carries it whole`));
const listed = JSON.parse((await b("list_rooms", {})).text) as { name: string; topic: string }[];
assert.match(listed.find((r) => r.name === R)!.topic, /END-OF-TOPIC$/);
// 2. a seat's working detail is one line; tool, step and liveness stay
const builder = s.participants.find((p: { name: string }) => p.name === "builder");
assert.equal(builder.working.tool, "Bash");
assert.ok(builder.working.detail.length <= 81, builder.working.detail);
assert.ok(builder.liveness && typeof builder.liveness.age_seconds === "number");
// 3. every board key stays, with its author and reviewer
assert.deepEqual(Object.keys(s.board).sort(), ["claim/x", "evidence/y"]);
assert.equal(s.board["evidence/y"].by, "peer");
assert.ok(s.board["claim/x"].reviewer, "reviewer kept");
// 4. the open proposal is whole: text, votes, blockers
const open = s.proposals.find((p: { status: string }) => p.status === "open");
assert.match(open.text, /PROPOSAL-END$/);
assert.ok(Array.isArray(open.votes) && open.votes.length === 1);
// 5. and the whole result is small: the 5 KB topic is no longer in it
assert.ok(st.text.length < 4_500, `room_status bytes: ${st.text.length}`);

console.log(`ROOM STATUS SIZE OK (${st.text.length} B)`);
process.exit(0);
