import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { runSeat, type Msg, type ToolCall } from "../src/seat.js";
import { retainWaitView } from "../src/seat/wait-view.js";

// The MCP and heartbeat endpoints are a transport fixture; runSeat and its local tools are real.
for (const scenario of ["keyed", "participant", "provider-failure", "trim", "idle-threshold", "compact-wait"]) {
  const compact = scenario === "compact-wait";
  const keyed = scenario !== "participant";
  const app = express(); app.use(express.json());
  const server = new McpServer({ name: "steering-fixture", version: "1" });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  const calls: string[] = [], acked = new Set<string>();
  let working = false, ackAttempts = 0, joined = false, step = 0;
  let waits = 0;
  server.registerTool("wait_for_messages", { inputSchema: { room: z.string() } }, async () => {
    calls.push("wait_for_messages");
    const view = waits++ === 0
      ? { hint: "No new messages yet.", messages: ["prior chatter"], board_keys: ["claim/work"], active_participants: ["worker", "peer"], open_proposal: { id: "p", version: 2, text: "full proposal", blocked_by: ["peer vote"] }, next_seq: 7 }
      : { hint: "No new messages yet.", messages: [], unchanged: true, open_proposal: { id: "p", version: 2, unchanged: true }, next_seq: 9 };
    return { content: [{ type: "text", text: JSON.stringify(view) }] };
  });
  server.registerTool("join_room", { inputSchema: { room: z.string(), name: z.string() } }, async () => {
    joined = true; calls.push("join_room");
    return { content: [{ type: "text", text: JSON.stringify({ participant_id: "p-seat", hint: "join hint" }) }] };
  });
  server.registerTool("send_message", { inputSchema: { room: z.string(), reply_to: z.string() } }, async () => {
    calls.push("send_message"); return { content: [{ type: "text", text: "{}" }] };
  });
  server.registerTool("leave_room", { inputSchema: { room: z.string() } }, async () => {
    calls.push("leave_room"); return { content: [{ type: "text", text: "{}" }] };
  });
  const pending = () => working && !acked.has("ask-1") ? [{ id: "ask-1", room: "steering", from: "peer", text: "Please report the local result." }] : [];
  const beat: express.RequestHandler = (req, res) => {
    if (keyed) assert.equal(req.body.seat_key, "private-key");
    else assert.equal(req.body.participant_id, "p-seat");
    res.json({ ok: true, pending: [...pending(), { id: "foreign", room: "foreign", from: "peer", text: "MUST NOT INJECT" }] });
  };
  app.post(keyed ? "/heartbeat" : "/rooms/steering/heartbeat", beat);
  app.post(keyed ? "/steer/ack" : "/rooms/steering/steer/ack", (req, res) => {
    ackAttempts++;
    assert.ok(step >= 3, "never ack before the provider has received the injected message");
    if (keyed) assert.equal(req.body.seat_key, "private-key");
    else { assert.equal(req.body.participant_id, "p-seat"); assert.equal(req.body.room, "steering"); }
    if (ackAttempts === 1) { res.sendStatus(503); return; }
    for (const id of req.body.ids) acked.add(id);
    res.json({ ok: true });
  });
  app.get("/work", (_req, res) => { assert.ok(joined); working = true; res.send("local work complete"); });
  app.all("/mcp", async (req, res) => { await transport.handleRequest(req, res, req.method === "POST" ? req.body : undefined); });
  await server.connect(transport);
  const http = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => http.once("listening", resolve));
  const port = (http.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}`;
  const tool = (name: string, args: object): ToolCall => ({ id: randomUUID(), type: "function", function: { name, arguments: JSON.stringify(args) } });
  const checkOrder = (messages: Msg[]) => {
    let outstanding: string[] = [];
    for (const message of messages) {
      if (message.role === "assistant" && message.tool_calls?.length) outstanding = message.tool_calls.map(call => call.id);
      else if (message.role === "tool") outstanding = outstanding.filter(id => id !== message.tool_call_id);
      else assert.deepEqual(outstanding, [], "user hints/steering must follow ALL results in a tool batch");
    }
    assert.deepEqual(outstanding, []);
  };
  try {
    const result = await runSeat({ label: "scripted-steering", async complete(messages) {
      step++; checkOrder(messages);
      const userText = messages.filter(m => m.role === "user").map(m => m.content).join("\n");
      assert.ok(!userText.includes("MUST NOT INJECT"));
      if (!compact && (step === 3 || (step >= 3 && scenario !== "trim"))) assert.equal(userText.split("Please report the local result.").length - 1, 1, "mention arrives once without wait/read");
      if (compact && step === 3) {
        const result = JSON.parse([...messages].reverse().find(message => message.role === "tool")!.content!);
        assert.deepEqual(result.board_keys, ["claim/work"], "absorbed full board reaches the model");
        assert.deepEqual(result.active_participants, ["worker", "peer"]);
        assert.equal(result.open_proposal.text, "full proposal"); assert.deepEqual(result.open_proposal.blocked_by, ["peer vote"]);
        assert.deepEqual(result.messages, ["prior chatter"]); assert.equal(result.next_seq, 9);
      }
      if (step === 3 && scenario === "provider-failure") throw new Error("inference rejected");
      const toolCalls = step === 1 ? [tool("join_room", { room: "steering", name: "seat" }), tool("list_dir", {})]
        : step === 2 ? compact ? [tool("wait_for_messages", { room: "steering" })] : [tool("web_fetch", { url: `${url}/work` }), tool("list_dir", {})]
        : step === 3 ? compact ? [tool("leave_room", { room: "steering" })] : [tool("send_message", { room: "steering", reply_to: "ask-1" })]
        : compact ? []
        : step === 4 ? [tool("leave_room", { room: "steering" })] : [];
      return { content: toolCalls.length ? "" : "done", toolCalls };
    } }, { prompt: "Run the local work and answer peer messages.", cwd: process.cwd(), mcpUrl: `${url}/mcp${keyed ? "?seat=private-key&worktree=%2Ftmp%2Fseat" : ""}`, shell: false, maxSteps: 6,
      noHandoff: scenario !== "idle-threshold", handoffIdleTurns: 1, handoffStepMax: 100, maxContextChars: scenario === "trim" ? 300 : 240_000, log: () => {} });
    const failed = scenario === "provider-failure";
    assert.equal(result.ok, !failed, result.final);
    assert.deepEqual(calls.filter(name => name !== "leave_room"), compact ? ["join_room", "wait_for_messages", "wait_for_messages", "wait_for_messages"] : failed ? ["join_room"] : ["join_room", "send_message"], "steering adds no model-visible hub reads");
    assert.equal(calls.filter(name => name === "leave_room").length, 1, "the seat leaves once after success or provider failure");
    assert.equal(ackAttempts, failed || compact ? 0 : 2, "failed ACK retries; rejected inference never acknowledges");
    assert.deepEqual([...acked], failed || compact ? [] : ["ask-1"]);
    console.log(`SEAT STEERING ${scenario} OK`);
  } finally {
    await server.close();
    http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve()));
  }
}

const full = JSON.stringify({ openings: { revealed: false }, open_proposal: { id: "old", version: 1, text: "old body" }, messages: [] });
const replacement = JSON.stringify({ open_proposal: null, messages: [] });
assert.equal(retainWaitView(full, replacement), replacement, "a full replacement removes stale optional fields");
const changedReference = JSON.parse(retainWaitView(full, JSON.stringify({ unchanged: true, open_proposal: { id: "new", version: 1, unchanged: true }, messages: [] })));
assert.equal(changedReference.open_proposal.text, undefined, "never attach the wrong proposal body");
