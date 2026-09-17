/**
 * End-to-end test for the OpenRouter seat (src/openrouter.ts) with no OpenRouter account involved:
 * a local OpenAI-compatible stub plays the model and scripts its tool calls, so this asserts the
 * parts we own — the tool schemas sent to the provider, hub tools called over MCP, local tools, the
 * read-only guard, the nudge when the model stops calling tools, the final answer on stdout, and
 * the same seat spawned by another agent's request_agent.
 * Needs `npm run build` first (the spawner launches dist/openrouter.js). Run: npm run smoke:openrouter
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Spawner } from "../src/spawner.js";

const HUB_PORT = Number(process.env.PORT ?? 7734);
const STUB_PORT = HUB_PORT + 1;
const HUB = `http://127.0.0.1:${HUB_PORT}`;
const STUB = `http://127.0.0.1:${STUB_PORT}`;
const ROOM = "openrouter-smoke";
const RECRUIT_ROOM = "openrouter-recruit";

assert.ok(existsSync("dist/openrouter.js"), "run `npm run build` first: the spawner launches dist/openrouter.js");

// The hub inherits the stub endpoint, so seats it spawns talk to the stub too.
const hub = spawn("npx", ["tsx", "src/index.ts"], {
  env: { ...process.env, PORT: String(HUB_PORT), OPENROUTER_API_KEY: "test-key", OPENROUTER_BASE_URL: STUB, CHATROOM_LOG_DIR: "/tmp/openrouter-smoke-logs" },
  stdio: ["ignore", "inherit", "inherit"],
});
process.on("exit", () => hub.kill());

// ---------- the stub model: one scripted turn per request, one script per seat ----------
interface Turn {
  content: string | null;
  tool_calls?: unknown[];
}
interface Body {
  messages: { role: string; content?: string }[];
  tools: { function: { name: string; parameters: Record<string, unknown> } }[];
}
const call = (id: string, name: string, args: unknown) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const scripts: Record<string, Turn[]> = {
  seat: [
    { content: null, tool_calls: [call("c1", "join_room", { room: ROOM, name: "deepseek-1", agent: "openrouter", topic: "Does the OpenRouter seat work?", expected_participants: 2 })] },
    { content: null, tool_calls: [call("c2", "read_file", { path: "package.json", limit: 3 }), call("c3", "search", { pattern: "OpenRouter seat" })] },
    { content: null, tool_calls: [call("c4", "send_message", { room: ROOM, content: "hello from the openrouter seat" })] },
    { content: null, tool_calls: [call("c5", "run_command", { command: "rm -rf /tmp/openrouter-smoke-should-not-run" })] },
    { content: null, tool_calls: [call("c6", "run_command", { command: "echo shell-works" })] },
    { content: null, tool_calls: [call("c7", "leave_room", { room: ROOM })] },
  ],
  recruit: [
    { content: null, tool_calls: [call("r1", "join_room", { room: RECRUIT_ROOM, name: "or-recruit", agent: "openrouter", role: "recruit" })] },
    { content: null, tool_calls: [call("r2", "send_message", { room: RECRUIT_ROOM, content: "recruit reporting: spawned by request_agent" })] },
    { content: null, tool_calls: [call("r3", "leave_room", { room: RECRUIT_ROOM })] },
  ],
};
const turns: Record<string, number> = { seat: 0, recruit: 0 };
const bodies: Record<string, Body | undefined> = {};
const stub = createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    assert.equal(req.url, "/chat/completions");
    assert.equal(req.headers.authorization, "Bearer test-key");
    const body = JSON.parse(raw) as Body;
    // recruit.md briefs the newcomer on its lineage; that is how we tell the two seats apart
    const which = /recruited by/.test(body.messages[1]?.content ?? "") ? "recruit" : "seat";
    bodies[which] = body;
    const message = scripts[which][turns[which]++] ?? { content: `CONCLUSION: the OpenRouter ${which} drives the chatroom tools.` };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ finish_reason: message.tool_calls ? "tool_calls" : "stop", message }], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0 } }));
  });
});
await new Promise<void>((r) => stub.listen(STUB_PORT, "127.0.0.1", r));

for (let i = 0; i < 50; i++) {
  try {
    await fetch(HUB);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 200));
  }
}

// ---------- 1. the seat as a launcher runs it ----------
const seat = spawn("npx", ["tsx", "src/openrouter.ts", "-p", "Join the room, say hello, then leave.", "--mcp-url", `${HUB}/mcp`, "--model", "stub/model"], {
  env: { ...process.env, OPENROUTER_API_KEY: "test-key", OPENROUTER_BASE_URL: STUB },
  stdio: ["ignore", "pipe", "inherit"],
});
let stdout = "";
seat.stdout.on("data", (d) => (stdout += d));
assert.equal(await new Promise<number | null>((r) => seat.on("close", r)), 0, "seat exited non-zero");

const results = (bodies.seat?.messages ?? []).filter((m) => m.role === "tool").map((m) => m.content ?? "");
const offered = bodies.seat?.tools ?? [];
const joinTool = offered.find((t) => t.function.name === "join_room");
assert.ok(joinTool, "join_room was not offered to the model");
assert.equal(joinTool.function.parameters.type, "object");
assert.ok(!("$schema" in joinTool.function.parameters), "$schema should be stripped from tool schemas");
assert.ok(offered.some((t) => t.function.name === "read_file") && offered.some((t) => t.function.name === "run_command"), "local tools were not offered");
assert.ok(results[0]?.includes("you_are"), `join_room did not succeed: ${results[0]}`);
assert.ok(/1\t\{/.test(results[1] ?? ""), `read_file did not return numbered lines: ${results[1]}`);
assert.ok(results[2]?.includes("openrouter.ts"), `search found nothing: ${results[2]}`);
assert.ok(results[4]?.startsWith("Refused:"), `a read-only seat ran a mutating command: ${results[4]}`);
assert.ok(results[5]?.includes("shell-works"), `run_command failed: ${results[5]}`);
assert.ok(stdout.includes("CONCLUSION: the OpenRouter seat drives the chatroom tools."), `final answer missing from stdout: ${stdout}`);
assert.ok(turns.seat >= scripts.seat.length, `the seat stopped after ${turns.seat} of ${scripts.seat.length} scripted turns`);

const transcript = await (await fetch(`${HUB}/rooms/${ROOM}/transcript`)).text();
assert.ok(transcript.includes("hello from the openrouter seat"), `the room did not receive the message:\n${transcript}`);
assert.equal(transcript.match(/hello from the openrouter seat/g)?.length, 1, "the message was sent more than once");
const room = (await (await fetch(`${HUB}/rooms/${ROOM}`)).json()) as { participants: { name: string; agent: string }[] };
assert.ok(room.participants.some((p) => p.name === "deepseek-1" && p.agent === "openrouter"), `not in the room as an openrouter agent: ${JSON.stringify(room.participants)}`);

// ---------- 2. the seat as another agent recruits it ----------
const client = new Client({ name: "recruiter", version: "0.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${HUB}/mcp`)));
const mcp = async (tool: string, args: Record<string, unknown>) => {
  const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  if (res.isError) throw new Error(`${tool}: ${res.content[0]?.text}`);
  return JSON.parse(res.content[0]?.text ?? "{}");
};
await mcp("join_room", { room: RECRUIT_ROOM, name: "claude-1", agent: "claude", topic: "Can a room recruit an OpenRouter seat?", expected_participants: 2 });
const asked = await mcp("request_agent", { room: RECRUIT_ROOM, name: "or-recruit", agent: "openrouter", model: "stub/model", brief: "Join this room, report that you exist in one line, then leave. This is a test of the OpenRouter seat." });
assert.equal(asked.agent, "openrouter");
assert.deepEqual(asked.spawned, ["or-recruit"]);

let recruited = "";
for (let i = 0; i < 100 && !recruited.includes("recruit reporting"); i++) {
  await new Promise((r) => setTimeout(r, 500));
  recruited = await (await fetch(`${HUB}/rooms/${RECRUIT_ROOM}/transcript`)).text();
}
assert.ok(recruited.includes("recruit reporting: spawned by request_agent"), `the recruited seat never spoke (see /tmp/openrouter-smoke-logs/or-recruit.log):\n${recruited}`);
const listed = (await (await fetch(`${HUB}/agents`)).json()) as { name: string; agent: string; model: string }[];
assert.ok(listed.some((a) => a.name === "or-recruit" && a.agent === "openrouter" && a.model === "stub/model"), `not listed as an openrouter recruit: ${JSON.stringify(listed)}`);

// ---------- 3. no key, no seat: a dead seat must never be counted into a quorum ----------
const probe = new Spawner({ mcpUrl: `${HUB}/mcp`, defaultCwd: process.cwd(), logDir: "/tmp/openrouter-smoke-logs", dryRun: true });
const key = process.env.OPENROUTER_API_KEY;
delete process.env.OPENROUTER_API_KEY;
assert.throws(() => probe.request({ room: ROOM, brief: "A brief that is comfortably longer than twenty characters.", requestedBy: "claude-1", agent: "openrouter" }), /OPENROUTER_API_KEY/);
process.env.OPENROUTER_API_KEY = key;

console.log(`OPENROUTER SMOKE OK (seat: ${turns.seat} turns, recruit: ${turns.recruit} turns)`);
await client.close().catch(() => {});
stub.close();
hub.kill();
process.exit(0);
