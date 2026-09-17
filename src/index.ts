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

const HUMAN_TOKEN = process.env.CHATROOM_HUMAN_TOKEN; // optional shared secret for the human POST routes
const MAX_SESSIONS = 500;
const SESSION_IDLE_MS = 30 * 60_000;
const PARTICIPANT_IDLE_MS = 10 * 60_000;

const hub = new Hub({ dataDir: DATA_DIR });
const app = createMcpExpressApp({ host: HOST }); // already parses JSON bodies (100kb)

const transports = new Map<string, { t: StreamableHTTPServerTransport; leaveAll: () => void; lastSeen: number }>();

app.post("/mcp", async (req, res) => {
  const sessionId = req.header("mcp-session-id");
  const entry = sessionId ? transports.get(sessionId) : undefined;
  if (entry) {
    entry.lastSeen = Date.now();
    await entry.t.handleRequest(req, res, req.body);
    return;
  }
  if (sessionId) {
    res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unknown session; re-initialize." }, id: null });
    return;
  }
  if (transports.size >= MAX_SESSIONS) {
    res.status(503).type("text/plain").send("Too many sessions");
    return;
  }
  const session = createSessionServer(hub);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      transports.set(id, { t: transport, leaveAll: session.leaveAll, lastSeen: Date.now() });
    },
  });
  transport.onclose = () => {
    session.leaveAll();
    if (transport.sessionId) transports.delete(transport.sessionId);
  };
  await session.server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const sessionRoute = async (req: express.Request, res: express.Response) => {
  const entry = transports.get(req.header("mcp-session-id") ?? "");
  if (!entry) {
    res.status(400).type("text/plain").send("Missing or unknown mcp-session-id");
    return;
  }
  entry.lastSeen = Date.now();
  await entry.t.handleRequest(req, res);
};

// Liveness: close idle MCP sessions and mark silent agents as left, so a dead process cannot block a quorum forever.
setInterval(() => {
  const now = Date.now();
  for (const [id, e] of transports) {
    if (now - e.lastSeen > SESSION_IDLE_MS) {
      e.leaveAll();
      e.t.close().catch(() => {});
      transports.delete(id);
    }
  }
  hub.sweepIdle(PARTICIPANT_IDLE_MS);
}, 60_000).unref();

const requireToken = (req: express.Request, res: express.Response): boolean => {
  if (!HUMAN_TOKEN || req.header("x-chatroom-token") === HUMAN_TOKEN) return true;
  res.status(401).type("text/plain").send("x-chatroom-token required");
  return false;
};
app.get("/mcp", sessionRoute);
app.delete("/mcp", sessionRoute);

// ---- human-facing endpoints ----
const notFound = (res: express.Response, e: unknown) => res.status(404).type("text/plain").send(e instanceof HubError ? e.message : "error");
app.get("/", (_req, res) => res.json({ name: "agent-chatroom-mcp", mcp: "/mcp", ui: "/ui", rooms: "/rooms", sessions: transports.size }));
app.get("/ui", (_req, res) => res.type("html").send(UI_HTML));
app.get("/config", (_req, res) => res.json({ human_token_required: Boolean(HUMAN_TOKEN) }));
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
  if (!requireToken(req, res)) return;
  try {
    const { name, content } = (req.body ?? {}) as { name?: string; content?: string };
    const { participant } = hub.join(req.params.room, (name || "human").trim(), "human");
    const m = hub.send(req.params.room, participant.id, String(content ?? ""), undefined, true);
    res.json(m);
  } catch (e) {
    res.status(400).type("text/plain").send(e instanceof HubError ? e.message : "error");
  }
});
// A human voting from the dashboard: agree is advisory, disagree vetoes.
app.post("/rooms/:room/vote", (req, res) => {
  if (!requireToken(req, res)) return;
  try {
    const { name, proposal_id, vote, reason } = (req.body ?? {}) as { name?: string; proposal_id?: string; vote?: "agree" | "disagree" | "abstain"; reason?: string };
    const { participant } = hub.join(req.params.room, (name || "human").trim(), "human");
    const pr = hub.vote(req.params.room, participant.id, String(proposal_id), vote ?? "abstain", reason);
    res.json(hub.proposalView(hub.getRoom(req.params.room), pr, true));
  } catch (e) {
    res.status(400).type("text/plain").send(e instanceof HubError ? e.message : "error");
  }
});
app.get("/rooms/:room/transcript", (req, res) => {
  try {
    const r = hub.getRoom(req.params.room);
    res.type("text/plain").send(
      `# ${r.name}\nTopic: ${r.topic.replace(/\n/g, "\n    ")}\nState: ${r.state}${r.conclusion ? `\nConclusion: ${r.conclusion.text.replace(/\n/g, "\n    ")}` : ""}\n\n` +
        r.messages.map((m) => `#${m.seq} [${m.ts}] ${m.from.name} (${m.kind}): ${m.content.replace(/\n/g, "\n    ")}`).join("\n") + "\n",
    );
  } catch (e) {
    notFound(res, e);
  }
});

app.listen(PORT, HOST, () => {
  console.error(`agent-chatroom-mcp: MCP at http://${HOST}:${PORT}/mcp, dashboard at http://${HOST}:${PORT}/ui${DATA_DIR ? ` (persisting to ${DATA_DIR})` : " (in-memory)"}`);
});
