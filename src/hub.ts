/**
 * The Hub is the single shared state behind the MCP server: rooms, participants,
 * an append-only sequence-numbered message log per room, long-poll waiters,
 * and the proposal / challenge / vote primitives that let a room reach a
 * conclusion that has actually been scrutinised.
 *
 * It is deliberately transport-agnostic so it can be driven by MCP tools,
 * by the plain HTTP endpoints (humans), or by tests.
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type MessageKind = "chat" | "system" | "proposal" | "challenge" | "vote" | "conclusion";
export type Vote = "agree" | "disagree" | "abstain";
export type Quorum = "unanimous" | "majority";
export type RoomMode = "free" | "round_robin";
export type RoomState = "open" | "concluded" | "stalled";

export interface Participant {
  id: string;
  name: string;
  /** Stable pseudonym ("Participant B") used for display in anonymous rooms. */
  label: string;
  agent: string; // e.g. "claude", "codex", "human"
  joinedAt: string;
  lastActiveAt: string;
  lastSeenSeq: number;
  active: boolean;
  messageCount: number;
}

export interface Message {
  seq: number;
  id: string;
  room: string;
  kind: MessageKind;
  from: { id: string; name: string; agent: string };
  content: string;
  ts: string;
  replyTo?: string;
  proposalId?: string;
}

export interface Challenge {
  by: { id: string; name: string };
  objection: string;
  ts: string;
}

export interface Proposal {
  id: string;
  room: string;
  by: { id: string; name: string };
  text: string;
  createdAt: string;
  votes: Record<string, { vote: Vote; reason?: string; quote?: string; confidence?: number; name: string; ts: string }>;
  challenges: Challenge[];
  status: "open" | "accepted" | "rejected" | "superseded";
  /** set once the "needs a challenge" nudge has been posted */
  nudged?: boolean;
}

export interface RoomOptions {
  topic?: string;
  mode?: RoomMode;
  quorum?: Quorum;
  maxRounds?: number;
  /** Blind openings are revealed, and proposals can be accepted, only once this many participants have joined. */
  expectedParticipants?: number;
  /** Show participants to each other as "Participant A/B/C" instead of their names. */
  anonymous?: boolean;
  /** Max chat messages each participant may send (0 = unlimited). Votes/proposals/challenges do not count. */
  maxMessagesPerParticipant?: number;
  /** Max characters per message. */
  maxMessageChars?: number;
  /** Require at least one challenge from a non-proposer before a proposal can pass. "auto" = when 3+ active. */
  requireChallenge?: boolean | "auto";
  /** Post a nudge after this much silence in an open room (0 = never). */
  nudgeAfterMs?: number;
}

export interface Room {
  name: string;
  topic: string;
  mode: RoomMode;
  quorum: Quorum;
  maxRounds: number; // 0 = unlimited
  expectedParticipants: number;
  anonymous: boolean;
  maxMessagesPerParticipant: number;
  maxMessageChars: number;
  requireChallenge: boolean | "auto";
  nudgeAfterMs: number;
  createdAt: string;
  state: RoomState;
  conclusion?: { text: string; proposalId: string; decidedAt: string };
  participants: Map<string, Participant>;
  messages: Message[];
  proposals: Map<string, Proposal>;
  /** round_robin bookkeeping */
  turnIndex: number;
  round: number;
  /** long-poll waiters */
  waiters: Set<() => void>;
  /** blind opening statements held back until everyone has submitted */
  openings: Map<string, string>;
  openingsRevealed: boolean;
  nudgeTimer?: NodeJS.Timeout;
}

type Opts = Required<RoomOptions>;

type Event =
  | { type: "room"; room: string; opts: Opts; createdAt: string }
  | { type: "message"; msg: Message }
  | { type: "join" | "leave"; room: string; p: Participant }
  | { type: "proposal"; proposal: Proposal }
  | { type: "vote"; room: string; proposalId: string; pid: string; entry: Proposal["votes"][string] }
  | { type: "challenge"; room: string; proposalId: string; challenge: Challenge }
  | { type: "state"; room: string; state: RoomState; conclusion?: Room["conclusion"] }
  | { type: "opening"; room: string; pid: string; content: string }
  | { type: "openings_revealed"; room: string };

const now = () => new Date().toISOString();
const shortId = (prefix: string) => `${prefix}_${randomBytes(4).toString("hex")}`;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();

export class HubError extends Error {
  constructor(
    message: string,
    public data?: unknown,
  ) {
    super(message);
  }
}

export class Hub {
  readonly rooms = new Map<string, Room>();
  private readonly dataDir?: string;

  constructor(opts: { dataDir?: string } = {}) {
    this.dataDir = opts.dataDir;
    if (this.dataDir) {
      mkdirSync(this.dataDir, { recursive: true });
      this.replay();
    }
  }

  // ---------- rooms ----------

  listRooms(reveal = false) {
    return [...this.rooms.values()].map((r) => this.summary(r, reveal));
  }

  getRoom(name: string): Room {
    const r = this.rooms.get(name);
    if (!r) throw new HubError(`Room "${name}" does not exist. Use join_room (it auto-creates) or list_rooms.`);
    return r;
  }

  createRoom(name: string, opts: RoomOptions = {}): Room {
    const existing = this.rooms.get(name);
    if (existing) return existing;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
      throw new HubError(`Room name "${name}" must match [a-zA-Z0-9_-]{1,64}.`);
    }
    const full: Opts = {
      topic: opts.topic ?? "",
      mode: opts.mode ?? "free",
      quorum: opts.quorum ?? "unanimous",
      maxRounds: opts.maxRounds ?? 0,
      expectedParticipants: opts.expectedParticipants ?? 0,
      anonymous: opts.anonymous ?? false,
      maxMessagesPerParticipant: opts.maxMessagesPerParticipant ?? 0,
      maxMessageChars: opts.maxMessageChars ?? 4000,
      requireChallenge: opts.requireChallenge ?? "auto",
      nudgeAfterMs: opts.nudgeAfterMs ?? 180_000,
    };
    const room = this.materialiseRoom(name, full, now());
    this.persist({ type: "room", room: name, opts: full, createdAt: room.createdAt });
    return room;
  }

  private materialiseRoom(name: string, opts: Opts, createdAt: string): Room {
    const room: Room = {
      name,
      ...opts,
      createdAt,
      state: "open",
      participants: new Map(),
      messages: [],
      proposals: new Map(),
      turnIndex: 0,
      round: 1,
      waiters: new Set(),
      openings: new Map(),
      openingsRevealed: false,
    };
    this.rooms.set(name, room);
    return room;
  }

  /** Name a participant is shown under to other agents. */
  shown(room: Room, p: { name: string; label?: string; id: string }): string {
    if (!room.anonymous) return p.name;
    return room.participants.get(p.id)?.label ?? p.label ?? p.name;
  }

  /**
   * Room summary. `reveal` (humans / HTTP) shows real names in anonymous rooms;
   * agents get pseudonyms.
   */
  summary(room: Room, reveal = false) {
    const active = this.activeParticipants(room);
    const nm = (p: Participant) => (reveal ? p.name : this.shown(room, p));
    const speaker = this.currentSpeaker(room);
    return {
      name: room.name,
      topic: room.topic,
      mode: room.mode,
      quorum: room.quorum,
      max_rounds: room.maxRounds || null,
      expected_participants: room.expectedParticipants || null,
      anonymous: room.anonymous,
      max_messages_per_participant: room.maxMessagesPerParticipant || null,
      require_challenge: this.challengeRequired(room),
      state: room.state,
      created_at: room.createdAt,
      openings: room.openingsRevealed
        ? "revealed"
        : `${room.openings.size} submitted, waiting for ${this.openingsWaitingOn(room, reveal).join(", ") || "nobody"}`,
      round: room.round,
      current_turn: room.mode === "round_robin" && speaker ? nm(speaker) : null,
      participants: [...room.participants.values()].map((p) => ({
        ...(reveal ? { id: p.id } : {}),
        name: nm(p),
        ...(reveal && room.anonymous ? { label: p.label } : {}),
        agent: reveal || !room.anonymous ? p.agent : "hidden",
        active: p.active,
        messages: p.messageCount,
        last_active_at: p.lastActiveAt,
      })),
      active_count: active.length,
      message_count: room.messages.length,
      latest_seq: room.messages.at(-1)?.seq ?? 0,
      proposals: [...room.proposals.values()].map((pr) => this.proposalView(room, pr, reveal)),
      conclusion: room.conclusion ?? null,
    };
  }

  stats(room: Room) {
    const first = room.messages[0]?.ts;
    const last = room.messages.at(-1)?.ts;
    const chat = room.messages.filter((m) => m.kind === "chat");
    // bursts: chat messages posted within 5s of the previous chat message by someone else
    let bursts = 0;
    for (let i = 1; i < chat.length; i++) {
      if (chat[i].from.id !== chat[i - 1].from.id && Date.parse(chat[i].ts) - Date.parse(chat[i - 1].ts) < 5000) bursts++;
    }
    return {
      room: room.name,
      state: room.state,
      duration_ms: first && last ? Date.parse(last) - Date.parse(first) : 0,
      time_to_conclusion_ms: room.conclusion && first ? Date.parse(room.conclusion.decidedAt) - Date.parse(first) : null,
      messages_by_kind: room.messages.reduce<Record<string, number>>((a, m) => ((a[m.kind] = (a[m.kind] ?? 0) + 1), a), {}),
      per_participant: [...room.participants.values()].map((p) => ({
        name: p.name,
        agent: p.agent,
        chat_messages: p.messageCount,
        chars: room.messages.filter((m) => m.from.id === p.id && m.kind === "chat").reduce((a, m) => a + m.content.length, 0),
      })),
      proposals: room.proposals.size,
      challenges: [...room.proposals.values()].reduce((a, p) => a + p.challenges.length, 0),
      near_simultaneous_replies: bursts,
    };
  }

  // ---------- participants ----------

  join(roomName: string, name: string, agent: string, opts: RoomOptions = {}, reclaimId?: string): { room: Room; participant: Participant } {
    const room = this.createRoom(roomName, opts);
    if (!name.trim()) throw new HubError("A display name is required to join.");

    let participant = reclaimId ? room.participants.get(reclaimId) : undefined;
    if (!participant) participant = [...room.participants.values()].find((p) => p.name === name && !p.active);
    // Humans are identified by name alone (they come in over plain HTTP with no session), so they always reclaim.
    if (!participant && agent === "human") participant = [...room.participants.values()].find((p) => p.name === name && p.agent === "human");
    if (!participant) {
      if ([...room.participants.values()].some((p) => p.name === name && p.active)) {
        throw new HubError(`Someone named "${name}" is already active in "${roomName}". Pick another name.`);
      }
      const n = room.participants.size;
      participant = {
        id: shortId("p"),
        name,
        label: `Participant ${String.fromCharCode(65 + (n % 26))}${n >= 26 ? Math.floor(n / 26) : ""}`,
        agent,
        joinedAt: now(),
        lastActiveAt: now(),
        lastSeenSeq: 0,
        active: true,
        messageCount: 0,
      };
      room.participants.set(participant.id, participant);
      this.persist({ type: "join", room: roomName, p: participant });
      this.post(room, "system", undefined, `${this.shown(room, participant)}${room.anonymous ? "" : ` (${agent})`} joined the room.`);
    } else if (!participant.active) {
      participant.active = true;
      participant.lastActiveAt = now();
      this.persist({ type: "join", room: roomName, p: participant });
      this.post(room, "system", undefined, `${this.shown(room, participant)} rejoined the room.`);
    }
    for (const pr of room.proposals.values()) if (pr.status === "open") this.evaluate(room, pr);
    return { room, participant };
  }

  leave(roomName: string, pid: string): void {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    p.active = false;
    p.lastActiveAt = now();
    this.persist({ type: "leave", room: roomName, p });
    this.post(room, "system", undefined, `${this.shown(room, p)} left the room.`);
    for (const pr of room.proposals.values()) if (pr.status === "open") this.evaluate(room, pr);
  }

  requireParticipant(room: Room, pid: string): Participant {
    const p = room.participants.get(pid);
    if (!p) throw new HubError(`You are not a participant of "${room.name}". Call join_room first.`);
    if (!p.active) throw new HubError(`You have left "${room.name}". Call join_room again to rejoin.`);
    return p;
  }

  activeParticipants(room: Room): Participant[] {
    return [...room.participants.values()].filter((p) => p.active);
  }

  /** Participants whose votes are required for quorum. Humans are chairs/observers: they may veto but are never waited on. */
  voters(room: Room): Participant[] {
    return this.activeParticipants(room).filter((p) => p.agent !== "human");
  }

  currentSpeaker(room: Room): Participant | undefined {
    const active = this.activeParticipants(room);
    if (active.length === 0) return undefined;
    return active[room.turnIndex % active.length];
  }

  // ---------- messages ----------

  /** Substantive messages from others that this participant has not read yet (system notices do not count). */
  unread(room: Room, p: Participant): Message[] {
    return room.messages.filter((m) => m.seq > p.lastSeenSeq && m.from.id !== p.id && m.kind !== "system");
  }

  send(roomName: string, pid: string, content: string, replyTo?: string, force = false): Message {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    if (room.state === "concluded") {
      throw new HubError(`Room "${roomName}" has concluded: ${room.conclusion?.text}. No further messages are needed.`);
    }
    if (!content.trim()) throw new HubError("Message content is empty.");
    if (content.length > room.maxMessageChars) {
      throw new HubError(`Message is ${content.length} chars; this room allows ${room.maxMessageChars}. Say less: one claim, one reason, one ask.`);
    }
    if (room.maxMessagesPerParticipant && p.messageCount >= room.maxMessagesPerParticipant && p.agent !== "human") {
      throw new HubError(
        `You have used your ${room.maxMessagesPerParticipant} messages in this room. You can still propose, challenge and vote.`,
      );
    }
    if (room.mode === "round_robin") {
      const speaker = this.currentSpeaker(room);
      if (speaker && speaker.id !== p.id) {
        throw new HubError(`It is ${this.shown(room, speaker)}'s turn to speak, not yours. Call wait_for_messages until your_turn is true.`);
      }
    } else if (!force && p.agent !== "human") {
      // Stale-send guard: never talk past messages you have not read.
      const unread = this.unread(room, p);
      if (unread.length) {
        throw new HubError(
          `${unread.length} message(s) arrived while you were composing. Read them first (included below); ` +
            `then resend only if your point is still new. Pass force=true to send anyway.`,
          { unread: unread.map((m) => this.fmt(room, m)), next_seq: room.messages.at(-1)!.seq },
        );
      }
    }
    if (room.mode === "round_robin") this.advanceTurn(room);
    const msg = this.post(room, "chat", p, content, { replyTo });
    p.messageCount += 1;
    p.lastSeenSeq = Math.max(p.lastSeenSeq, msg.seq);
    return msg;
  }

  /** Mark everything up to `seq` as read by this participant. */
  markRead(room: Room, p: Participant, seq: number) {
    p.lastSeenSeq = Math.max(p.lastSeenSeq, seq);
    p.lastActiveAt = now();
  }

  private advanceTurn(room: Room) {
    const active = this.activeParticipants(room);
    room.turnIndex = (room.turnIndex + 1) % Math.max(active.length, 1);
    if (room.turnIndex === 0) {
      room.round += 1;
      if (room.maxRounds && room.round > room.maxRounds && room.state === "open") {
        this.setState(room, "stalled");
        this.post(
          room,
          "system",
          undefined,
          `Round limit (${room.maxRounds}) reached without consensus. Please vote on the open proposal now; ` +
            `the proposal with the most "agree" votes will be adopted when every active participant has voted, or propose a compromise.`,
        );
      }
    }
  }

  read(roomName: string, sinceSeq = 0, limit = 200): Message[] {
    const room = this.getRoom(roomName);
    return room.messages.filter((m) => m.seq > sinceSeq).slice(0, limit);
  }

  /**
   * Long-poll: resolves as soon as there is a message from someone else with
   * seq > sinceSeq (or immediately if there already is one), otherwise after timeoutMs.
   */
  async wait(roomName: string, pid: string | undefined, sinceSeq: number, timeoutMs: number): Promise<Message[]> {
    const room = this.getRoom(roomName);
    const p = pid ? room.participants.get(pid) : undefined;
    const pending = () => room.messages.filter((m) => m.seq > sinceSeq && m.from.id !== p?.id);
    let msgs = pending();
    if (msgs.length === 0 && timeoutMs > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          room.waiters.delete(wake);
          resolve();
        }, timeoutMs);
        const wake = () => {
          clearTimeout(timer);
          room.waiters.delete(wake);
          resolve();
        };
        room.waiters.add(wake);
      });
      msgs = pending();
    }
    if (p) this.markRead(room, p, room.messages.at(-1)?.seq ?? sinceSeq);
    return msgs;
  }

  /** Plain-text rendering of a message as agents see it (pseudonyms in anonymous rooms). */
  fmt(room: Room, m: Message): string {
    const tag = m.kind === "chat" ? "" : `[${m.kind.toUpperCase()}] `;
    const who = m.from.id === "system" ? "system" : this.shown(room, m.from);
    return `#${m.seq} ${who}: ${tag}${m.content}`;
  }

  private post(room: Room, kind: MessageKind, from: Participant | undefined, content: string, extra: Partial<Message> = {}): Message {
    const msg: Message = {
      seq: (room.messages.at(-1)?.seq ?? 0) + 1,
      id: shortId("m"),
      room: room.name,
      kind,
      from: from ? { id: from.id, name: from.name, agent: from.agent } : { id: "system", name: "system", agent: "hub" },
      content,
      ts: now(),
      ...extra,
    };
    room.messages.push(msg);
    if (from) from.lastActiveAt = msg.ts;
    this.persist({ type: "message", msg });
    this.notify(room);
    this.armNudge(room);
    return msg;
  }

  private notify(room: Room) {
    for (const wake of [...room.waiters]) wake();
  }

  /** After a period of silence in an open room, remind people what is blocking. */
  private armNudge(room: Room) {
    if (room.nudgeTimer) clearTimeout(room.nudgeTimer);
    if (!room.nudgeAfterMs || room.state === "concluded") return;
    room.nudgeTimer = setTimeout(() => {
      if (room.state === "concluded" || this.activeParticipants(room).length === 0) return;
      const open = [...room.proposals.values()].find((pr) => pr.status === "open");
      const mins = Math.round(room.nudgeAfterMs / 60000);
      if (open) {
        const waiting = this.voters(room)
          .filter((p) => !open.votes[p.id])
          .map((p) => this.shown(room, p));
        const needsChallenge = this.challengeRequired(room) && open.challenges.length === 0;
        this.post(
          room,
          "system",
          undefined,
          `${mins} min of silence. Proposal ${open.id} is open` +
            (waiting.length ? `; still waiting for votes from ${waiting.join(", ")}` : "") +
            (needsChallenge ? `; it also needs a challenge from someone other than ${this.shown(room, open.by)} before it can pass` : "") +
            ".",
        );
      } else if (!room.openingsRevealed && room.openings.size) {
        this.post(room, "system", undefined, `${mins} min of silence. Still waiting for openings from ${this.openingsWaitingOn(room).join(", ")}.`);
      } else {
        this.post(room, "system", undefined, `${mins} min of silence. If the discussion has converged, someone should propose a conclusion.`);
      }
    }, room.nudgeAfterMs);
    room.nudgeTimer.unref();
  }

  // ---------- blind openings ----------

  openingsWaitingOn(room: Room, reveal = false): string[] {
    const active = this.voters(room);
    const missing = active.filter((p) => !room.openings.has(p.id)).map((p) => (reveal ? p.name : this.shown(room, p)));
    const shortfall = Math.max(0, room.expectedParticipants - active.length);
    return shortfall > 0 ? [...missing, `${shortfall} more participant(s) to join`] : missing;
  }

  submitOpening(roomName: string, pid: string, content: string): { revealed: boolean; waiting_on: string[] } {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    if (room.openingsRevealed) throw new HubError("Openings have already been revealed in this room; use send_message.");
    if (!content.trim()) throw new HubError("Opening statement is empty.");
    if (content.length > room.maxMessageChars) throw new HubError(`Opening is ${content.length} chars; this room allows ${room.maxMessageChars}.`);
    room.openings.set(p.id, content);
    this.persist({ type: "opening", room: roomName, pid: p.id, content });
    const waiting = this.openingsWaitingOn(room);
    if (waiting.length === 0) this.revealOpenings(room);
    return { revealed: room.openingsRevealed, waiting_on: waiting };
  }

  private revealOpenings(room: Room) {
    room.openingsRevealed = true;
    this.persist({ type: "openings_revealed", room: room.name });
    this.post(room, "system", undefined, `All ${room.openings.size} opening statements are in. Revealing them simultaneously:`);
    for (const [pid, content] of room.openings) {
      const p = room.participants.get(pid);
      if (p) this.post(room, "chat", p, `[OPENING] ${content}`);
    }
    if (room.mode === "round_robin") room.round = 2;
  }

  // ---------- consensus ----------

  challengeRequired(room: Room): boolean {
    if (room.requireChallenge === "auto") return this.voters(room).length >= 3;
    return room.requireChallenge;
  }

  propose(roomName: string, pid: string, text: string): Proposal {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    if (room.state === "concluded") throw new HubError(`Room "${roomName}" has already concluded.`);
    if (!text.trim()) throw new HubError("Proposal text is empty.");
    const open = [...room.proposals.values()].find((pr) => pr.status === "open");
    if (open) {
      throw new HubError(
        `Proposal ${open.id} by ${this.shown(room, open.by)} is already open: "${open.text.slice(0, 200)}". ` +
          `Vote on it (agree with a quote, or disagree with the change you need), or challenge it, instead of proposing a new one.`,
      );
    }
    const proposal: Proposal = {
      id: shortId("prop"),
      room: roomName,
      by: { id: p.id, name: p.name },
      text,
      createdAt: now(),
      votes: { [p.id]: { vote: "agree", name: p.name, ts: now(), reason: "proposer" } },
      challenges: [],
      status: "open",
    };
    room.proposals.set(proposal.id, proposal);
    this.persist({ type: "proposal", proposal });
    this.post(room, "proposal", p, `PROPOSAL ${proposal.id}: ${text}`, { proposalId: proposal.id });
    this.evaluate(room, proposal); // a solo room concludes immediately
    return proposal;
  }

  challenge(roomName: string, pid: string, proposalId: string, objection: string): Proposal {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    const pr = room.proposals.get(proposalId);
    if (!pr) throw new HubError(`No proposal "${proposalId}" in "${roomName}".`);
    if (pr.status !== "open") throw new HubError(`Proposal ${proposalId} is already ${pr.status}.`);
    if (pr.by.id === p.id) throw new HubError("You cannot challenge your own proposal; someone else must.");
    if (objection.trim().length < 20) throw new HubError("A challenge must state a specific objection (at least 20 characters).");
    const challenge: Challenge = { by: { id: p.id, name: p.name }, objection, ts: now() };
    pr.challenges.push(challenge);
    // A challenge must be answered: the challenger's own vote (if any) is reset and must be re-cast
    // after the room has responded, so the proposal cannot pass in the same breath.
    delete pr.votes[p.id];
    this.persist({ type: "challenge", room: roomName, proposalId, challenge });
    this.post(
      room,
      "challenge",
      p,
      `CHALLENGE to ${proposalId}: ${objection}\n(${this.shown(room, pr.by)} should answer this. ${this.shown(room, p)}'s vote is reset until they re-vote.)`,
      { proposalId },
    );
    return pr;
  }

  vote(roomName: string, pid: string, proposalId: string, vote: Vote, reason?: string, confidence?: number, quote?: string): Proposal {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    const proposal = room.proposals.get(proposalId);
    if (!proposal) throw new HubError(`No proposal "${proposalId}" in "${roomName}". See room_status for open proposals.`);
    if (proposal.status !== "open") throw new HubError(`Proposal ${proposalId} is already ${proposal.status}.`);
    if (p.agent !== "human") {
      if (vote === "agree") {
        if (!quote || quote.trim().length < 15) {
          throw new HubError("An agree vote must include `quote`: a verbatim clause (15+ chars) from the proposal you are endorsing. Read it before you vote.");
        }
        if (!norm(proposal.text).includes(norm(quote))) {
          throw new HubError(`Your quote is not in the proposal text. Quote it verbatim. Proposal text:\n${proposal.text}`);
        }
      }
      if (vote === "disagree" && (!reason || reason.trim().length < 20)) {
        throw new HubError("A disagree vote must include `reason` stating the specific change that would make you agree (20+ chars).");
      }
    }
    const entry = { vote, reason, quote, confidence, name: p.name, ts: now() };
    proposal.votes[p.id] = entry;
    this.persist({ type: "vote", room: roomName, proposalId, pid: p.id, entry });
    const conf = confidence !== undefined ? ` (confidence ${confidence})` : "";
    this.post(room, "vote", p, `${this.shown(room, p)} votes ${vote.toUpperCase()} on ${proposalId}${conf}${reason ? `: ${reason}` : ""}`, { proposalId });
    this.evaluate(room, proposal);
    return proposal;
  }

  proposalView(room: Room, pr: Proposal, reveal = false) {
    const active = this.voters(room);
    const nm = (x: { id: string; name: string }) => (reveal ? x.name : this.shown(room, x));
    const tally = { agree: 0, disagree: 0, abstain: 0 };
    for (const p of active) {
      const v = pr.votes[p.id]?.vote;
      if (v) tally[v] += 1;
    }
    const needsChallenge = this.challengeRequired(room) && pr.challenges.length === 0 && pr.status === "open";
    return {
      id: pr.id,
      by: nm(pr.by),
      text: pr.text,
      status: pr.status,
      created_at: pr.createdAt,
      tally,
      waiting_on: active.filter((p) => !pr.votes[p.id]).map((p) => nm(p)),
      needs_challenge: needsChallenge,
      challenges: pr.challenges.map((c) => ({ by: nm(c.by), objection: c.objection })),
      votes: Object.entries(pr.votes).map(([id, v]) => ({ name: nm({ id, name: v.name }), vote: v.vote, confidence: v.confidence, reason: v.reason })),
    };
  }

  /** Re-check whether a proposal has reached the room's quorum. */
  private evaluate(room: Room, pr: Proposal) {
    if (pr.status !== "open" || room.state === "concluded") return;
    const active = this.voters(room);
    if (active.length === 0) return;
    if (room.expectedParticipants && room.participants.size < room.expectedParticipants) return;
    const humanVeto = this.activeParticipants(room).some((p) => p.agent === "human" && pr.votes[p.id]?.vote === "disagree");
    const votes = active.map((p) => pr.votes[p.id]?.vote);
    const agree = votes.filter((v) => v === "agree").length;
    const disagree = votes.filter((v) => v === "disagree").length;
    const everyoneVoted = votes.every(Boolean);

    let accepted = false;
    let rejected = false;
    if (room.quorum === "unanimous") {
      if (disagree > 0) rejected = true;
      else if (everyoneVoted && agree === active.length) accepted = true;
    } else {
      const needed = Math.floor(active.length / 2) + 1;
      if (agree >= needed) accepted = true;
      else if (disagree >= needed) rejected = true;
      else if (everyoneVoted) rejected = true;
    }
    if (!accepted && !rejected && room.state === "stalled" && everyoneVoted && agree > disagree) accepted = true;
    if (humanVeto) {
      accepted = false;
      rejected = true;
    }

    // Adversarial gate: unanimous agreement without a single challenge is suspicious.
    if (accepted && this.challengeRequired(room) && pr.challenges.length === 0) {
      if (!pr.nudged) {
        pr.nudged = true;
        this.post(
          room,
          "system",
          undefined,
          `Everyone agrees with ${pr.id} but nobody has tried to break it. Before it can pass, someone other than ${this.shown(room, pr.by)} must ` +
            `call challenge with the strongest objection they can find (even if they end up agreeing), and the room should answer it.`,
        );
      }
      return;
    }

    if (accepted) this.conclude(room, pr);
    else if (rejected) {
      pr.status = "rejected";
      this.persist({ type: "proposal", proposal: pr });
      this.post(room, "system", undefined, `Proposal ${pr.id} was rejected (${agree} agree / ${disagree} disagree). Address the objections and propose a revision.`);
    }
  }

  private conclude(room: Room, pr: Proposal) {
    pr.status = "accepted";
    for (const other of room.proposals.values()) if (other.id !== pr.id && other.status === "open") other.status = "superseded";
    room.conclusion = { text: pr.text, proposalId: pr.id, decidedAt: now() };
    this.persist({ type: "proposal", proposal: pr });
    this.setState(room, "concluded");
    if (room.nudgeTimer) clearTimeout(room.nudgeTimer);
    this.post(room, "conclusion", undefined, `CONSENSUS REACHED on ${pr.id}: ${pr.text}`, { proposalId: pr.id });
  }

  private setState(room: Room, state: RoomState) {
    room.state = state;
    this.persist({ type: "state", room: room.name, state, conclusion: room.conclusion });
  }

  // ---------- persistence (append-only JSONL per room) ----------

  private persist(ev: Event) {
    if (!this.dataDir) return;
    const roomName = "room" in ev ? ev.room : ev.type === "message" ? ev.msg.room : ev.proposal.room;
    appendFileSync(join(this.dataDir, `${roomName}.jsonl`), JSON.stringify(ev) + "\n");
  }

  private replay() {
    if (!this.dataDir || !existsSync(this.dataDir)) return;
    for (const file of readdirSync(this.dataDir).filter((f) => f.endsWith(".jsonl"))) {
      const lines = readFileSync(join(this.dataDir, file), "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        const ev = JSON.parse(line) as Event;
        switch (ev.type) {
          case "room": {
            // older logs may lack newer options; fill defaults
            const legacy = ev.opts as Partial<Opts>;
            const opts: Opts = {
              topic: legacy.topic ?? "",
              mode: legacy.mode ?? "free",
              quorum: legacy.quorum ?? "unanimous",
              maxRounds: legacy.maxRounds ?? 0,
              expectedParticipants: legacy.expectedParticipants ?? 0,
              anonymous: legacy.anonymous ?? false,
              maxMessagesPerParticipant: legacy.maxMessagesPerParticipant ?? 0,
              maxMessageChars: legacy.maxMessageChars ?? 4000,
              requireChallenge: legacy.requireChallenge ?? "auto",
              nudgeAfterMs: legacy.nudgeAfterMs ?? 180_000,
            };
            this.materialiseRoom(ev.room, opts, ev.createdAt);
            break;
          }
          case "message":
            this.rooms.get(ev.msg.room)?.messages.push(ev.msg);
            break;
          case "join":
          case "leave": {
            const room = this.rooms.get(ev.room);
            // Participants from a previous process are restored as inactive; they must rejoin.
            const legacyP = ev.p as Partial<Participant> & Pick<Participant, "id" | "name" | "agent" | "joinedAt" | "lastActiveAt" | "lastSeenSeq">;
            room?.participants.set(ev.p.id, { ...legacyP, label: legacyP.label ?? legacyP.name, messageCount: legacyP.messageCount ?? 0, active: false });
            break;
          }
          case "proposal": {
            const room = this.rooms.get(ev.proposal.room);
            const legacyPr = ev.proposal as Partial<Proposal> & Omit<Proposal, "challenges">;
            room?.proposals.set(ev.proposal.id, { ...legacyPr, challenges: legacyPr.challenges ?? [] });
            break;
          }
          case "vote": {
            const pr = this.rooms.get(ev.room)?.proposals.get(ev.proposalId);
            if (pr) pr.votes[ev.pid] = ev.entry;
            break;
          }
          case "challenge": {
            const pr = this.rooms.get(ev.room)?.proposals.get(ev.proposalId);
            pr?.challenges.push(ev.challenge);
            break;
          }
          case "state": {
            const room = this.rooms.get(ev.room);
            if (room) {
              room.state = ev.state;
              room.conclusion = ev.conclusion;
            }
            break;
          }
          case "opening":
            this.rooms.get(ev.room)?.openings.set(ev.pid, ev.content);
            break;
          case "openings_revealed": {
            const room = this.rooms.get(ev.room);
            if (room) room.openingsRevealed = true;
            break;
          }
        }
      }
    }
  }
}
