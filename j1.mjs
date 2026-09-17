import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const HTTP = "http://127.0.0.1:7799";

function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT: ${label}`)), ms)),
  ]);
}

async function connect(name) {
  const client = new Client({ name, version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp`));
  await withTimeout(client.connect(transport), 5000, `connect ${name}`);
  const call = async (tool, args = {}) => {
    const res = await withTimeout(client.callTool({ name: tool, arguments: args }), 5000, `${name}.${tool}`);
    const text = res.content[0]?.text ?? "";
    if (res.isError) throw new Error(`${name}.${tool}: ${text}`);
    try { return JSON.parse(text); } catch { return text; }
  };
  return { client, transport, call };
}

const room = "zombie-room";
console.log("connecting A...");
const a = await connect("agentA");
console.log("connecting B...");
const b = await connect("agentB");

console.log("A join_room...");
const ja = await a.call("join_room", { room, name: "agentA", agent: "claude", topic: "test zombie turn", mode: "round_robin", expected_participants: 2 });
console.log("A joined:", ja.you_are);

console.log("B join_room...");
const jb = await b.call("join_room", { room, name: "agentB", agent: "claude", topic: "test zombie turn", mode: "round_robin" });
console.log("B joined:", jb.you_are);

const status1 = await a.call("room_status", { room });
console.log("status after both joined:", JSON.stringify(status1));

console.log("Killing B's transport abruptly (no leave_room) via transport.close()...");
await b.transport.close();
console.log("B transport closed locally.");

await new Promise(r => setTimeout(r, 500));

const status2 = await a.call("room_status", { room });
console.log("status after B connection dropped:", JSON.stringify(status2));

const wfm = await a.call("wait_for_messages", { room, timeout_ms: 1000 });
console.log("A's wait_for_messages view:", JSON.stringify({ your_turn: wfm.your_turn, active_participants: wfm.active_participants }));

process.exit(0);
