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
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Hub, HubError } from "./hub.js";
import type { Spawner } from "./spawner.js";

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

export interface SessionServer {
  server: McpServer;
  /** Mark every participant this connection owns as left (called when the transport closes). */
  leaveAll(): void;
}

export function createSessionServer(hub: Hub, spawner?: Spawner): SessionServer {
  const server = new McpServer(
    { name: "agent-chatroom", version: "0.2.0" },
    {
      instructions:
        "A chatroom where AI agents talk like people and still reach a scrutinised conclusion. join_room, give a short independent opening " +
        "(submit_opening), then talk with send_message / wait_for_messages in plain prose. The proposal is a document: propose once, then " +
        "amend it in place rather than re-posting; keep shared evidence on the board (board_set) rather than in chat. Someone other than the " +
        "proposer names its weakest claim (challenge), then everyone votes (agree quotes the clause you endorse). If a human speaks, answer " +
        "them first, directly. Do not agree just to be agreeable.",
    },
  );

  const me = new Map<string, Set<string>>();
  const sessionKey = randomUUID(); // one connection = one agent, whatever names it uses
  const pid = (room: string, override?: string) => {
    const ids = me.get(room);
    if (override) {
      if (!ids?.has(override)) throw new HubError("That participant_id was not issued to this connection. Use the id join_room returned to you.");
      return override;
    }
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
        require_verification: z.boolean().optional().describe("Swarm mode: a proposal needs a verify/* board entry by someone else (naming the proposal id) before it can pass."),
        max_message_chars: z.number().int().min(200).max(20000).optional().describe("Cap on chat/opening length (proposals, challenges, board entries are not capped)."),
        participant_id: z.string().optional().describe("Reclaim an earlier identity after a reconnect."),
      },
    },
    guard(({ room, name, agent, topic, mode, quorum, max_rounds, expected_participants, anonymous, max_messages_per_participant, require_challenge, require_verification, max_message_chars, participant_id }) => {
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
          requireVerification: require_verification,
          maxMessageChars: max_message_chars,
        },
        participant_id,
        sessionKey,
      );
      if (!me.has(room)) me.set(room, new Set());
      me.get(room)!.add(participant.id);
      const shared = me.get(room)!.size > 1;
      const recent = r.messages.filter((m) => hub.visibleTo(r, m, participant.id)).slice(-30);
      hub.markRead(r, participant, r.messages.at(-1)?.seq ?? 0);
      const human = hub.unansweredHuman(r);
      return {
        participant_id: participant.id,
        you_are: hub.shown(r, participant),
        room: hub.summary(r),
        recent_messages: recent.map((m) => hub.fmt(r, m)),
        next_seq: participant.lastSeenSeq,
        hint:
          (shared ? "Other agents share this MCP connection: pass participant_id on EVERY call. " : "") +
          (r.anonymous ? `You appear to others as "${participant.label}". ` : "") +
          (human && hub.responderFor(r, human, participant.id).mine ? `${hub.shown(r, human.from)} (a human) said "${human.content.slice(0, 160)}" and nobody has replied: answer them first, briefly, with send_message reply_to="${human.id}". ` : "") +
          (r.expectedParticipants && !r.openingsRevealed
            ? "This room uses blind openings: submit_opening with your own short answer before reading others'."
            : "Talk with send_message; wait_for_messages to hear replies. The topic above is the brief; do not restate it."),
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
        "Post a message to the room. One claim, one reason, one ask. Address someone with @name (or @B in anonymous rooms) to give them the floor; " +
        "they are told to reply or pass. If messages arrived while you were composing, the send is refused and you get them instead: " +
        "read them, then resend only if your point is still new (or pass force=true). quiet=true pushes an @-message only to the agents named, " +
        "to save everyone else's context; it is NOT privacy: the message stays in the log, anyone can read_messages it, the human always sees it, and it " +
        "becomes public the moment anyone cites it. Use quiet for working exchanges only, never for a directive or anything someone is asked to act on.",
      inputSchema: {
        room: roomArg,
        content: z.string().describe("The message text."),
        reply_to: z.string().optional().describe("Message id (m_...) you are replying to."),
        force: z.boolean().optional().describe("Send even if there are unread messages."),
        quiet: z.boolean().optional().describe("Push only to the @-named agents (still logged and readable by all)."),
        surface: z.boolean().optional().describe("With reply_to into a quiet thread: make the whole thread public."),
        participant_id: asArg,
      },
    },
    guard(({ room, content, reply_to, force, quiet, surface, participant_id }) => {
      const r = hub.getRoom(room);
      const m = hub.send(room, pid(room, participant_id), content, reply_to, force, quiet, surface);
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
      const human = hub.unansweredHuman(r);
      const resp = human ? hub.responderFor(r, human, id) : null;
      return {
        messages: msgs.map((m) => hub.fmt(r, m)),
        next_seq: r.messages.at(-1)?.seq ?? since,
        room_state: r.state,
        your_turn: r.mode === "round_robin" ? hub.currentSpeaker(r)?.id === id : true,
        active_participants: hub.activeParticipants(r).map((x) => hub.shown(r, x)),
        unanswered_human: human && resp!.mine ? { id: human.id, name: hub.shown(r, human.from), text: human.content, you_answer: true } : human ? { name: hub.shown(r, human.from), responder: resp!.who, you_answer: false } : null,
        open_proposal: openView
          ? { id: openView.id, version: openView.version, by: openView.by, tally: openView.tally, waiting_on: openView.waiting_on, needs_challenge: openView.needs_challenge, challenges: openView.challenges, text: openView.text }
          : null,
        board_keys: [...r.board.keys()],
        quiet_activity: hub.quietActivity(r, p, since),
        addressed_to_you: hub.addressedBy(r, p).map((m) => ({ id: m.id, from: hub.shown(r, m.from), text: m.content.slice(0, 200) })),
        your_share: (() => {
          const sh = hub.share(r, p);
          return { messages: sh.mine, of_last: sh.of, fair: sh.fair, over: sh.over };
        })(),
        conclusion: r.conclusion ?? null,
        hint:
          r.state === "closed"
            ? "This room was closed without a conclusion. leave_room and stop."
            : r.state === "concluded"
            ? human && resp!.mine
              ? `The room has concluded, but ${hub.shown(r, human.from)} (a human) said "${human.content.slice(0, 160)}". You answer them (send_message reply_to="${human.id}", briefly), then leave_room.`
              : "The room has concluded. Read the conclusion and leave_room."
            : human && resp!.mine
              ? `${hub.shown(r, human.from)} (a human) said "${human.content.slice(0, 160)}" (${human.id}). You are the one answering: reply with send_message reply_to="${human.id}"` +
                (hub.isSmallTalk(human) ? ", one short friendly line, nothing else." : ", directly and briefly, before anything else.")
              : human
                ? `${hub.shown(r, human.from)} (a human) said something; ${resp!.who} is answering it. You will see it with the reply. Carry on.`
                : needsChallenge && needsMyVote
                ? "A proposal is open and untested. Name its single weakest claim in one sentence (challenge), then vote. If you want different wording, amend it instead of re-proposing."
                : needsMyVote
                  ? "Vote on the open proposal: agree with a verbatim quote of the clause you endorse, or disagree with the specific change you need (or just amend it)."
                  : hub.addressedBy(r, p).length
                    ? `${hub.shown(r, hub.addressedBy(r, p)[0].from)} addressed you directly. Reply (reply_to="${hub.addressedBy(r, p)[0].id}") or pass.`
                    : hub.share(r, p).over
                      ? "You have been doing most of the talking. Unless you have new evidence, pass and let the others speak."
                    : msgs.length === 0
                      ? "No new messages yet. Call wait_for_messages again."
                      : undefined,
      };
    }),
  );

  server.registerTool(
    "pass",
    {
      title: "Pass (nothing to add)",
      description:
        "Say nothing on purpose: you have read everything and have no new point. Silent in free rooms (it just marks you up to date and counts " +
        "toward your participation balance); in round_robin rooms it yields your turn. Prefer this over repeating a point someone already made.",
      inputSchema: { room: roomArg, participant_id: asArg },
    },
    guard(({ room, participant_id }) => hub.pass(room, pid(room, participant_id))),
  );

  server.registerTool(
    "read_messages",
    {
      title: "Read message history",
      description: "Read messages from the room log without waiting, including quiet messages between others (marked [quiet → names]). Use since_seq to page.",
      inputSchema: { room: roomArg, since_seq: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(500).default(200), participant_id: asArg },
    },
    guard(({ room, since_seq, limit, participant_id }) => {
      const r = hub.getRoom(room);
      let viewer: string | undefined;
      try {
        viewer = pid(room, participant_id);
      } catch {}
      return hub.read(room, since_seq, limit, viewer).map((m) => hub.fmt(r, m));
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
        "Only one proposal can be open at a time and it is a document: to change wording, use amend (posts only the diff) instead of proposing again.",
      inputSchema: { room: roomArg, text: z.string().describe("The exact conclusion you propose the group adopt."), participant_id: asArg },
    },
    guard(({ room, text, participant_id }) => {
      const r = hub.getRoom(room);
      const pr = hub.propose(room, pid(room, participant_id), text);
      return hub.proposalView(r, pr);
    }),
  );

  server.registerTool(
    "amend",
    {
      title: "Amend the open proposal",
      description:
        "Edit the open proposal's text in place: replace `find` (exact, unique substring) with `replace`, or leave `find` empty to append. " +
        "Only the diff is posted to the room, the version is bumped, and votes reset (you count as agreeing). Use this instead of re-proposing.",
      inputSchema: {
        room: roomArg,
        proposal_id: z.string().describe("Proposal id (prop_...)."),
        find: z.string().default("").describe("Exact text to replace; empty to append."),
        replace: z.string().describe("Replacement (or appended) text."),
        participant_id: asArg,
      },
    },
    guard(({ room, proposal_id, find, replace, participant_id }) => {
      const r = hub.getRoom(room);
      const { proposal, diff } = hub.amend(room, pid(room, participant_id), proposal_id, find, replace);
      return { version: proposal.version, diff, proposal: hub.proposalView(r, proposal) };
    }),
  );

  server.registerTool(
    "board_set",
    {
      title: "Write to the shared board",
      description:
        "Put evidence, decisions-so-far, open questions or a working draft on the room's shared board under a short key. Entries are " +
        "replaced in place and only a one-line notice goes to chat, so use this instead of re-posting long content. Empty text deletes the entry.",
      inputSchema: {
        room: roomArg,
        key: z.string().describe("Short name, e.g. 'evidence', 'open questions', 'draft'. Reserved: claim/<area> (JSON, create-then-owner-only), verify/<area> (a command you ran, its cwd/commit, exit code, and the proposal id), hold/<room> (pause; author-only), inbox/* (written by post_to_room; acknowledge with '<key>.ack')."),
        text: z.string(),
        if_absent: z.boolean().optional().describe("Create only; fail if the key exists (atomic claim)."),
        if_by_me: z.boolean().optional().describe("Update only if you wrote the existing entry."),
        overwrite: z.boolean().optional().describe("Replace another author's entry (refused otherwise, with their current text returned so you can merge)."),
        participant_id: asArg,
      },
    },
    guard(({ room, key, text, if_absent, if_by_me, overwrite, participant_id }) => {
      const e = hub.setBoard(room, pid(room, participant_id), key, text, { ifAbsent: if_absent, ifByMe: if_by_me, overwrite });
      return e ? { key, chars: e.text.length, by: e.by } : { key, deleted: true };
    }),
  );

  server.registerTool(
    "post_to_room",
    {
      title: "Send a note to another room",
      description:
        "Pass information to a team you are not part of: the note lands on that room's board as inbox/<your room>/<key> with a one-line notice, " +
        "without you joining (so you never affect their vote). With ack_required, that room cannot propose until someone there writes '<key>.ack'.",
      inputSchema: {
        from_room: z.string().describe("A room you are in."),
        to_room: z.string().describe("The room to notify."),
        key: z.string().describe("Short name, e.g. 'result', 'need-help', 'commit-ref'."),
        text: z.string(),
        ack_required: z.boolean().optional(),
        participant_id: asArg,
      },
    },
    guard(({ from_room, to_room, key, text, ack_required, participant_id }) => {
      const r = hub.postToRoom(from_room, pid(from_room, participant_id), to_room, key, text, ack_required);
      return { to_room, key: r.key, chars: r.entry.text.length, notified: true };
    }),
  );

  server.registerTool(
    "board_get",
    {
      title: "Read the shared board",
      description: "Read the room's shared board (all entries, or one key).",
      inputSchema: { room: roomArg, key: z.string().optional() },
    },
    guard(({ room, key }) => {
      const r = hub.getRoom(room);
      if (key) {
        const e = r.board.get(key);
        if (!e) throw new HubError(`No board entry "${key}". Keys: ${[...r.board.keys()].join(", ") || "(none)"}`);
        return { key, ...e };
      }
      return Object.fromEntries([...r.board].map(([k, e]) => [k, e]));
    }),
  );

  server.registerTool(
    "challenge",
    {
      title: "Challenge a proposal",
      description:
        "Name the single weakest claim in an open proposal, in one or two plain sentences. Required from someone other than the proposer " +
        "before a proposal can pass in rooms of 3+. Your vote resets; re-vote once it is answered. If you cannot break it, say so and name the riskiest assumption.",
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

  if (spawner) {
    server.registerTool(
      "request_agent",
      {
        title: "Recruit a new agent into the room",
        description:
          "Spawn a fresh agent process that joins this room with a brief you write: a sub-task, a second pair of eyes, a specialist. " +
          "It gets the board and recent messages, does the brief, reports back, and leaves. Caps apply (per room, per requester, machine-wide). " +
          "Write the brief the way you would for a capable colleague who has not seen the conversation.",
        inputSchema: {
          room: roomArg,
          brief: z.string().describe("What the new agent should do, with the context it needs and what 'done' looks like."),
          name: z.string().optional().describe("Display name for the newcomer (default: <agent>-recruit-N)."),
          agent: z.enum(["claude", "codex"]).optional().describe("Which CLI to spawn (default claude)."),
          model: z.string().optional().describe("Model override, e.g. 'sonnet', 'haiku', 'opus', or a Codex model id."),
          cwd: z.string().optional().describe("Directory the newcomer works in (default: the hub's default project dir)."),
          can_edit: z.boolean().optional().describe("Allow the newcomer to modify files (default false: investigate and report)."),
          new_room: z.string().optional().describe("Spawn a sub-team into this new room instead of yours; they report back with post_to_room."),
          room_topic: z.string().optional().describe("Topic for the new room."),
          count: z.number().int().min(1).max(3).optional().describe("How many to spawn (default 2 for a new room, 1 otherwise)."),
          area: z.string().optional().describe("Claim this area (claim/<area>) for the newcomers first; refused if someone else owns it."),
          participant_id: asArg,
        },
      },
      guard(({ room, brief, name, agent, model, cwd, can_edit, new_room, room_topic, count, area, participant_id }) => {
        const r = hub.getRoom(room);
        const me_ = hub.requireParticipant(r, pid(room, participant_id));
        const recs = spawner.request({ room, brief, requestedBy: me_.name, name, agent, model, cwd, canEdit: can_edit, newRoom: new_room, roomTopic: room_topic, count, area });
        const who = recs.map((x) => x.name).join(", ");
        hub.announce(room, `${hub.shown(r, me_)} recruited ${who} (${recs[0].agent}${recs[0].model ? `/${recs[0].model}` : ""}${new_room ? `, into ${new_room}` : ""}${area ? `, area ${area}` : ""}): ${brief.slice(0, 200)}${brief.length > 200 ? "…" : ""}`);
        return { spawned: recs.map((x) => x.name), room: recs[0].room, depth: recs[0].depth, agent: recs[0].agent, model: recs[0].model ?? null, cwd: recs[0].cwd, logs: recs.map((x) => x.log), hint: "They will join within a minute or two. Carry on; you will see them arrive." };
      }),
    );

    server.registerTool(
      "list_agents",
      { title: "List recruited agents", description: "Recruited agents in this room (or all rooms): who asked for them, their brief, and whether they are still running.", inputSchema: { room: z.string().optional() } },
      guard(({ room }) =>
        spawner.agents
          .filter((a) => !room || a.room === room)
          .map((a) => ({ name: a.name, room: a.room, report_to: a.reportTo ?? null, agent: a.agent, model: a.model ?? null, requested_by: a.requestedBy, depth: a.depth, running: a.endedAt === undefined, exit_code: a.exitCode ?? null, brief: a.brief.slice(0, 160) })),
      ),
    );
  }

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

  const leaveAll = () => {
    for (const [room, ids] of me) {
      for (const id of ids) {
        try {
          hub.leave(room, id);
        } catch {}
      }
      ids.clear();
    }
  };
  return { server, leaveAll };
}
