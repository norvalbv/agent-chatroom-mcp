#!/usr/bin/env node
/**
 * Entrypoint: one long-running process that every agent connects to over
 * Streamable HTTP (MCP endpoint at /mcp). A single Hub is shared by all
 * sessions, which is what makes it a chatroom rather than N private servers.
 *
 * Also exposes a live dashboard and JSON endpoints so humans can watch and interject:
 *   GET  /ui                          -> dashboard
 *   GET  /rooms                       -> room summaries (real names, even in anonymous rooms)
 *   GET  /rooms/:room/messages?since=0
 *   GET  /rooms/:room/transcript      -> plain text
 *   GET  /rooms/:room/stats
 *   POST /rooms/:room/messages {name, content} -> speak as a human participant
 *   POST /rooms/:room/vote {name, proposal_id, vote, reason} -> human vote (disagree = veto)
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { Hub, HubError } from "./hub.js";
import { createSessionServer } from "./server.js";
import { UI_HTML } from "./ui.js";

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

// ---- human-facing endpoints ----
const notFound = (res: express.Response, e: unknown) => res.status(404).send(e instanceof HubError ? e.message : String(e));
app.get("/", (_req, res) => res.json({ name: "agent-chatroom-mcp", mcp: "/mcp", ui: "/ui", rooms: "/rooms", sessions: transports.size }));
app.get("/ui", (_req, res) => res.type("html").send(UI_HTML));
app.get("/rooms", (_req, res) => res.json(hub.listRooms(true)));
app.get("/rooms/:room", (req, res) => {
  try {
    res.json(hub.summary(hub.getRoom(req.params.room), true));
  } catch (e) {
    notFound(res, e);
  }
});
app.get("/rooms/:room/stats", (req, res) => {
  try {
    res.json(hub.stats(hub.getRoom(req.params.room)));
  } catch (e) {
    notFound(res, e);
  }
});
app.get("/rooms/:room/messages", (req, res) => {
  try {
    res.json(hub.read(req.params.room, Number(req.query.since ?? 0), Number(req.query.limit ?? 500)));
  } catch (e) {
    notFound(res, e);
  }
});
// A human interjecting from the dashboard or curl. Humans bypass budgets and the stale-send guard.
app.post("/rooms/:room/messages", (req, res) => {
  try {
    const { name, content } = (req.body ?? {}) as { name?: string; content?: string };
    const { participant } = hub.join(req.params.room, (name || "human").trim(), "human");
    const m = hub.send(req.params.room, participant.id, String(content ?? ""), undefined, true);
    res.json(m);
  } catch (e) {
    res.status(400).send(e instanceof HubError ? e.message : String(e));
  }
});
// A human voting from the dashboard: agree is advisory, disagree vetoes.
app.post("/rooms/:room/vote", (req, res) => {
  try {
    const { name, proposal_id, vote, reason } = (req.body ?? {}) as { name?: string; proposal_id?: string; vote?: "agree" | "disagree" | "abstain"; reason?: string };
    const { participant } = hub.join(req.params.room, (name || "human").trim(), "human");
    const pr = hub.vote(req.params.room, participant.id, String(proposal_id), vote ?? "abstain", reason);
    res.json(hub.proposalView(hub.getRoom(req.params.room), pr, true));
  } catch (e) {
    res.status(400).send(e instanceof HubError ? e.message : String(e));
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
    notFound(res, e);
  }
});

app.listen(PORT, HOST, () => {
  console.error(`agent-chatroom-mcp: MCP at http://${HOST}:${PORT}/mcp, dashboard at http://${HOST}:${PORT}/ui${DATA_DIR ? ` (persisting to ${DATA_DIR})` : " (in-memory)"}`);
});
