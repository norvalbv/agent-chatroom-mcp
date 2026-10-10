/**
 * Live probe for the claims-without-findings refusal: NOT in the offline suite, it launches one real agent.
 * A real seat is recruited to take an area that needs several minutes, and claims it. Twenty seconds after its claim
 * a scripted seat tries to propose. The hub must refuse that once and ask the claimant in the room; the probe then
 * watches whether the real seat puts findings on the board, and how long after being asked.
 * Run after `npm run build`:
 *   PORT=<free port> CHATROOM_RECRUIT_AGENT=claude CHATROOM_RECRUIT_MODEL=claude-opus-5-5 npx tsx scripts/barren-claim-probe.ts
 * Exit 0: the propose was refused naming the claim, and the claimant posted a non-claim board entry afterwards.
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = Number(process.env.PORT ?? 7856);
const HTTP = `http://127.0.0.1:${PORT}`;
const ROOM = "barren-claim-probe";
const BRIEF = "You are a full member of this room. First write board entry claim/refusal-texts with JSON {\"owner\":\"<your name>\",\"area\":\"refusal texts\"}. Then, read-only, go through every `throw new HubError(` in src/hub.ts and judge for each whether its text tells the caller what to do next; this takes a while, be thorough. Put what you find on the board under findings/refusal-texts. Answer anything the room asks of you on the way. Leave when your findings are on the board.";

const dir = mkdtempSync(join(tmpdir(), "barren-claim-probe-"));
const server = spawn("node", ["dist/index.js"], {
  env: { ...process.env, PORT: String(PORT), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: join(dir, "data"), CHATROOM_LOG_DIR: join(dir, "logs") },
  stdio: ["ignore", "inherit", "inherit"],
});
process.on("exit", () => server.kill());

async function connect(name: string) {
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp`)));
  return async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    const text = res.content[0]?.text ?? "";
    if (res.isError) throw new Error(text);
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

type Status = { board: Record<string, { by: string; updated_at: string }> };
const a = await connect("a");
const b = await connect("b");
await a("join_room", { room: ROOM, name: "seat-a", agent: "claude", topic: "Do this hub's refusal texts tell the caller what to do next?", expected_participants: 0, require_challenge: true });
await b("join_room", { room: ROOM, name: "seat-b", agent: "claude" });
const board = async () => ((await a("room_status", { room: ROOM })) as Status).board;
await a("request_agent", { room: ROOM, name: "auditor-1", agent: "claude", model: "claude-opus-5-5", brief: BRIEF });
for (let i = 0; i < 90 && !(await board())["claim/refusal-texts"]; i++) await new Promise((r) => setTimeout(r, 2000));
await new Promise((r) => setTimeout(r, 20_000));
const early = Object.entries(await board()).some(([k, e]) => e.by === "auditor-1" && !k.startsWith("claim/"));
let refusal = "";
const askedAt = Date.now();
await a("propose", { room: ROOM, text: "Conclusion: the refusal texts are fine; nothing to change." }).catch((e: Error) => { refusal = e.message; });

let delivered: string | undefined;
let after = 0;
while (Date.now() - askedAt < 7 * 60_000 && !delivered) {
  delivered = Object.entries(await board()).find(([k, e]) => e.by === "auditor-1" && !k.startsWith("claim/"))?.[0];
  after = Math.round((Date.now() - askedAt) / 1000);
  if (!delivered) await new Promise((r) => setTimeout(r, 3000));
}
const log = (await (await fetch(`${HTTP}/rooms/${ROOM}/messages`)).json()) as { seq: number; ts: string; kind: string; from: { name: string }; content: string }[];
for (const m of log) console.log(`#${m.seq} ${m.ts.slice(11, 19)} ${m.from.name} (${m.kind}): ${m.content.slice(0, 400).replace(/\n/g, " ")}`);
console.log(`\nclaimant already had findings when the propose came: ${early}`);
console.log(`propose refused with: ${refusal || "(not refused)"}`);
console.log(delivered ? `auditor-1 wrote ${delivered} ${after} s after being asked` : "auditor-1 wrote no findings within 7 min of being asked");
const ok = /CLAIMS WITHOUT FINDINGS: claim\/refusal-texts/.test(refusal) && !!delivered;
console.log(ok ? "BARREN CLAIM PROBE OK" : "BARREN CLAIM PROBE FAILED");
server.kill();
process.exit(ok ? 0 : 1);
