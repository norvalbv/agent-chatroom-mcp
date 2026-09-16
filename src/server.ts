/**
 * MCP tool surface. One McpServer instance is created per connected client
 * (i.e. per agent), bound to the single shared Hub. The session remembers the
 * agent's participant ids so tools read like a human chat client:
 * join_room -> send_message / wait_for_messages -> propose / vote -> leave_room.
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Hub, HubError, type Message } from "./hub.js";

export const DEFAULT_WAIT_MS = 25_000;
export const MAX_WAIT_MS = 55_000; // stay under typical MCP client tool timeouts (Codex 60s)

const fmt = (m: Message) => {
  const tag = m.kind === "chat" ? "" : `[${m.kind.toUpperCase()}] `;
  return `#${m.seq} ${m.from.name}: ${tag}${m.content}`;
};

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});
const fail = (err: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
});

export function createSessionServer(hub: Hub, sessionLabel = "session"): McpServer {
  const server = new McpServer(
    { name: "agent-chatroom", version: "0.1.0" },
    {
      instructions:
        "A chatroom for AI agents. Typical loop: join_room -> (optionally submit_opening) -> send_message -> " +
        "wait_for_messages (long-polls; call it repeatedly) -> when you think the group agrees, propose -> everyone votes -> " +
        "room_status shows the conclusion. Keep messages short and substantive. Leave with leave_room when done.",
    },
  );

  // participant id per room for this session
  const me = new Map<string, string>();
  const pid = (room: string, override?: string) => {
    const id = override ?? me.get(room);
    if (!id) throw new HubError(`You have not joined "${room}" in this session. Call join_room first.`);
    return id;
  };

  const guard =
    <A>(fn: (args: A) => Promise<unknown> | unknown) =>
    async (args: A) => {
      try {
        return ok(await fn(args));
      } catch (e) {
        return fail(e);
      }
    };

  const roomArg = z.string().describe("Room name, e.g. 'debate-1'.");

  server.registerTool(
    "list_rooms",
    { title: "List rooms", description: "List all chatrooms with participants, state and any conclusion.", inputSchema: {} },
    guard(() => hub.listRooms()),
  );

  server.registerTool(
    "join_room",
    {
      title: "Join a room",
      description:
        "Join (or create) a chatroom under a display name. Returns your participant id, the room status and recent messages. " +
        "Room settings only apply when the room is created by this call.",
      inputSchema: {
        room: roomArg,
        name: z.string().describe("Your display name in the room, e.g. 'claude-1'."),
        agent: z.string().default("unknown").describe("Which kind of agent you are: 'claude', 'codex', 'human', ..."),
        topic: z.string().optional().describe("Topic / question the room should decide (when creating)."),
        mode: z.enum(["free", "round_robin"]).optional().describe("free: anyone may speak any time. round_robin: strict turn order."),
        quorum: z.enum(["unanimous", "majority"]).optional().describe("How many active participants must agree for a proposal to become the conclusion."),
        max_rounds: z.number().int().min(0).optional().describe("round_robin only: after this many rounds the room stalls and falls back to plurality voting."),
        expected_participants: z.number().int().min(0).optional().describe("Blind openings are revealed, and proposals accepted, only once this many have joined."),
        participant_id: z.string().optional().describe("Reclaim an earlier identity after a reconnect."),
      },
    },
    guard(({ room, name, agent, topic, mode, quorum, max_rounds, expected_participants, participant_id }) => {
      const { room: r, participant } = hub.join(room, name, agent, { topic, mode, quorum, maxRounds: max_rounds, expectedParticipants: expected_participants }, participant_id);
      me.set(room, participant.id);
      const recent = r.messages.slice(-30);
      participant.lastSeenSeq = r.messages.at(-1)?.seq ?? 0;
      return {
        participant_id: participant.id,
        you_are: participant.name,
        room: hub.summary(r),
        recent_messages: recent.map(fmt),
        next_seq: participant.lastSeenSeq,
        hint:
          r.expectedParticipants && !r.openingsRevealed
            ? "This room uses blind openings: call submit_opening with your independent first answer before reading others."
            : "Post with send_message, then call wait_for_messages in a loop to hear replies.",
      };
    }),
  );

  server.registerTool(
    "leave_room",
    { title: "Leave a room", description: "Leave a chatroom. Open proposals are re-evaluated without you.", inputSchema: { room: roomArg } },
    guard(({ room }) => {
      hub.leave(room, pid(room));
      me.delete(room);
      return `Left ${room}.`;
    }),
  );

  server.registerTool(
    "send_message",
    {
      title: "Send a message",
      description: "Post a message to the room. Keep it short; say what you think and why. Use reply_to to reference a message id.",
      inputSchema: {
        room: roomArg,
        content: z.string().describe("The message text."),
        reply_to: z.string().optional().describe("Message id (m_...) you are replying to."),
      },
    },
    guard(({ room, content, reply_to }) => {
      const m = hub.send(room, pid(room), content, reply_to);
      return { sent: fmt(m), id: m.id, seq: m.seq };
    }),
  );

  server.registerTool(
    "submit_opening",
    {
      title: "Submit a blind opening statement",
      description:
        "Submit your independent first answer. It is held privately and revealed together with everyone else's once all " +
        "participants have submitted, so nobody anchors on another agent's answer. After it returns, call wait_for_messages.",
      inputSchema: { room: roomArg, content: z.string().describe("Your opening position and reasoning.") },
    },
    guard(({ room, content }) => hub.submitOpening(room, pid(room), content)),
  );

  server.registerTool(
    "wait_for_messages",
    {
      title: "Wait for new messages",
      description:
        "Long-poll for messages from other participants. Returns immediately if there are unread messages, otherwise waits up to " +
        "timeout_ms (default 25s, max 55s) for one to arrive. Call it again if it returns nothing; that is normal. " +
        "Also reports your_turn (round_robin rooms) and whether the room has concluded.",
      inputSchema: {
        room: roomArg,
        since_seq: z.number().int().min(0).optional().describe("Return messages with seq greater than this. Defaults to what you have already seen."),
        timeout_ms: z.number().int().min(0).max(MAX_WAIT_MS).optional(),
      },
    },
    guard(async ({ room, since_seq, timeout_ms }) => {
      const r = hub.getRoom(room);
      const id = pid(room);
      const p = hub.requireParticipant(r, id);
      const since = since_seq ?? p.lastSeenSeq;
      const msgs = await hub.wait(room, id, since, Math.min(timeout_ms ?? DEFAULT_WAIT_MS, MAX_WAIT_MS));
      const openProposals = [...r.proposals.values()].filter((pr) => pr.status === "open" && !pr.votes[id]);
      return {
        messages: msgs.map(fmt),
        next_seq: r.messages.at(-1)?.seq ?? since,
        room_state: r.state,
        your_turn: r.mode === "round_robin" ? hub.currentSpeaker(r)?.id === id : true,
        active_participants: hub.activeParticipants(r).map((x) => x.name),
        proposals_awaiting_your_vote: openProposals.map((pr) => ({ id: pr.id, by: pr.by.name, text: pr.text })),
        conclusion: r.conclusion ?? null,
        hint:
          r.state === "concluded"
            ? "The room has concluded. Read the conclusion and leave_room."
            : openProposals.length
              ? "Vote on the open proposal(s) with vote before saying anything else."
              : msgs.length === 0
                ? "No new messages yet. Call wait_for_messages again."
                : undefined,
      };
    }),
  );

  server.registerTool(
    "read_messages",
    {
      title: "Read message history",
      description: "Read messages from the room log without waiting. Use since_seq to page.",
      inputSchema: { room: roomArg, since_seq: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(500).default(200) },
    },
    guard(({ room, since_seq, limit }) => hub.read(room, since_seq, limit).map(fmt)),
  );

  server.registerTool(
    "room_status",
    { title: "Room status", description: "Participants, mode, round/turn, open proposals with vote tallies, and the conclusion if any.", inputSchema: { room: roomArg } },
    guard(({ room }) => hub.summary(hub.getRoom(room))),
  );

  server.registerTool(
    "propose",
    {
      title: "Propose a conclusion",
      description:
        "Put a concrete statement to the room as the proposed conclusion. You automatically vote agree on your own proposal. " +
        "It is adopted when the room's quorum (default: every active participant) votes agree. Only one proposal can be open at a time; " +
        "if someone else's is open, vote on it instead.",
      inputSchema: { room: roomArg, text: z.string().describe("The exact conclusion you propose the group adopt.") },
    },
    guard(({ room, text }) => {
      const r = hub.getRoom(room);
      const pr = hub.propose(room, pid(room), text);
      return hub.proposalView(r, pr);
    }),
  );

  server.registerTool(
    "vote",
    {
      title: "Vote on a proposal",
      description: "Vote agree / disagree / abstain on a proposal, with a short reason and optional confidence 0-1.",
      inputSchema: {
        room: roomArg,
        proposal_id: z.string().describe("Proposal id (prop_...)."),
        vote: z.enum(["agree", "disagree", "abstain"]),
        reason: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
      },
    },
    guard(({ room, proposal_id, vote, reason, confidence }) => {
      const r = hub.getRoom(room);
      const pr = hub.vote(room, pid(room), proposal_id, vote, reason, confidence);
      return { proposal: hub.proposalView(r, pr), room_state: r.state, conclusion: r.conclusion ?? null };
    }),
  );

  server.registerResource(
    "room-transcript",
    new ResourceTemplate("chatroom://rooms/{room}", { list: async () => ({ resources: hub.listRooms().map((r) => ({ uri: `chatroom://rooms/${r.name}`, name: r.name, mimeType: "text/plain" })) }) }),
    { title: "Room transcript", description: "Full plain-text transcript of a room.", mimeType: "text/plain" },
    async (uri, { room }) => {
      const r = hub.getRoom(String(room));
      const header = `# ${r.name}\nTopic: ${r.topic}\nState: ${r.state}${r.conclusion ? `\nConclusion: ${r.conclusion.text}` : ""}\n\n`;
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: header + r.messages.map(fmt).join("\n") }] };
    },
  );

  void sessionLabel;
  return server;
}
