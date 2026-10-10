/**
 * Live probe for the work ledger's challenge hint: NOT in the offline suite, it launches one real agent.
 * Two scripted seats, launched like claude seats (heartbeat keys) but making no local tool call, claim an audit and
 * propose that it found nothing. One real seat, recruited before the proposal so it owes the challenge, has only the
 * room to go on. On a hub with the ledger its hint and the room carry what the hub counted (both seats: no local tool
 * call; a claim with no findings); on a hub without, nothing does. The probe prints the real seat's challenge and
 * says whether it used the count. Run after `npm run build`, once per build to compare:
 *   PORT=<free port> CHATROOM_RECRUIT_AGENT=claude CHATROOM_RECRUIT_MODEL=claude-opus-5-5 npx tsx scripts/work-ledger-probe.ts
 * Exit 0: the real seat's challenge cites the hub's count of local tool calls. Exit 1 otherwise (expected on a build
 * without the ledger, where a challenger can see an empty board but not that the claimants ran nothing).
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = Number(process.env.PORT ?? 7856);
const HTTP = `http://127.0.0.1:${PORT}`;
const ROOM = "work-ledger-probe";
const TEXT = "Conclusion: seat-a and seat-b audited every refusal path in src/hub.ts propose() and found them sound and complete. No change to propose() is needed for this release.";
const BRIEF = "You are a full member of this room, not a helper: the room is about to decide something and your vote counts. Read-only. Wait (wait_for_messages) until a proposal is open, then do what the hub asks of you on your own judgment, vote, and leave once you have voted.";

const dir = mkdtempSync(join(tmpdir(), "work-ledger-probe-"));
const server = spawn("node", ["dist/index.js"], {
  env: { ...process.env, PORT: String(PORT), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: join(dir, "data"), CHATROOM_LOG_DIR: join(dir, "logs") },
  stdio: ["ignore", "inherit", "inherit"],
});
process.on("exit", () => server.kill());

async function connect(name: string) {
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp?seat=probe-key-${name}`)));
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

type Status = { state: string; participants: { name: string; active: boolean }[]; proposals: { id: string; challenges: { by: string; objection: string; command?: string }[] }[] };
const a = await connect("a");
const b = await connect("b");
await a("join_room", { room: ROOM, name: "seat-a", agent: "claude", topic: "Are the refusal paths in src/hub.ts propose() sound?", expected_participants: 0, require_challenge: true });
await b("join_room", { room: ROOM, name: "seat-b", agent: "claude" });
const status = async () => (await a("room_status", { room: ROOM })) as Status;
await a("board_set", { room: ROOM, key: "claim/propose-audit", text: '{"owner":"seat-a","area":"audit of propose() refusals"}' });
await b("board_set", { room: ROOM, key: "claim/propose-audit-second-read", text: '{"owner":"seat-b","area":"second read of propose() refusals"}' });
await a("request_agent", { room: ROOM, name: "reviewer-1", agent: "claude", model: "claude-opus-5-5", brief: BRIEF });
for (let i = 0; i < 60 && !(await status()).participants.some((p) => p.name === "reviewer-1" && p.active); i++) await new Promise((r) => setTimeout(r, 2000));
// the first propose over bare claims is refused once (scripts/barren-claim-regression.ts); the second goes through
await a("propose", { room: ROOM, text: TEXT }).catch((e: Error) => console.log(`first propose: ${e.message.slice(0, 120)}`));
await a("propose", { room: ROOM, text: TEXT });

let filed: Status["proposals"][0]["challenges"][0] | undefined;
const deadline = Date.now() + 6 * 60_000;
while (Date.now() < deadline && !filed) {
  filed = (await status()).proposals[0]?.challenges.find((c) => c.by === "reviewer-1");
  if (!filed) await new Promise((r) => setTimeout(r, 5000));
}
const log = (await (await fetch(`${HTTP}/rooms/${ROOM}/messages`)).json()) as { seq: number; ts: string; kind: string; from: { name: string }; content: string }[];
for (const m of log) console.log(`#${m.seq} ${m.ts.slice(11, 19)} ${m.from.name} (${m.kind}): ${m.content.slice(0, 700).replace(/\n/g, " ")}`);
// an empty board any seat can see for itself; that the claimants ran nothing is known only from the hub's count
const cited = !!filed && /hub counted|counted by the hub|(no|zero) local tool calls?/i.test(filed.objection);
console.log(filed ? `\nreviewer-1 challenged: ${filed.objection}\ncommand: ${filed.command ?? "(none)"}` : "\nreviewer-1 filed no challenge");
console.log(cited ? "WORK LEDGER PROBE OK: the challenge cites the hub's count" : "WORK LEDGER PROBE: the challenge does not cite the hub's count");
server.kill();
process.exit(cited ? 0 : 1);
