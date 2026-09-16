/**
 * MCP tool surface. One McpServer instance is created per connected client,
 * bound to the single shared Hub. Several agents (e.g. subagents of one Claude
 * Code session) may share a connection, so every room tool accepts an optional
 * participant_id and the server demands it when a connection holds more than
 * one identity in a room.
 *
 * Loop as an agent sees it: join_room -> submit_opening -> send_message /
 * wait_for_messages -> propose -> challenge -> vote -> room concludes -> leave_room.
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Hub, HubError } from "./hub.js";

export const DEFAULT_WAIT_MS = 25_000;
export const MAX_WAIT_MS = 55_000; // stay under typical MCP client tool timeouts (Codex 60s)

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});
const fail = (err: unknown) => ({
  isError: true,
  content: [
    {
      type: "text" as const,
      text:
        err instanceof HubError && err.data !== undefined
          ? `${err.message}\n${JSON.stringify(err.data, null, 2)}`
          : err instanceof Error
            ? err.message
            : String(err),
    },
  ],
});

export function createSessionServer(hub: Hub): McpServer {
  const server = new McpServer(
    { name: "agent-chatroom", version: "0.2.0" },
    {
      instructions:
        "A chatroom where AI agents reach scrutinised conclusions. Loop: join_room -> submit_opening (independent first answer) -> " +
        "wait_for_messages (long-polls; call repeatedly) -> send_message (short, new points only) -> propose an exact conclusion -> " +
        "someone else must challenge it -> everyone votes (agree must quote the proposal) -> room concludes -> leave_room. " +
        "Do not agree just to be agreeable: if you hold a different view, keep it until your strongest objection has been answered.",
    },
  );

  const me = new Map<string, Set<string>>();
  const pid = (room: string, override?: string) => {
    if (override) return override;
    const ids = me.get(room);
    if (!ids || ids.size === 0) throw new HubError(`You have not joined "${room}" on this connection. Call join_room first.`);
    if (ids.size > 1) {
      const r = hub.getRoom(room);
      const names = [...ids].map((id) => r.participants.get(id)?.name ?? id).join(", ");
      throw new HubError(
        `This MCP connection has several participants in "${room}" (${names}). ` +
          `Pass participant_id (returned by join_room) on every call so the room knows who you are.`,
      );
    }
    return [...ids][0];
  };
  const asArg = z.string().optional().describe("Your participant id from join_room. Required if other agents share this MCP connection.");
  const roomArg = z.string().describe("Room name, e.g. 'debate-1'.");

  const guard =
    <A>(fn: (args: A) => Promise<unknown> | unknown) =>
    async (args: A) => {
      try {
        return ok(await fn(args));
      } catch (e) {
        return fail(e);
      }
    };

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
        mode: z.enum(["free", "round_robin"]).optional().describe("free: anyone may speak (but never past unread messages). round_robin: strict turn order."),
        quorum: z.enum(["unanimous", "majority"]).optional().describe("How many active participants must agree for a proposal to become the conclusion."),
        max_rounds: z.number().int().min(0).optional().describe("round_robin only: after this many rounds the room stalls and falls back to plurality voting."),
        expected_participants: z.number().int().min(0).optional().describe("Blind openings are revealed, and proposals accepted, only once this many have joined."),
        anonymous: z.boolean().optional().describe("Show participants to each other as 'Participant A/B/C' to reduce identity bias."),
        max_messages_per_participant: z.number().int().min(0).optional().describe("Chat message budget per participant (votes/proposals/challenges are free)."),
        require_challenge: z.boolean().optional().describe("Require a challenge before any proposal can pass. Default: automatic when 3+ participants."),
        participant_id: z.string().optional().describe("Reclaim an earlier identity after a reconnect."),
      },
    },
    guard(({ room, name, agent, topic, mode, quorum, max_rounds, expected_participants, anonymous, max_messages_per_participant, require_challenge, participant_id }) => {
      const { room: r, participant } = hub.join(
        room,
        name,
        agent,
        {
          topic,
          mode,
          quorum,
          maxRounds: max_rounds,
          expectedParticipants: expected_participants,
          anonymous,
          maxMessagesPerParticipant: max_messages_per_participant,
          requireChallenge: require_challenge,
        },
        participant_id,
      );
      if (!me.has(room)) me.set(room, new Set());
      me.get(room)!.add(participant.id);
      const shared = me.get(room)!.size > 1;
      const recent = r.messages.slice(-30);
      hub.markRead(r, participant, r.messages.at(-1)?.seq ?? 0);
      return {
        participant_id: participant.id,
        you_are: hub.shown(r, participant),
        room: hub.summary(r),
        recent_messages: recent.map((m) => hub.fmt(r, m)),
        next_seq: participant.lastSeenSeq,
        hint:
          (shared ? "Other agents share this MCP connection: pass participant_id on EVERY call. " : "") +
          (r.anonymous ? `You appear to others as "${participant.label}". ` : "") +
          (r.expectedParticipants && !r.openingsRevealed
            ? "This room uses blind openings: call submit_opening with your independent first answer before reading others."
            : "Post with send_message, then call wait_for_messages in a loop to hear replies."),
      };
    }),
  );

  server.registerTool(
    "leave_room",
    { title: "Leave a room", description: "Leave a chatroom. Open proposals are re-evaluated without you.", inputSchema: { room: roomArg, participant_id: asArg } },
    guard(({ room, participant_id }) => {
      const id = pid(room, participant_id);
      hub.leave(room, id);
      me.get(room)?.delete(id);
      return `Left ${room}.`;
    }),
  );

  server.registerTool(
    "send_message",
    {
      title: "Send a message",
      description:
        "Post a message to the room. One claim, one reason, one ask. If messages arrived while you were composing, the send is refused and " +
        "you get them instead: read them, then resend only if your point is still new (or pass force=true).",
      inputSchema: {
        room: roomArg,
        content: z.string().describe("The message text."),
        reply_to: z.string().optional().describe("Message id (m_...) you are replying to."),
        force: z.boolean().optional().describe("Send even if there are unread messages."),
        participant_id: asArg,
      },
    },
    guard(({ room, content, reply_to, force, participant_id }) => {
      const r = hub.getRoom(room);
      const m = hub.send(room, pid(room, participant_id), content, reply_to, force);
      return { sent: hub.fmt(r, m), id: m.id, seq: m.seq };
    }),
  );

  server.registerTool(
    "submit_opening",
    {
      title: "Submit a blind opening statement",
      description:
        "Submit your independent first answer. It is held privately and revealed together with everyone else's once all " +
        "participants have submitted, so nobody anchors on another agent's answer. After it returns, call wait_for_messages.",
      inputSchema: { room: roomArg, content: z.string().describe("Your opening position and reasoning."), participant_id: asArg },
    },
    guard(({ room, content, participant_id }) => hub.submitOpening(room, pid(room, participant_id), content)),
  );

  server.registerTool(
    "wait_for_messages",
    {
      title: "Wait for new messages",
      description:
        "Long-poll for messages from other participants. Returns immediately if there are unread messages, otherwise waits up to " +
        "timeout_ms (default 25s, max 55s) for one to arrive. Call it again if it returns nothing; that is normal. " +
        "Also reports your_turn (round_robin rooms), open proposals needing your vote or a challenge, and whether the room has concluded.",
      inputSchema: {
        room: roomArg,
        since_seq: z.number().int().min(0).optional().describe("Return messages with seq greater than this. Defaults to what you have already seen."),
        timeout_ms: z.number().int().min(0).max(MAX_WAIT_MS).optional(),
        participant_id: asArg,
      },
    },
    guard(async ({ room, since_seq, timeout_ms, participant_id }) => {
      const r = hub.getRoom(room);
      const id = pid(room, participant_id);
      const p = hub.requireParticipant(r, id);
      const since = since_seq ?? p.lastSeenSeq;
      const msgs = await hub.wait(room, id, since, Math.min(timeout_ms ?? DEFAULT_WAIT_MS, MAX_WAIT_MS));
      const open = [...r.proposals.values()].find((pr) => pr.status === "open");
      const needsMyVote = open && !open.votes[id];
      const needsChallenge = open && hub.challengeRequired(r) && open.challenges.length === 0 && open.by.id !== id;
      const openView = open ? hub.proposalView(r, open) : null;
      return {
        messages: msgs.map((m) => hub.fmt(r, m)),
        next_seq: r.messages.at(-1)?.seq ?? since,
        room_state: r.state,
        your_turn: r.mode === "round_robin" ? hub.currentSpeaker(r)?.id === id : true,
        active_participants: hub.activeParticipants(r).map((x) => hub.shown(r, x)),
        open_proposal: openView ? { id: openView.id, by: openView.by, text: openView.text, tally: openView.tally, waiting_on: openView.waiting_on, needs_challenge: openView.needs_challenge, challenges: openView.challenges } : null,
        conclusion: r.conclusion ?? null,
        hint:
          r.state === "concluded"
            ? "The room has concluded. Read the conclusion and leave_room."
            : needsChallenge && needsMyVote
              ? "A proposal is open and nobody has challenged it yet. Find its weakest point and call challenge, then vote (agree must quote the proposal verbatim)."
              : needsMyVote
                ? "Vote on the open proposal: agree with a verbatim quote of the clause you endorse, or disagree with the specific change you need."
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
    guard(({ room, since_seq, limit }) => {
      const r = hub.getRoom(room);
      return hub.read(room, since_seq, limit).map((m) => hub.fmt(r, m));
    }),
  );

  server.registerTool(
    "room_status",
    { title: "Room status", description: "Participants, mode, round/turn, open proposals with challenges and vote tallies, and the conclusion if any.", inputSchema: { room: roomArg } },
    guard(({ room }) => hub.summary(hub.getRoom(room))),
  );

  server.registerTool(
    "propose",
    {
      title: "Propose a conclusion",
      description:
        "Put a concrete statement to the room as the proposed conclusion. You automatically vote agree on your own proposal. " +
        "It is adopted when the room's quorum (default: every active participant) votes agree AND, in rooms of 3+, someone has challenged it. " +
        "Only one proposal can be open at a time; if someone else's is open, challenge or vote on it instead.",
      inputSchema: { room: roomArg, text: z.string().describe("The exact conclusion you propose the group adopt."), participant_id: asArg },
    },
    guard(({ room, text, participant_id }) => {
      const r = hub.getRoom(room);
      const pr = hub.propose(room, pid(room, participant_id), text);
      return hub.proposalView(r, pr);
    }),
  );

  server.registerTool(
    "challenge",
    {
      title: "Challenge a proposal",
      description:
        "State the strongest specific objection you can find to an open proposal (a missing case, a false claim, a weaker alternative). " +
        "Required from someone other than the proposer before a proposal can pass in rooms of 3+. You may still vote agree afterwards if the room answers it.",
      inputSchema: {
        room: roomArg,
        proposal_id: z.string().describe("Proposal id (prop_...)."),
        objection: z.string().describe("The specific objection, with evidence if you have it."),
        participant_id: asArg,
      },
    },
    guard(({ room, proposal_id, objection, participant_id }) => {
      const r = hub.getRoom(room);
      const pr = hub.challenge(room, pid(room, participant_id), proposal_id, objection);
      return hub.proposalView(r, pr);
    }),
  );

  server.registerTool(
    "vote",
    {
      title: "Vote on a proposal",
      description:
        "Vote on a proposal. agree requires `quote`: a verbatim clause (15+ chars) from the proposal you endorse, checked by the server. " +
        "disagree requires `reason` stating the specific change that would make you agree. Optional confidence 0-1.",
      inputSchema: {
        room: roomArg,
        proposal_id: z.string().describe("Proposal id (prop_...)."),
        vote: z.enum(["agree", "disagree", "abstain"]),
        quote: z.string().optional().describe("agree only: verbatim clause from the proposal text."),
        reason: z.string().optional().describe("Why. Required for disagree: the change that would make you agree."),
        confidence: z.number().min(0).max(1).optional(),
        participant_id: asArg,
      },
    },
    guard(({ room, proposal_id, vote, quote, reason, confidence, participant_id }) => {
      const r = hub.getRoom(room);
      const pr = hub.vote(room, pid(room, participant_id), proposal_id, vote, reason, confidence, quote);
      return { proposal: hub.proposalView(r, pr), room_state: r.state, conclusion: r.conclusion ?? null };
    }),
  );

  server.registerResource(
    "room-transcript",
    new ResourceTemplate("chatroom://rooms/{room}", {
      list: async () => ({ resources: hub.listRooms().map((r) => ({ uri: `chatroom://rooms/${r.name}`, name: r.name, mimeType: "text/plain" })) }),
    }),
    { title: "Room transcript", description: "Full plain-text transcript of a room.", mimeType: "text/plain" },
    async (uri, { room }) => {
      const r = hub.getRoom(String(room));
      const header = `# ${r.name}\nTopic: ${r.topic}\nState: ${r.state}${r.conclusion ? `\nConclusion: ${r.conclusion.text}` : ""}\n\n`;
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: header + r.messages.map((m) => hub.fmt(r, m)).join("\n") }] };
    },
  );

  return server;
}
