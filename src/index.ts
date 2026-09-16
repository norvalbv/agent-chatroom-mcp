#!/usr/bin/env node
/**
 * Entrypoint: one long-running process that every agent connects to over
 * Streamable HTTP (MCP endpoint at /mcp). A single Hub is shared by all
 * sessions, which is what makes it a chatroom rather than N private servers.
 *
 * Also exposes tiny read-only JSON endpoints so a human can watch:
 *   GET /rooms                      -> room summaries
 *   GET /rooms/:room/messages?since=0
 *   GET /rooms/:room/transcript     -> plain text
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { Hub, HubError } from "./hub.js";
import { createSessionServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 7717);
const HOST = process.env.HOST ?? "127.0.0.1";
const DATA_DIR = process.env.CHATROOM_DATA_DIR ? resolve(process.env.CHATROOM_DATA_DIR) : undefined;

const hub = new Hub({ dataDir: DATA_DIR });
const app = createMcpExpressApp({ host: HOST });
app.use(express.json({ limit: "2mb" }));

const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", async (req, res) => {
  const sessionId = req.header("mcp-session-id");
  let transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    if (sessionId) {
      res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unknown session; re-initialize." }, id: null });
      return;
    }
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport!);
      },
    });
    transport.onclose = () => {
      if (transport?.sessionId) transports.delete(transport.sessionId);
    };
    await createSessionServer(hub).connect(transport);
  }
  await transport.handleRequest(req, res, req.body);
});

const sessionRoute = async (req: express.Request, res: express.Response) => {
  const transport = transports.get(req.header("mcp-session-id") ?? "");
  if (!transport) {
    res.status(400).send("Missing or unknown mcp-session-id");
    return;
  }
  await transport.handleRequest(req, res);
};
app.get("/mcp", sessionRoute);
app.delete("/mcp", sessionRoute);

// ---- human-facing read-only endpoints ----
app.get("/", (_req, res) => res.json({ name: "agent-chatroom-mcp", mcp: "/mcp", rooms: "/rooms", sessions: transports.size }));
app.get("/rooms", (_req, res) => res.json(hub.listRooms()));
app.get("/rooms/:room", (req, res) => {
  try {
    res.json(hub.summary(hub.getRoom(req.params.room)));
  } catch (e) {
    res.status(404).send(e instanceof HubError ? e.message : String(e));
  }
});
app.get("/rooms/:room/messages", (req, res) => {
  try {
    res.json(hub.read(req.params.room, Number(req.query.since ?? 0), Number(req.query.limit ?? 500)));
  } catch (e) {
    res.status(404).send(e instanceof HubError ? e.message : String(e));
  }
});
app.get("/rooms/:room/transcript", (req, res) => {
  try {
    const r = hub.getRoom(req.params.room);
    res.type("text/plain").send(
      `# ${r.name}\nTopic: ${r.topic}\nState: ${r.state}${r.conclusion ? `\nConclusion: ${r.conclusion.text}` : ""}\n\n` +
        r.messages.map((m) => `#${m.seq} [${m.ts}] ${m.from.name} (${m.kind}): ${m.content}`).join("\n") + "\n",
    );
  } catch (e) {
    res.status(404).send(e instanceof HubError ? e.message : String(e));
  }
});

app.listen(PORT, HOST, () => {
  console.error(`agent-chatroom-mcp listening on http://${HOST}:${PORT}/mcp${DATA_DIR ? ` (persisting to ${DATA_DIR})` : " (in-memory)"}`);
});
