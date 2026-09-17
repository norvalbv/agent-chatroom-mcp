import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const HTTP = "http://127.0.0.1:7799";

async function connect(name) {
  const client = new Client({ name, version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp`));
  await client.connect(transport);
  const call = async (tool, args = {}) => {
    const res = await client.callTool({ name: tool, arguments: args });
    const text = res.content[0]?.text ?? "";
    if (res.isError) throw new Error(`${name}.${tool}: ${text}`);
    try { return JSON.parse(text); } catch { return text; }
  };
  return { client, transport, call };
}

const room = "zombie-room";
const a = await connect("agentA");
const b = await connect("agentB");

const ja = await a.call("join_room", { room, name: "agentA", agent: "claude", topic: "test zombie turn", mode: "round_robin", expected_participants: 2 });
console.log("A joined:", ja.you_are, "turn info:", ja.room.mode);
const jb = await b.call("join_room", { room, name: "agentB", agent: "claude", topic: "test zombie turn", mode: "round_robin" });
console.log("B joined:", jb.you_are);

const status1 = await a.call("room_status", { room });
console.log("status after both joined:", JSON.stringify(status1.turn ?? status1, null, 2).slice(0, 500));

// Figure out whose turn it is
console.log("Full status:", JSON.stringify(status1));

// Now simulate B's connection dying WITHOUT calling leave_room: close the transport (like a network drop / process crash)
console.log("Killing B's transport connection abruptly (no leave_room)...");
await b.transport.terminateSession?.().catch(() => {});
b.transport.close?.();

// give server a moment
await new Promise(r => setTimeout(r, 1000));

const status2 = await a.call("room_status", { room });
console.log("status after B's connection died:", JSON.stringify(status2));

process.exit(0);
