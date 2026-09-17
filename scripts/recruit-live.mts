import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const client = new Client({ name: "recruiter", version: "0" });
await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:7717/mcp")));
const call = async (name: string, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  if (r.isError) throw new Error(r.content[0]?.text);
  try { return JSON.parse(r.content[0].text); } catch { return r.content[0].text; }
};
const room = "recruit-live";
await call("join_room", { room, name: "recruiter-1", agent: "claude", topic: "Does scripts/smoke.ts cover the hold/ board key? Report the exact line numbers." });
await call("send_message", { room, content: "I need a second pair of eyes on the smoke test coverage; recruiting one." });
const sp = await call("request_agent", { room, brief: "Read scripts/smoke.ts in this repo and report, with line numbers, which assertions cover the hold/<room> board key and the verification gate. Put the list on the board under findings/<your name>, then tell the room in one message and leave.", model: "haiku" });
console.log("spawned", JSON.stringify(sp.spawned), "depth", sp.depth);
const t0 = Date.now();
let seq = 0;
while (Date.now() - t0 < 6 * 60_000) {
  const w = await call("wait_for_messages", { room, since_seq: seq, timeout_ms: 30_000 });
  for (const m of w.messages) console.log(new Date().toISOString().slice(11, 19), m.slice(0, 300));
  seq = w.next_seq;
  if (w.messages.some((m: string) => /left the room/.test(m))) break;
}
const board = await call("board_get", { room });
console.log("BOARD:", JSON.stringify(board).slice(0, 1200));
const la = await call("list_agents", { room });
console.log("AGENTS:", JSON.stringify(la));
await call("leave_room", { room });
await client.close();
