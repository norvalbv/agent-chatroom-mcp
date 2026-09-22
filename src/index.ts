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
import { parseReplyWindowMinutes } from "./reply-metrics.js";
import { createSessionServer } from "./server.js";
import { Spawner, type RecruitPolicy } from "./spawner.js";
import { UI_HTML } from "./ui.js";
import { loadDotEnv } from "./env.js";
// Item 2 (swarm-125438-jp20): CHATROOM_NO_RECRUIT=1 marks a hub that must never hold a provider key
// (a benchmark hub, whose caller already stripped API_KEY/TOKEN/SECRET-shaped vars from this process's
// env before spawning it). A bare loadDotEnv() call would otherwise silently refill those vars from the
// repo's gitignored .env, undoing that stripping; src/spawner.ts also refuses every request_agent
// outright under the same flag, so this is defense in depth, not the only guard.
loadDotEnv(undefined, process.env.CHATROOM_NO_RECRUIT === "1" ? { excludePattern: /API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i } : {}); // a gitignored .env fills in OPENROUTER_API_KEY etc. when the hub was started without it

const PORT = Number(process.env.PORT ?? 7717);
const HOST = process.env.HOST ?? "127.0.0.1";
const DATA_DIR = process.env.CHATROOM_DATA_DIR ? resolve(process.env.CHATROOM_DATA_DIR) : undefined;

const HUMAN_TOKEN = process.env.CHATROOM_HUMAN_TOKEN; // optional shared secret for the human POST routes
// Controller authority fails closed: with no token the human POST routes refuse, unless the operator explicitly
// opts into insecure loopback-only operation (CHATROOM_INSECURE_LOCAL=1 with a loopback HOST) — the dashboard's
// localhost case. Remote binds never unlock the controller without a token.
const INSECURE_LOCAL = process.env.CHATROOM_INSECURE_LOCAL === "1";
const LOOPBACK_HOST = HOST === "127.0.0.1" || HOST === "localhost" || HOST === "::1";
const MAX_SESSIONS = 500;
const SESSION_IDLE_MS = 30 * 60_000;
const PARTICIPANT_IDLE_MS = 10 * 60_000;

const hub = new Hub({ dataDir: DATA_DIR, cwd: resolve(process.env.CHATROOM_DEFAULT_CWD ?? process.cwd()) });
// At boot no MCP session exists, so every participant idle for longer than the sweep window is a leftover of the
// previous process (e.g. a seat killed by hand whose session DELETE never arrived); mark them left now.
for (const name of hub.sweepIdle(PARTICIPANT_IDLE_MS, new Set())) console.error(`boot sweep: ${name} marked as left`);
const spawner = new Spawner({
  mcpUrl: `http://${HOST}:${PORT}/mcp`,
  defaultCwd: resolve(process.env.CHATROOM_DEFAULT_CWD ?? process.cwd()),
  logDir: resolve(process.env.CHATROOM_LOG_DIR ?? "logs/spawned"),
  dryRun: process.env.CHATROOM_SPAWN_DRY === "1",
  // a fleet of a hundred read-only seats is a legitimate machine-wide count; the default 24 was sized for one run
  maxLive: process.env.CHATROOM_MAX_LIVE_AGENTS ? Number(process.env.CHATROOM_MAX_LIVE_AGENTS) : undefined,
});
// a child break-out room concludes when its own hub state transitions, possibly before its seat
// process exits (heartbeat-as-liveness keeps the seat alive); the concluded event, not process
// close, is what must trigger the lobby's consolidator seat (lobby item 3)
hub.onRoomState = (room, state) => {
  if (state !== "concluded") return;
  try {
    spawner.checkConsolidators();
  } catch (e) {
    // a refused consolidator spawn (cap/depth/held lobby) must never break the vote that concluded the
    // child room: announce and swallow, mirroring the child-close handler in spawner.ts
    hub.announce(room, `Consolidator spawn check failed: ${(e as Error).message}`);
  }
};
spawner.attach({
  isHeld: (room) => {
    try {
      return Boolean(hub.hold(hub.getRoom(room)));
    } catch {
      return false;
    }
  },
  claimArea: (room, requester, area, team) => {
    const r = hub.getRoom(room);
    const existing = r.board.get(`claim/${area}`);
    if (existing && existing.by !== requester) throw new HubError(`claim/${area} is owned by ${existing.by}; recruit into their team instead.`);
    hub.setBoardAs(room, requester, `claim/${area}`, JSON.stringify({ area, owner: requester, team: [requester, ...team], status: "open", note: "claimed at recruitment" }));
  },
  ensureRoom: (room, topic) => {
    hub.createRoom(room, { topic, requireChallenge: true, requireVerification: true, expectedParticipants: 0 });
  },
  announce: (room, text) => {
    try {
      hub.announce(room, text);
    } catch {}
  },
  liveAgents: () => [...hub.rooms.values()].filter((r) => r.state === "open" || r.state === "stalled").reduce((n, r) => n + hub.voters(r).length, 0),
  roomTopic: (room) => hub.rooms.get(room)?.topic,
  roomState: (room) => {
    try {
      return hub.getRoom(room).state;
    } catch {
      return undefined;
    }
  },
  openProposal: (room) => {
    try {
      return [...hub.getRoom(room).proposals.values()].some((p) => p.status === "open");
    } catch {
      return false;
    }
  },
  heartbeatSeat: (seatKey, info) => { hub.heartbeatSeat(seatKey, info); },
  registerReplacement: (room, predecessor, successorName) => {
    const old = [...hub.getRoom(room).participants.values()].find(p => p.name === predecessor);
    // A recruit may replace a departed agent, never declare another live seat or human departed.
    if (!old || old.active || old.agent === "human" || old.role === "chair") throw new HubError("Recruit replacement requires a departed nonhuman, non-chair participant.");
    return hub.registerReplacement(room, predecessor, successorName).replacementToken;
  },
  removeParticipant: (room, target, by, reason) => {
    hub.removeParticipant(room, target, by, reason);
  },
  // Item 2 guardrail: an agent may only replace a target that is already gone or has been quiet a
  // while; a human (dashboard) is trusted unconditionally. lastSeen/staleMs, not just active/kicked,
  // is what lets Spawner.replace tell "dead enough" from "live colleague, use kick_vote".
  targetStatus: (room, target) => {
    const p = [...hub.getRoom(room).participants.values()].find((x) => x.name === target);
    if (!p) return undefined;
    // identity is the connection: a seat whose MCP session is still open is alive however long its current
    // command runs (heartbeats fire at call start only), so an agent may not replace it on staleness alone
    const connected = !!p.session && [...transports.values()].some((e) => e.session === p.session);
    return { active: p.active, kicked: !!p.kicked, staleMs: Date.now() - Date.parse(hub.lastSeen(p)), connected };
  },
  // Item 2: what the predecessor was doing, for the successor's brief -- their own claim/* and handoff/*
  // entries plus the keys of any open inbox/* notices in the room, so nothing is silently dropped. A kick
  // already rewrote claim/* as {..., status:"released", released_from: name} (by becomes "system");
  // either shape is theirs.
  predecessorContext: (room, name) => {
    const board = hub.getRoom(room).board;
    const isTheirs = (e: { by: string; text: string }) => {
      if (e.by === name) return true;
      try { return (JSON.parse(e.text) as { released_from?: string }).released_from === name; } catch { return false; }
    };
    const own = [...board.entries()].filter(([k, e]) => (k.startsWith("claim/") || k.startsWith("handoff/")) && isTheirs(e));
    const inboxKeys = [...board.keys()].filter((k) => k.startsWith("inbox/"));
    const parts = own.map(([k, e]) => `${k}: ${e.text}`);
    if (inboxKeys.length) parts.push(`Open room inbox/* keys (board_get to read): ${inboxKeys.join(", ")}`);
    return parts.join("\n\n").slice(0, 4000);
  },
});
process.on("exit", () => spawner.stopAll());
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
const app = createMcpExpressApp({ host: HOST }); // already parses JSON bodies (100kb)

const transports = new Map<string, { t: StreamableHTTPServerTransport; leaveAll: () => void; session: string; lastSeen: number }>();

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
  const session = createSessionServer(hub, spawner);
  // a launched seat's MCP URL carries ?seat=<key>; its tool hook heartbeats with the same key (POST /heartbeat)
  const seatKey = typeof req.query.seat === "string" ? req.query.seat.slice(0, 100) : "";
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      transports.set(id, { t: transport, leaveAll: session.leaveAll, session: session.sessionKey, lastSeen: Date.now() });
      if (seatKey) hub.bindSeat(seatKey, session.sessionKey);
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
  // identity is the connection: a participant whose MCP session is still open is alive however long it works locally;
  // the sweep is for sessions that died without a DELETE (a killed CLI), which leaveAll above has not yet seen
  const connected = new Set([...transports.values()].map((e) => e.session));
  for (const name of hub.sweepIdle(PARTICIPANT_IDLE_MS, connected)) spawner.stop(name);
}, 60_000).unref();

const requireToken = (req: express.Request, res: express.Response): boolean => {
  if (HUMAN_TOKEN) {
    if (req.header("x-chatroom-token") === HUMAN_TOKEN) return true;
    res.status(401).type("text/plain").send("x-chatroom-token required");
    return false;
  }
  // No token configured: refuse by default; only the explicit loopback opt-in restores local dashboard use.
  if (INSECURE_LOCAL && LOOPBACK_HOST) return true;
  res.status(403).type("text/plain").send("controller authority closed: set CHATROOM_HUMAN_TOKEN, or CHATROOM_INSECURE_LOCAL=1 with HOST on loopback");
  return false;
};
app.get("/mcp", sessionRoute);
app.delete("/mcp", sessionRoute);

// ---- human-facing endpoints ----
const notFound = (res: express.Response, e: unknown) => res.status(404).type("text/plain").send(e instanceof HubError ? e.message : "error");
app.get("/", (_req, res) => res.json({ name: "agent-chatroom-mcp", mcp: "/mcp", ui: "/ui", rooms: "/rooms", sessions: transports.size, caps: { max_live_per_room: Hub.MAX_LIVE_PER_ROOM, max_rooms_per_run: Hub.MAX_ROOMS_PER_RUN }, code_state: Hub.codeState(resolve(process.env.CHATROOM_DEFAULT_CWD ?? process.cwd())) ?? null }));
app.get("/ui", (_req, res) => res.type("html").send(UI_HTML));
app.get("/config", (_req, res) => res.json({ human_token_required: Boolean(HUMAN_TOKEN) || !(INSECURE_LOCAL && LOOPBACK_HOST) }));
// Recruit policy: which provider/model every request_agent launches as. Readable by anyone, settable by the human (token if configured).
app.get("/policy", (_req, res) => res.json({ recruits: spawner.policy }));
app.post("/policy", (req, res) => {
  if (!requireToken(req, res)) return;
  const b = (req.body ?? {}) as { agent?: string | null; model?: string | null };
  const agent = b.agent === null || b.agent === "any" || b.agent === "" ? undefined : b.agent;
  if (agent && !["claude", "codex", "openrouter"].includes(agent)) {
    res.status(400).type("text/plain").send("agent must be claude, codex, openrouter or any");
    return;
  }
  spawner.policy = { agent: agent as RecruitPolicy["agent"], model: b.model === null || b.model === "any" || b.model === "" ? undefined : b.model ?? undefined };
  res.json({ recruits: spawner.policy });
});
app.get("/agents", (_req, res) => res.json(spawner.agents.map((a) => ({ ...a, brief: a.brief.slice(0, 300) }))));
app.post("/agents/:name/stop", (req, res) => {
  if (!requireToken(req, res)) return;
  res.json({ stopped: spawner.stop(req.params.name) });
});
app.get("/rooms", (req, res) => res.json(hub.listRooms(true, req.query.archived === "1" || req.query.archived === "all")));
// Archive: hide from listings, keep everything. Body {name, archived:false} un-archives. POST /rooms/archive-dead sweeps every room nobody is in.
app.post("/rooms/archive-dead", (req, res) => {
  if (!requireToken(req, res)) return;
  const { name } = (req.body ?? {}) as { name?: string };
  res.json({ archived: hub.archiveDead((name || "human").trim()) });
});
// Seat liveness: the seat process posts its step and current tool; needs only its own participant id.
app.post("/rooms/:room/heartbeat", (req, res) => {
  try {
    const { participant_id, tool, step } = (req.body ?? {}) as { participant_id?: string; tool?: string; step?: number };
    if (!participant_id) return res.status(400).type("text/plain").send("participant_id required");
    const { detail } = (req.body ?? {}) as { detail?: string };
    hub.heartbeat(req.params.room, participant_id, { tool: tool ?? "?", step, detail });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).type("text/plain").send(e instanceof HubError ? e.message : "error");
  }
});
// Seat liveness without a participant id: a claude -p tool hook or a launcher watching codex output knows only the seat
// key its process was launched with; the hub heartbeats every room that key's MCP connection is in.
app.post("/heartbeat", (req, res) => {
  const { seat_key, tool, step, detail } = (req.body ?? {}) as { seat_key?: string; tool?: string; step?: number; detail?: string };
  if (!seat_key) return res.status(400).type("text/plain").send("seat_key required");
  res.json({ ok: true, marked: hub.heartbeatSeat(seat_key, { tool: tool ?? "?", step, detail }) });
});
app.get("/rooms/:room/participants/:name/activity", (req, res) => {
  try {
    res.json(hub.activity(req.params.room, req.params.name));
  } catch (e) {
    notFound(res, e);
  }
});
app.post("/rooms/:room/archive", (req, res) => {
  if (!requireToken(req, res)) return;
  try {
    const { name, archived } = (req.body ?? {}) as { name?: string; archived?: boolean };
    res.json(hub.summary(hub.archiveRoom(req.params.room, (name || "human").trim(), archived !== false), true));
  } catch (e) {
    res.status(400).type("text/plain").send(e instanceof HubError ? e.message : "error");
  }
});
app.get("/rooms/:room", (req, res) => {
  try {
    res.json(hub.summary(hub.getRoom(req.params.room), true));
  } catch (e) {
    notFound(res, e);
  }
});
app.get("/rooms/:room/stats", (req, res) => {
  let replyWindowMinutes: number;
  try {
    replyWindowMinutes = parseReplyWindowMinutes(req.query.reply_window_minutes);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }
  try {
    res.json(hub.stats(hub.getRoom(req.params.room), replyWindowMinutes));
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
    const { participant } = hub.join(req.params.room, (name || "human").trim(), "human", {}, undefined, `http:${name || "human"}`);
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
    const { participant } = hub.join(req.params.room, (name || "human").trim(), "human", {}, undefined, `http:${name || "human"}`);
    const pr = hub.vote(req.params.room, participant.id, String(proposal_id), vote ?? "abstain", reason);
    res.json(hub.proposalView(hub.getRoom(req.params.room), pr, true));
  } catch (e) {
    res.status(400).type("text/plain").send(e instanceof HubError ? e.message : "error");
  }
});
// A human starting or joining a kick vote from the dashboard: same ballot as an agent's; a human keep vetoes.
app.post("/rooms/:room/kick", (req, res) => {
  if (!requireToken(req, res)) return;
  try {
    const { name, target, vote, reason } = (req.body ?? {}) as { name?: string; target?: string; vote?: "kick" | "keep"; reason?: string };
    if (!target) return res.status(400).type("text/plain").send("target required");
    const { participant } = hub.join(req.params.room, (name || "human").trim(), "human", {}, undefined, `http:${name || "human"}`);
    const kv = hub.kickVote(req.params.room, participant.id, String(target), vote === "keep" ? "keep" : "kick", reason);
    res.json(hub.kickView(hub.getRoom(req.params.room), kv, true));
  } catch (e) {
    res.status(400).type("text/plain").send(e instanceof HubError ? e.message : "error");
  }
});
// A human replacing a dead seat from the dashboard: same removal as kick, plus a recruit, in one call.
app.post("/rooms/:room/replace", (req, res) => {
  if (!requireToken(req, res)) return;
  try {
    const { name, target, reason, brief } = (req.body ?? {}) as { name?: string; target?: string; reason?: string; brief?: string };
    if (!target) return res.status(400).type("text/plain").send("target required");
    if (!reason) return res.status(400).type("text/plain").send("reason required");
    const { participant } = hub.join(req.params.room, (name || "human").trim(), "human", {}, undefined, `http:${name || "human"}`);
    const r = hub.getRoom(req.params.room);
    const recs = spawner.replace({ room: req.params.room, requestedBy: participant.name, requestedByShown: hub.shown(r, participant), parentTopic: r.topic, replacing: String(target), reason: String(reason), brief, canEdit: true, requesterIsHuman: true });
    res.json({ spawned: recs.map((x) => x.name), logs: recs.map((x) => x.log) });
  } catch (e) {
    res.status(400).type("text/plain").send(e instanceof HubError ? e.message : "error");
  }
});
// A launcher creates a room with its policy (quorum, verification, expected seats) before any seat joins;
// join_room settings only apply at creation, so without this the first seat to arrive decides the policy.
app.post("/rooms/:room/create", (req, res) => {
  if (!requireToken(req, res)) return;
  try {
    const b = (req.body ?? {}) as { topic?: string; quorum?: "unanimous" | "majority" | "supermajority"; expected_participants?: number; require_verification?: boolean; require_challenge?: boolean; mode?: "free" | "round_robin"; max_message_chars?: number; anonymous?: boolean; chair?: string };
    const existed = hub.listRooms().some((r) => r.name === req.params.room);
    const room = hub.createRoom(req.params.room, { topic: b.topic, quorum: b.quorum, expectedParticipants: b.expected_participants, requireVerification: b.require_verification, requireChallenge: b.require_challenge, mode: b.mode, maxMessageChars: b.max_message_chars, anonymous: b.anonymous, chair: b.chair });
    res.status(existed ? 200 : 201).json({ ...hub.summary(room, true), created: !existed });
  } catch (e) {
    res.status(400).type("text/plain").send(e instanceof HubError ? e.message : "error");
  }
});
// Launcher authority is deliberately separate from optional dashboard authentication.
app.post("/rooms/:room/replacements", (req, res) => {
  const token = process.env.CHATROOM_LAUNCHER_TOKEN;
  if (!token) { res.status(503).json({ error: "Launcher replacement registration is disabled." }); return; }
  if (req.header("x-chatroom-launcher-token") !== token) { res.status(401).json({ error: "Launcher credential required." }); return; }
  const { replacement_of: predecessor, name } = req.body ?? {};
  if (typeof predecessor !== "string" || !predecessor.trim() || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "replacement_of and name must be nonempty strings." }); return;
  }
  try {
    const old = [...hub.getRoom(req.params.room).participants.values()].find(p => p.id === predecessor || p.name === predecessor);
    if (old?.agent === "human" || old?.role === "chair") throw new HubError("Human and chair seats cannot be replaced by the launcher.");
    res.json(hub.registerReplacement(req.params.room, predecessor, name));
  } catch (error) {
    res.status(400).json({ error: error instanceof HubError ? error.message : "Replacement registration failed." });
  }
});
// Close a stale or abandoned room (no conclusion). Dashboard button or curl -X POST .../close
app.post("/rooms/:room/close", (req, res) => {
  if (!requireToken(req, res)) return;
  try {
    const { name, reason } = (req.body ?? {}) as { name?: string; reason?: string };
    res.json(hub.summary(hub.closeRoom(req.params.room, (name || "human").trim(), reason), true));
  } catch (e) {
    res.status(400).type("text/plain").send(e instanceof HubError ? e.message : "error");
  }
});
app.get("/rooms/:room/transcript", (req, res) => {
  try {
    const r = hub.getRoom(req.params.room);
    res.type("text/plain").send(
      `# ${r.name}\nTopic: ${r.topic.replace(/\n/g, "\n    ")}\nState: ${r.state}${r.conclusion ? `\nConclusion: ${r.conclusion.text.replace(/\n/g, "\n    ")}` : ""}\n\n` +
        r.messages.map((m) => `#${m.seq} [${m.ts}] ${m.from.name} (${m.kind}${m.audience ? ` ${m.quiet ? "quiet" : "was-quiet"}→${m.audience.filter((id) => id !== m.from.id).map((id) => r.participants.get(id)?.name ?? id).join(",")}` : ""}): ${m.content.replace(/\n/g, "\n    ")}`).join("\n") + "\n",
    );
  } catch (e) {
    notFound(res, e);
  }
});

app.listen(PORT, HOST, () => {
  console.error(`agent-chatroom-mcp: MCP at http://${HOST}:${PORT}/mcp, dashboard at http://${HOST}:${PORT}/ui${DATA_DIR ? ` (persisting to ${DATA_DIR})` : " (in-memory)"}`);
});
