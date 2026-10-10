/**
 * Work ledger and proposal evidence line (swarm-000525-jcz8, research-depth).
 * A seat's process heartbeats every local tool call, but the hub kept only the last 60 in memory and wrote none to the
 * room log, so no past room can say how much it read or searched before it proposed (pure research rooms: first
 * proposal after a median 6.9 min; scripts/research-depth-measure.py). Now the hub classes each local call
 * (read / search / web / run / edit), keeps the counts on the participant and in the room log with a time, and states
 * them in one line when a proposal opens, with the claims whose owner has no findings on the board.
 * Throwaway hub on its own port (never 7717), stopped by pid.
 * Run: npx tsx scripts/work-ledger-regression.ts (PORT= to pin the throwaway hub's port)
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { HEARTBEAT_HOOK, seatBeat } from "../src/env.js";

const PORT = Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000));
assert.notEqual(PORT, 7717, "never the live hub");
let HTTP = `http://127.0.0.1:${PORT}`;
const DATA = mkdtempSync(join(tmpdir(), "work-ledger-"));
const startHub = (port = PORT) => spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: String(port), CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: join(DATA, "spawn"), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: DATA }, stdio: ["ignore", "ignore", "inherit"] });
const server = startHub();
process.on("exit", () => server.kill());
const up = async () => {
  for (let i = 0; ; i++) {
    try { await fetch(`${HTTP}/`); return; } catch { if (i > 100) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); }
  }
};
await up();

async function connect(url: string) {
  const client = new Client({ name: "wl", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    if (res.isError) throw new Error(`${tool}: ${res.content[0]?.text}`);
    try { return JSON.parse(res.content[0]?.text ?? ""); } catch { return res.content[0]?.text; }
  };
}
type Status = { participants: { name: string; work?: Record<string, number> }[]; proposals: { evidence?: string }[]; conclusion: { evidence?: string } | null };
const status = async (room: string) => (await (await fetch(`${HTTP}/rooms/${room}`)).json()) as Status;
const messages = async (room: string) => (await (await fetch(`${HTTP}/rooms/${room}/messages`)).json()) as { kind: string; content: string }[];
// async, not spawnSync: a blocked event loop cannot see the hub close an idle keep-alive socket, and the next call resets
const local = (env: Record<string, string>, tool_name: string, tool_input: Record<string, string>) =>
  new Promise<void>((done, fail) => {
    const run = spawn(process.execPath, [HEARTBEAT_HOOK], { env: { PATH: process.env.PATH ?? "", ...env }, stdio: ["pipe", "ignore", "inherit"] });
    run.on("exit", (code) => (code === 0 ? done() : fail(new Error(`heartbeat hook exited ${code}`))));
    run.stdin.end(JSON.stringify({ hook_event_name: "PreToolUse", tool_name, tool_input }));
  });

const reader = seatBeat(`${HTTP}/mcp`, "seat-key-reader");
const idler = seatBeat(`${HTTP}/mcp`, "seat-key-idler");
const a = await connect(reader.mcpUrl);
const b = await connect(idler.mcpUrl);
const ja = await a("join_room", { room: "wl", name: "reader", agent: "claude", expected_participants: 0, require_challenge: false });
const jb = await b("join_room", { room: "wl", name: "idler", agent: "claude" });
// a second room with the challenge gate on: the same connections, so the same beats count there
const ua = await a("join_room", { room: "wl-untested", name: "reader", agent: "claude", expected_participants: 0, require_challenge: true });
const ub = await b("join_room", { room: "wl-untested", name: "idler", agent: "claude" });
await b("board_set", { room: "wl-untested", participant_id: ub.participant_id, key: "claim/idling", text: '{"owner":"idler","area":"idling"}' });
const A = { room: "wl", participant_id: ja.participant_id };
const B = { room: "wl", participant_id: jb.participant_id };

// 1. Local tool calls are counted by class. A remote fetch through the shell is web; one aimed at this machine is run.
const env = reader.env as Record<string, string>;
await local(env, "Read", { file_path: "src/hub.ts" });
await local(env, "Read", { file_path: "src/server.ts" });
// Distinct targets count, not calls: the same file again, or a second page on a host already fetched, adds nothing.
for (let i = 0; i < 5; i++) await local(env, "Read", { file_path: "src/server.ts" });
await local(env, "WebFetch", { url: "https://arxiv.org/abs/2308.08155" });
await local(env, "Grep", { pattern: "propose" });
await local(env, "WebSearch", { query: "multi-agent debate" });
await local(env, "Bash", { command: "curl -s https://arxiv.org/abs/2305.14325" });
await local(env, "Bash", { command: "curl -s http://127.0.0.1:7717/rooms" });
await local(env, "Bash", { command: "npm test" });
await local(env, "Edit", { file_path: "src/hub.ts" });
// Seats read mostly through the shell: a shell call is classed by the command it starts with, past env and `cd dir &&`.
await local(env, "Bash", { command: "cd \"/tmp/a b\" && grep -n refuse src/hub.ts | head" });
await local(env, "Bash", { command: "M=/tmp sed -n 1,40p src/hub.ts" });
// 2. Hub calls are not local work: a seat that only talks to the room has an empty ledger.
await a("board_set", { ...A, key: "claim/reading", text: '{"owner":"reader","area":"reading"}' });
await a("board_set", { ...A, key: "evidence/reading", text: "read hub.ts and server.ts; one paper" });
await b("board_set", { ...B, key: "claim/idling", text: '{"owner":"idler","area":"idling"}' });
await b("room_status", { room: "wl" });
let st = await status("wl");
assert.deepEqual(st.participants.find((p) => p.name === "reader")?.work, { read: 3, search: 2, web: 2, run: 2, edit: 1 }, "local calls counted by class");
assert.equal(st.participants.find((p) => p.name === "idler")?.work, undefined, "hub calls are not local work");

// 3. The room log keeps every counted call with its time, so a later reader can ask what was done before the proposal.
const logged = () => readFileSync(join(DATA, "wl.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; cls?: string; ts?: string });
const work = logged().filter((e) => e.type === "work");
assert.equal(work.length, 10);
assert.ok(work.every((e) => e.ts && e.cls));
// A codex seat's key beats on output, not per tool call: nothing counted for it is unknown, and is said so.
const cx = await connect(seatBeat(`${HTTP}/mcp`, "seat-key-codex").mcpUrl);
await cx("join_room", { room: "wl", name: "coder", agent: "codex" });

// 4. Proposing states what the hub counted: per seat, how many did nothing, and the claim nobody reported on.
// (the first propose over a claim with no findings is refused once: scripts/barren-claim-regression.ts)
await assert.rejects(a("propose", { ...A, text: "The room has read enough to conclude." }), /CLAIMS WITHOUT FINDINGS/);
const pr = await a("propose", { ...A, text: "The room has read enough to conclude." });
st = await status("wl");
const evidence = st.proposals[0]?.evidence ?? "";
assert.match(evidence, /reader: read 3, search 2, web 2, run 2, edit 1/);
assert.match(evidence, /idler: none/);
assert.match(evidence, /1 of 2 seats made no local tool call; 1 of 2 made no web call/);
assert.match(evidence, /1 seat does not report local work: unknown, not zero/);
assert.doesNotMatch(evidence, /coder: none/);
assert.match(evidence, /claim\/idling \(idler\)/);
assert.doesNotMatch(evidence, /claim\/reading/, "a claim with findings beside it is not listed");
const said = (await messages("wl")).filter((m) => m.kind === "system" && m.content.includes("EVIDENCE BEHIND THIS PROPOSAL"));
assert.equal(said.length, 1, "the room is told once, right after the proposal");
// The seat that owes the challenge gets the thin spots in its own hint, the one line it acts on; the proposer does not.
await assert.rejects(a("propose", { room: "wl-untested", participant_id: ua.participant_id, text: "This one still needs its challenge." }), /CLAIMS WITHOUT FINDINGS/);
await a("propose", { room: "wl-untested", participant_id: ua.participant_id, text: "This one still needs its challenge." });
const owed = await b("wait_for_messages", { room: "wl-untested", participant_id: ub.participant_id, timeout_ms: 0 });
assert.match(owed.hint, /untested\. The hub counted: idler made no local tool call; claim\/idling \(idler\) has no findings on the board\./);
assert.match(owed.hint, /Name its single weakest claim/);

// 5. A hub started from the log keeps the ledger (replayed from the log), and the conclusion carries the line into the record.
// (a second hub started on the same log, on the next port; the first is left alone and writes nothing more)
HTTP = `http://127.0.0.1:${PORT + 1}`;
const second = startHub(PORT + 1);
process.on("exit", () => second.kill());
await up();
st = await status("wl");
assert.deepEqual(st.participants.find((p) => p.name === "reader")?.work, { read: 3, search: 2, web: 2, run: 2, edit: 1 }, "ledger survives a restart");
assert.match(st.proposals[0]?.evidence ?? "", /idler: none/);
const a2 = await connect(seatBeat(`${HTTP}/mcp`, "seat-key-reader").mcpUrl);
const b2 = await connect(seatBeat(`${HTTP}/mcp`, "seat-key-idler").mcpUrl);
await a2("join_room", { room: "wl", name: "reader", agent: "claude", participant_id: ja.participant_id });
await b2("join_room", { room: "wl", name: "idler", agent: "claude", participant_id: jb.participant_id });
await b2("vote", { ...B, proposal_id: pr.id, vote: "agree", quote: "The room has read enough" });
st = await status("wl");
assert.match(st.conclusion?.evidence ?? "", /reader: read 3/, "the conclusion carries the evidence line");

// 6. Seats no launcher started have no heartbeat key: nothing is counted, so nothing is claimed about them.
const c = await connect(`${HTTP}/mcp`);
const d = await connect(`${HTTP}/mcp`);
const jc = await c("join_room", { room: "wl-plain", name: "c", agent: "claude", expected_participants: 0, require_challenge: false });
await d("join_room", { room: "wl-plain", name: "d", agent: "claude" });
await c("propose", { room: "wl-plain", participant_id: jc.participant_id, text: "Plain seats propose as before." });
assert.equal((await status("wl-plain")).proposals[0]?.evidence, undefined);
assert.ok(!(await messages("wl-plain")).some((m) => m.content.includes("EVIDENCE BEHIND")));

console.log("WORK LEDGER OK");
process.exit(0);
