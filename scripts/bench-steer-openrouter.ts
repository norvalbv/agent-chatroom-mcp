import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// One real Opus seat and a scripted peer. Serial invocations use the same brief and local-tool fixture.
const build = resolve(process.argv[2] ?? ".");
const out = resolve(process.argv[3] ?? "bench-out/openrouter-steering");
const port = Number(process.argv[4] ?? 27965);
assert.notEqual(port, 7717); assert.notEqual(port + 1, 7717);
assert.ok(process.env.OPENROUTER_API_KEY);
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}`, proxyBase = `http://127.0.0.1:${port + 1}`;
const room = "openrouter-steering-bench";
const model = "anthropic/claude-opus-5.5";
const values = [11, 13, 17, 19, 23, 29];
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const hub = spawn(process.execPath, [resolve(build, "dist/index.js")], {
  cwd: build, env: { ...process.env, PORT: String(port), CHATROOM_SPAWN_DRY: "1", CHATROOM_DATA_DIR: resolve(out, "data"), CHATROOM_INSECURE_LOCAL: "1" },
  stdio: ["ignore", "ignore", "pipe"],
});
let hubLog = "", seatLog = "";
hub.stderr.on("data", data => { hubLog += data; });
process.on("exit", () => hub.kill());
for (let i = 0; ; i++) {
  try { await fetch(base); break; } catch { if (i > 100) throw new Error("hub startup failed"); await pause(100); }
}
const peer = new Client({ name: "bench-peer", version: "1" });
await peer.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
const call = async (name: string, args: object) => {
  const result = await peer.callTool({ name, arguments: args as Record<string, unknown> });
  assert.ok(!result.isError, JSON.stringify(result));
  return JSON.parse((result.content as { text: string }[])[0].text);
};
await call("join_room", { room, name: "peer", agent: "script", expected_participants: 0, topic: "Sum six local readings and answer the peer." });
let mention: { id: string; seq: number } | undefined, mentionAt = 0, completedWork = 0;
const usage: any[] = [], toolCalls: any[] = [], requests: any[] = [];
const results = new Map<string, { name: string; bytes: number }>();
const names = new Map<string, string>();
const proxy = createServer(async (req, res) => {
  try {
    const step = /^\/work\/(\d+)$/.exec(req.url ?? "");
    if (step) {
      const n = Number(step[1]);
      if (n === 2 && !mention) {
        mention = await call("send_message", { room, content: "@worker What is 17*3? Reply as soon as you see this, even while the local work continues.", force: true });
        mentionAt = Date.now();
      }
      await pause(2500); completedWork++;
      res.writeHead(200, { "content-type": "text/plain" }); res.end(`reading ${n}: ${values[n - 1]}`); return;
    }
    assert.equal(req.url, "/chat/completions");
    let raw = ""; for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw);
    for (const message of request.messages) if (message.role === "tool" && !results.has(message.tool_call_id)) {
      results.set(message.tool_call_id, { name: names.get(message.tool_call_id) ?? "unknown", bytes: Buffer.byteLength(message.content) });
    }
    const at = Date.now();
    requests.push({ at, messages: request.messages });
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      body: raw, signal: AbortSignal.timeout(120_000),
    });
    const body = await response.text();
    const parsed = JSON.parse(body);
    if (parsed.usage) usage.push(parsed.usage);
    for (const tool of parsed.choices?.[0]?.message?.tool_calls ?? []) {
      names.set(tool.id, tool.function.name);
      toolCalls.push({ at: Date.now(), completedWork, ...tool });
    }
    res.writeHead(response.status, { "content-type": "application/json" }); res.end(body);
  } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: { message: String(e) } })); }
});
await new Promise<void>(resolve => proxy.listen(port + 1, "127.0.0.1", resolve));
const prompt = [
  `You are worker in room ${room}. First join_room as worker (agent=openrouter).`,
  `Read six local measurements by calling web_fetch once each on ${proxyBase}/work/1 through ${proxyBase}/work/6, in ascending order. Use six separate model steps; do not batch the calls. Sum the six returned integers. Do not call room tools during the readings unless you have a reason.`,
  "If someone addresses you, answer immediately with send_message using reply_to, then continue the readings.",
  `After reading all six, call wait_for_messages(room=${room},timeout_ms=0) once, answer any unanswered peer request, send_message the total exactly as TOTAL=<integer>, and leave_room. Do not propose, recruit, use the board, or inspect files.`,
].join("\n");
const started = Date.now();
const seat = spawn(process.execPath, [resolve(build, "dist/openrouter.js"), "--mcp-url", `${base}/mcp?seat=bench-worker`, "--model", model, "--max-minutes", "4", "--max-steps", "30", "--no-handoff", "--no-shell", "--usage-sidecar", resolve(out, "worker.usage.json")], {
  cwd: build, env: { ...process.env, OPENROUTER_BASE_URL: proxyBase }, stdio: ["pipe", "pipe", "pipe"],
});
seat.stdin.end(prompt); seat.stdout.on("data", data => { seatLog += data; }); seat.stderr.on("data", data => { seatLog += data; });
process.on("exit", () => seat.kill());
const timer = setTimeout(() => seat.kill(), 300_000);
try {
  const exit = await new Promise<number | null>(resolve => seat.once("close", resolve)); clearTimeout(timer);
  const messages = await (await fetch(`${base}/rooms/${room}/messages`)).json() as any[];
  const reply = messages.find(message => message.from?.name === "worker" && message.replyTo === mention?.id);
  const replyCall = toolCalls.find(tool => tool.function.name === "send_message" && JSON.parse(tool.function.arguments).reply_to === mention?.id);
  const stats = await (await fetch(`${base}/rooms/${room}/stats`)).json();
  let gitHead = "archive"; try { gitHead = execFileSync("git", ["-C", build, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {}
  const report = {
    build, gitHead, model, room, exit, wall_ms: Date.now() - started,
    hub_sha256: createHash("sha256").update(readFileSync(resolve(build, "dist/index.js"))).digest("hex"),
    seat_sha256: createHash("sha256").update(readFileSync(resolve(build, "dist/seat.js"))).digest("hex"),
    brief_sha256: createHash("sha256").update(prompt.replaceAll(proxyBase, "LOCAL_FIXTURE")).digest("hex"),
    calls: toolCalls.length, calls_by_tool: Object.fromEntries([...new Set(toolCalls.map(t => t.function.name))].map(name => [name, toolCalls.filter(t => t.function.name === name).length])),
    tool_response_bytes: [...results.values()].reduce((sum, result) => sum + result.bytes, 0),
    prompt_tokens: usage.reduce((sum, u) => sum + (u.prompt_tokens ?? 0), 0),
    cache_read_tokens: usage.reduce((sum, u) => sum + (u.prompt_tokens_details?.cached_tokens ?? 0), 0),
    output_tokens: usage.reduce((sum, u) => sum + (u.completion_tokens ?? 0), 0),
    mention_at: mentionAt, reply_at: reply?.ts, mention_to_reply_ms: reply ? Date.parse(reply.ts) - mentionAt : null,
    completed_work_at_reply: replyCall?.completedWork, reply_rate: reply ? 1 : 0,
    oracle: messages.some(message => message.from?.name === "worker" && /TOTAL=112\b/.test(message.content)) && /51/.test(reply?.content ?? ""), stats,
  };
  writeFileSync(resolve(out, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, "trace.json"), JSON.stringify({ toolCalls, toolResults: [...results], usage, requests }, null, 2));
  writeFileSync(resolve(out, "brief.txt"), prompt); writeFileSync(resolve(out, "worker.log"), seatLog); writeFileSync(resolve(out, "hub.log"), hubLog);
  console.log(JSON.stringify({ ...report, stats: undefined }));
} finally {
  clearTimeout(timer); seat.kill();
  await (peer.transport as { terminateSession?: () => Promise<void> })?.terminateSession?.(); await peer.close();
  proxy.closeAllConnections(); proxy.close(); hub.kill();
}
