/** A recruit brief longer than the 4,000-character cap goes on the board and the recruit is pointed at it, instead of
 * being refused after it was written. In swarm-003601-tky5-room two of the first recruit calls (for hub-keeper and
 * resource-seeder) were refused at the cap, which the tool does not state; both seats then wrote the brief to
 * brief/<area> by hand and recruited with a pointer (friction/brief-cap). The hub now does that itself.
 * PORT=<free port> npx tsx scripts/long-brief-regression.ts */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let nextPort = Number(process.env.PORT) || 0;
const freePort = () => new Promise<number>((done) => { const s = createServer(); s.listen(nextPort ? nextPort++ : 0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => done(p)); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const port = await freePort();
const logs = mkdtempSync(join(tmpdir(), "long-brief-"));
const { CHATROOM_SEAT_KEY: _k, CHATROOM_HEARTBEAT_URL: _h, CHATROOM_DATA_DIR: _d, CHATROOM_RECRUIT_AGENT: _a, CHATROOM_RECRUIT_MODEL: _m, ...rest } = process.env;
const hub: ChildProcess = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { ...rest, PORT: String(port), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: logs }, stdio: "ignore" });
type Result = { isError?: boolean; content: { text: string }[] };
try {
  for (let i = 0; i < 150; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await sleep(200); } }
  const c = new Client({ name: "seat", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await c.callTool({ name, arguments: args })) as Result;
    const text = r.content[0]?.text ?? "";
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text); } catch {}
    return { error: !!r.isError, text, data };
  };
  await call("join_room", { room: "lobby", name: "lead", topic: "t" });
  const opening = "Build the supervisor for the hub and show it restarting a hub that was killed.";
  const marker = "DONE-LOOKS-LIKE-two-commits-and-a-board-entry";
  const long = `${opening}\n\n${"Context the recruit needs, one line of many. ".repeat(110)}\n${marker}`;
  assert.ok(long.length > 4000 && long.length < 8000);

  // a 5,000-character brief: the recruit is launched, the whole brief is on the board, the recruit's prompt points at it
  const r = await call("request_agent", { room: "lobby", brief: long, name: "keeper", area: "hub-supervisor" });
  assert.equal(r.error, false, `a long brief is accepted: ${r.text}`);
  assert.equal(r.data.brief_on_board, "brief/hub-supervisor", "the reply says where the brief went");
  const entry = await call("board_get", { room: "lobby", key: "brief/hub-supervisor" });
  assert.equal((entry.data.text as string), long, "the board holds the brief, whole");
  assert.equal(entry.data.by, "lead", "under the recruiter's name, so the recruiter can edit it");
  const prompt = readFileSync(join(logs, "keeper.log"), "utf8");
  assert.match(prompt, /brief\/hub-supervisor/, "the recruit is told the key");
  assert.match(prompt, /board_get/, "and how to read it");
  assert.ok(prompt.includes(opening), "its prompt opens with the brief's first lines");
  assert.ok(!prompt.includes(marker), "and does not carry the whole text a second time");

  // no area: the key is the recruit's name; an existing entry is never overwritten
  await call("board_set", { room: "lobby", key: "brief/scout", text: "an earlier brief" });
  const r2 = await call("request_agent", { room: "lobby", brief: long, name: "scout" });
  assert.equal(r2.error, false, r2.text);
  assert.notEqual(r2.data.brief_on_board, "brief/scout");
  assert.match(String(r2.data.brief_on_board), /^brief\/scout-/);
  assert.equal((await call("board_get", { room: "lobby", key: "brief/scout" })).data.text, "an earlier brief");

  // a short brief is passed as before, nothing goes on the board
  const r3 = await call("request_agent", { room: "lobby", brief: "Read the supervisor's log and report what it says about restarts.", name: "reader" });
  assert.equal(r3.error, false, r3.text);
  assert.equal(r3.data.brief_on_board, undefined);

  // past what a board entry holds: refused, and the refusal says the numbers and what to do
  const r4 = await call("request_agent", { room: "lobby", brief: "x".repeat(8100), name: "too-long" });
  assert.equal(r4.error, true);
  assert.match(r4.text, /8,?000/);
  assert.match(r4.text, /board/);
} finally {
  if (hub.exitCode === null && hub.signalCode === null) hub.kill("SIGKILL");
}
console.log("LONG BRIEF REGRESSION OK");
process.exit(0);
