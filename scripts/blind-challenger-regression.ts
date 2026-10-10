/**
 * The fresh challenger must join without the discussion it was recruited for not having seen (swarm-000525-jcz8,
 * sources/recruiting-literature). Every recruit is told by prompts/recruit.md to read the board and recent messages
 * first, and join_room hands any joiner the last 30 messages, votes and challenges included, plus every proposal's
 * tally. BenchForm (arXiv:2501.13381) measured models that were right alone switching to a wrong unanimous majority in
 * 23.5% of cases. So the fresh challenger's prompt says not to read the room first, and its join shows only the
 * proposal's current text: no messages before it, no votes, challenges or tally, no board. Other recruits and seats
 * are unchanged. Red at 5e5b1cec: the prompt says "Read the board" and the join carries the votes.
 * Run: PORT=<free port> npx tsx scripts/blind-challenger-regression.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Spawner } from "../src/spawner.js";

// ---------- 1. The prompt: a fresh challenger is told not to read the room first; any other recruit still is ----------
const logDir = mkdtempSync(join(tmpdir(), "blind-challenger-"));
const spawner = new Spawner({ mcpUrl: "http://test/mcp", defaultCwd: process.cwd(), logDir, dryRun: true, freshChallenger: true });
spawner.attach({ isHeld: () => false, claimArea: () => {}, ensureRoom: () => {}, announce: () => {}, liveAgents: () => 0 });
const fresh = spawner.freshChallenger("room-p", { id: "prop_x", text: "The cache makes reads 40% faster.", by: "seat-1" })!;
const freshPrompt = readFileSync(fresh.log, "utf8");
assert.doesNotMatch(freshPrompt, /Read the board \(`board_get`\) and the recent messages before doing anything/, "the fresh challenger is not told to read the discussion first");
assert.match(freshPrompt, /Do not read the room's messages or board before you have checked the claim/);
const [other] = spawner.request({ room: "room-p", requestedBy: "seat-1", brief: "Measure the cache hit rate and report it on the board." });
assert.match(readFileSync(other.log, "utf8"), /Read the board \(`board_get`\) and the recent messages before doing anything/, "an ordinary recruit keeps the instruction");

// ---------- 2. The join: over MCP, the fresh challenger sees the proposal and nothing that says who agreed ----------
const PORT = Number(process.env.PORT ?? 7819);
const HTTP = `http://127.0.0.1:${PORT}`;
const server = spawn("npx", ["tsx", "src/index.ts"], {
  env: { ...process.env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_FRESH_CHALLENGER: "1", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: mkdtempSync(join(tmpdir(), "blind-data-")), CHATROOM_LOG_DIR: mkdtempSync(join(tmpdir(), "blind-logs-")) },
  stdio: ["ignore", "ignore", "inherit"],
});
process.on("exit", () => server.kill());
for (let i = 0; i < 80; i++) {
  try {
    await fetch(`${HTTP}/`);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}
async function connect(name: string) {
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp`)));
  return async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    if (res.isError) throw new Error(`${name}.${tool}: ${res.content[0]?.text}`);
    return JSON.parse(res.content[0].text);
  };
}
const R = "blind-room";
const TEXT = "The cache makes reads 40% faster in scripts/bench.ts and nothing else changes.";
const a = await connect("a");
const b = await connect("b");
await a("join_room", { room: R, name: "seat-a", agent: "claude", topic: "does the cache help", expected_participants: 2, require_challenge: true });
await b("join_room", { room: R, name: "seat-b", agent: "claude" });
await a("submit_opening", { room: R, content: "SECRET-OPENING-A: yes" });
await b("submit_opening", { room: R, content: "SECRET-OPENING-B: yes" });
await a("send_message", { room: R, content: "SECRET-CHAT: we all agree it is faster", force: true });
await a("board_set", { room: R, key: "evidence/bench", text: "SECRET-BOARD: 40% at abc1234" });
const pr = await a("propose", { room: R, text: TEXT });
await b("challenge", { room: R, proposal_id: pr.id, objection: '"nothing else changes" is vague.' });
await a("amend", { room: R, proposal_id: pr.id, find: "nothing else changes", replace: "writes are unchanged" });
await b("vote", { room: R, proposal_id: pr.id, vote: "agree", quote: "writes are unchanged", reason: "The amended clause is specific enough now." });

const c = await connect("c");
const joined = await c("join_room", { room: R, name: "fresh-challenger-1", agent: "claude", role: "recruit" });
const seen = JSON.stringify(joined);
assert.ok(seen.includes("reads 40% faster") && seen.includes("writes are unchanged"), "it sees the proposal's current text");
assert.ok(seen.includes(pr.id), "and its id, which it must name when it challenges");
for (const secret of ["SECRET-OPENING", "SECRET-CHAT", "SECRET-BOARD", "evidence/bench", "votes AGREE", "is vague", "tally"]) {
  assert.ok(!seen.includes(secret), `the fresh challenger's join does not show ${secret}`);
}
assert.match(joined.hint, /fresh challenger/i, "the hint says why it sees so little");

// ---------- 2b. ...and its waits keep it that way (review/blind-challenger, claude-opus-5-5-5: the first wait leaked the tally) ----------
const w1 = await c("wait_for_messages", { room: R, timeout_ms: 0 });
const w1s = JSON.stringify(w1);
for (const secret of ["SECRET-OPENING", "SECRET-CHAT", "SECRET-BOARD", "evidence/bench", "is vague", "tally", "You have voted", "waiting_on", "blocked_by"]) {
  assert.ok(!w1s.includes(secret), `the fresh challenger's first wait does not show ${secret}`);
}
assert.ok(w1s.includes(pr.id) && w1s.includes("writes are unchanged"), "its wait still carries the proposal it must check");
await b("send_message", { room: R, content: "SECRET-LATER: I agree with it too", force: true });
await b("send_message", { room: R, content: "@fresh-challenger-1 the bench script is scripts/bench.ts", force: true });
const w2s = JSON.stringify(await c("wait_for_messages", { room: R, timeout_ms: 0 }));
assert.ok(!w2s.includes("SECRET-LATER"), "a later message that is not addressed to it is not pushed to it");
assert.ok(w2s.includes("the bench script is scripts/bench.ts"), "a message addressed to it still is");

// ---------- 3. Anyone else joining late still gets the full view ----------
const d = await connect("d");
const late = JSON.stringify(await d("join_room", { room: R, name: "late-seat", agent: "claude" }));
for (const shown of ["SECRET-CHAT", "evidence/bench", "is vague"]) assert.ok(late.includes(shown), `an ordinary late joiner still sees ${shown}`);

console.log("blind-challenger-regression OK");
server.kill();
process.exit(0);
