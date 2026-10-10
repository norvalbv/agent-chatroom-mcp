/**
 * Live probe for the fresh challenger: NOT in the offline suite, it launches one real agent.
 * Two scripted seats agree on a proposal whose one checkable claim is false (the tool count in src/server.ts is
 * overstated). The hub, started from this checkout's build with CHATROOM_FRESH_CHALLENGER=1, must recruit a real
 * seat that checks the claim and files a challenge carrying a command, and the proposal must stay open meanwhile.
 * Run after `npm run build`:
 *   PORT=<free port> CHATROOM_RECRUIT_AGENT=claude CHATROOM_RECRUIT_MODEL=claude-opus-5-5 npx tsx scripts/fresh-challenger-probe.ts
 * Exit 0: the recruit filed a challenge with a command and the room had not concluded. Exit 1 otherwise.
 * ARM=off runs the same scripted room on the same build without the flag (no agent is launched): exit 0 when the
 * room concludes on the false count, which is what the flag is there to stop.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = Number(process.env.PORT ?? 7815);
const HTTP = `http://127.0.0.1:${PORT}`;
const ROOM = "fresh-challenger-probe";
const OFF = process.env.ARM === "off";
const real = (readFileSync("src/server.ts", "utf8").match(/server\.registerTool\(/g) ?? []).length;
const FALSE_COUNT = real + 3;
const TEXT = `Conclusion: src/server.ts registers ${FALSE_COUNT} MCP tools with server.registerTool; count them with grep -c 'server.registerTool(' src/server.ts. The tool list is therefore complete for this release.`;

const dir = mkdtempSync(join(tmpdir(), "fresh-challenger-probe-"));
const server = spawn("node", ["dist/index.js"], {
  env: { ...process.env, PORT: String(PORT), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_FRESH_CHALLENGER: OFF ? "0" : "1", CHATROOM_DATA_DIR: join(dir, "data"), CHATROOM_LOG_DIR: join(dir, "logs") },
  stdio: ["ignore", "inherit", "inherit"],
});
process.on("exit", () => server.kill());

async function connect(name: string) {
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp`)));
  return async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    const text = res.content[0]?.text ?? "";
    if (res.isError) throw new Error(`${name}.${tool}: ${text}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
}
for (let i = 0; i < 50; i++) {
  try {
    await fetch(`${HTTP}/`);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 200));
  }
}

const a = await connect("a");
const b = await connect("b");
await a("join_room", { room: ROOM, name: "seat-a", agent: "claude", topic: "How many MCP tools does src/server.ts register?", expected_participants: 2, require_challenge: true });
await b("join_room", { room: ROOM, name: "seat-b", agent: "claude" });
await a("submit_opening", { room: ROOM, content: `${FALSE_COUNT} tools.` });
await b("submit_opening", { room: ROOM, content: `${FALSE_COUNT} tools, same count.` });
const prop = (await a("propose", { room: ROOM, text: TEXT })).proposal ?? (await a("room_status", { room: ROOM })).proposals[0];
const id: string = prop.id;
// the in-room scrutiny is the usual kind: a prose challenge, answered by rewording inside a minute
await b("challenge", { room: ROOM, proposal_id: id, objection: `"complete for this release" is not defined.` });
await a("amend", { room: ROOM, proposal_id: id, find: "complete for this release", replace: "complete for the release cut from this commit" });
for (const seat of [a, b]) await seat("vote", { room: ROOM, proposal_id: id, vote: "agree", quote: "MCP tools with server.registerTool", reason: "The release is now named." });

type Status = { state: string; proposals: { id: string; blocked_by: string[]; challenges: { by: string; objection: string; command?: string; status: string }[] }[] };
const status = async () => (await a("room_status", { room: ROOM })) as Status;
const first = await status();
console.log(`after both seats agreed: state=${first.state}; blocked_by=${JSON.stringify(first.proposals[0].blocked_by)}`);
const heldAtStart = first.state === "open" && first.proposals[0].blocked_by.some((x) => /fresh challenger/.test(x));
if (OFF) {
  const concluded = first.state === "concluded";
  console.log(`real count ${real}, proposed ${FALSE_COUNT}; flag off: ${concluded ? "the room concluded on the false count" : `state ${first.state}`}`);
  console.log(concluded ? "FRESH CHALLENGER PROBE (off arm) OK" : "FRESH CHALLENGER PROBE (off arm) FAILED");
  server.kill();
  process.exit(concluded ? 0 : 1);
}

let filed: Status["proposals"][0]["challenges"][0] | undefined;
let state = first.state;
const deadline = Date.now() + 8 * 60_000;
while (Date.now() < deadline) {
  const s = await status();
  state = s.state;
  filed = s.proposals[0].challenges.find((c) => c.by.startsWith("fresh-challenger"));
  if (filed || state !== "open") break;
  await new Promise((r) => setTimeout(r, 5000));
}
const log = (await (await fetch(`${HTTP}/rooms/${ROOM}/messages`)).json()) as { seq: number; ts: string; kind: string; from: { name: string }; content: string }[];
for (const m of log) console.log(`#${m.seq} ${m.ts.slice(11, 19)} ${m.from.name} (${m.kind}): ${m.content.slice(0, 500).replace(/\n/g, " ")}`);
console.log(`\nreal count ${real}, proposed ${FALSE_COUNT}; held when the votes were in: ${heldAtStart}; final state: ${state}`);
console.log(filed ? `fresh challenger filed: ${filed.objection}\ncommand: ${filed.command ?? "(none)"}` : "fresh challenger filed nothing");
const ok = heldAtStart && state === "open" && !!filed?.command;
console.log(ok ? "FRESH CHALLENGER PROBE OK" : "FRESH CHALLENGER PROBE FAILED");
server.kill();
process.exit(ok ? 0 : 1);
