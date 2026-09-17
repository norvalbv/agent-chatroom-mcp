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

export type MessageKind = "chat" | "system" | "proposal" | "amend" | "challenge" | "vote" | "conclusion" | "board";
export type Vote = "agree" | "disagree" | "abstain";
export type Quorum = "unanimous" | "majority";
export type RoomMode = "free" | "round_robin";
export type RoomState = "open" | "concluded" | "stalled" | "closed";

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
  /** identity of the connection/process that joined; distinct sessions are what the team floor and verify gate count */
  session?: string;
  /** seqs of messages withheld from this participant (human messages awaiting their nominated reply) */
  withheld?: number[];
  /** explicit "nothing to add" turns */
  passes?: number;
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
  /** "opening" marks a blind opening revealed in a batch */
  tag?: "opening";
  /** participant ids named with @ in the content */
  mentions?: string[];
  /** quiet: pushed only to `audience` (sender + mentions); still in the log for everyone */
  quiet?: boolean;
  audience?: string[];
}

export interface BoardEntry {
  text: string;
  by: string;
  updatedAt: string;
  /** set on inbox/* entries posted with ack_required */
  ackRequired?: boolean;
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
  /** bumped by every amend; the text in `text` is always the current version */
  version: number;
  /** when the current text was written (creation or last amend) */
  updatedAt?: string;
  /** voters present when the proposal was made; unanimity is taken over these (late joiners are not waited on) */
  snapshot?: string[];
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
  /** Swarm mode: a proposal needs a verify/* board entry by someone else (bound to the proposal) before it can pass. */
  requireVerification?: boolean;
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
  requireVerification: boolean;
  createdAt: string;
  state: RoomState;
  conclusion?: { text: string; proposalId: string; decidedAt: string };
  participants: Map<string, Participant>;
  messages: Message[];
  proposals: Map<string, Proposal>;
  /** round_robin bookkeeping */
  turnIndex: number;
  turnPid?: string;
  round: number;
  /** long-poll waiters */
  waiters: Set<() => void>;
  /** blind opening statements held back until everyone has submitted */
  openings: Map<string, string>;
  openingsRevealed: boolean;
  nudgeTimer?: NodeJS.Timeout;
  /** shared blackboard: named entries agents update in place instead of re-posting */
  board: Map<string, BoardEntry>;
  /** human message ids the propose-gate has already warned about (once each) */
  humanWarned: Set<string>;
  /** who has been asked to answer each human message, so three agents do not all say hello */
  responders: Map<string, { pid: string; at: number }>;
}

type Opts = Required<RoomOptions>;

type Event =
  | { type: "room"; room: string; opts: Opts; createdAt: string }
  | { type: "message"; msg: Message }
  | { type: "join" | "leave"; room: string; p: Participant }
  | { type: "proposal"; proposal: Proposal }
  | { type: "vote"; room: string; proposalId: string; pid: string; entry: Proposal["votes"][string] }
  | { type: "challenge"; room: string; proposalId: string; challenge: Challenge; votes?: Proposal["votes"] }
  | { type: "state"; room: string; state: RoomState; conclusion?: Room["conclusion"] }
  | { type: "opening"; room: string; pid: string; content: string }
  | { type: "openings_revealed"; room: string }
  | { type: "board"; room: string; key: string; entry: BoardEntry | null }
  | { type: "amend"; room: string; proposalId: string; text: string; version: number; votes: Proposal["votes"]; challenges?: Challenge[] };

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
    if (!r) throw new HubError(Hub.ROOM_NAME.test(name) ? `Room "${name}" does not exist. Use join_room (it auto-creates) or list_rooms.` : "Invalid room name.");
    return r;
  }

  static readonly MAX_ROOMS = 500;
  static MAX_ROOMS_PER_RUN = Number(process.env.CHATROOM_MAX_ROOMS_PER_RUN ?? 12);
  static MAX_LIVE_PER_ROOM = Number(process.env.CHATROOM_MAX_LIVE_PER_ROOM ?? 12);
  static readonly ROOM_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
  /** "swarm-093235-fsxs-leads" -> "swarm-093235-fsxs" */
  static runPrefix(name: string): string | undefined {
    const m = /^(swarm-[0-9]{6}(?:-[a-z0-9]{4})?)-/.exec(name);
    return m?.[1];
  }

  createRoom(name: string, opts: RoomOptions = {}): Room {
    const existing = this.rooms.get(name);
    if (existing) return existing;
    if (!Hub.ROOM_NAME.test(name)) {
      throw new HubError(`Room name must match [a-zA-Z0-9_-]{1,64}.`);
    }
    if (this.rooms.size >= Hub.MAX_ROOMS) throw new HubError(`Room limit (${Hub.MAX_ROOMS}) reached.`);
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
      requireVerification: opts.requireVerification ?? false,
    };
    // Per-run room cap: rooms sharing a swarm prefix (swarm-<id>-*) are counted together.
    const prefix = Hub.runPrefix(name);
    if (prefix && [...this.rooms.keys()].filter((r) => Hub.runPrefix(r) === prefix && this.rooms.get(r)!.state === "open").length >= Hub.MAX_ROOMS_PER_RUN) {
      throw new HubError(`Room limit for this run (${Hub.MAX_ROOMS_PER_RUN} open rooms with prefix ${prefix}) reached. Close or conclude a room first.`);
    }
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
      board: new Map(),
      humanWarned: new Set(),
      responders: new Map(),
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
      require_verification: room.requireVerification,
      hold: this.hold(room) ? { by: this.hold(room)!.by, reason: this.hold(room)!.text } : null,
      state: room.state,
      created_at: room.createdAt,
      openings: room.openingsRevealed
        ? "revealed"
        : `${room.openings.size} submitted, waiting for ${this.openingsWaitingOn(room, reveal).join(", ") || "nobody"}`,
      round: room.round,
      current_turn: room.mode === "round_robin" && speaker ? nm(speaker) : null,
      participants: [...room.participants.values()].map((p) => ({
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
      board: Object.fromEntries([...room.board].map(([k, e]) => [k, { text: e.text, by: e.by, updated_at: e.updatedAt }])),
      quiet: (() => {
        const qs = room.messages.filter((m) => m.quiet);
        return { messages: qs.length, unsurfaced_threads: new Set(qs.map((m) => this.threadRoot(room, m).id)).size };
      })(),
      unanswered_human: (() => {
        const m = this.unansweredHuman(room);
        return m ? { id: m.id, name: m.from.name, text: m.content } : null;
      })(),
      conclusion: room.conclusion ?? null,
    };
  }

  stats(room: Room) {
    const first = room.messages[0]?.ts;
    const last = room.messages.at(-1)?.ts;
    const chat = room.messages.filter((m) => m.kind === "chat" && m.tag !== "opening");
    // bursts: chat messages posted within 5s of the previous chat message by someone else (opening reveals excluded)
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
        passes: p.passes ?? 0,
        chars: room.messages.filter((m) => m.from.id === p.id && m.kind === "chat").reduce((a, m) => a + m.content.length, 0),
      })),
      proposals: room.proposals.size,
      amendments: [...room.proposals.values()].reduce((a, p) => a + (p.version - 1), 0),
      challenges: [...room.proposals.values()].reduce((a, p) => a + p.challenges.length, 0),
      board_entries: room.board.size,
      near_simultaneous_replies: bursts,
      unanswered_human_messages: room.messages.filter((m) => m.kind === "chat" && m.from.agent === "human" && !this.isAnswered(room, m)).length,
    };
  }

  // ---------- participants ----------

  join(roomName: string, name: string, agent: string, opts: RoomOptions = {}, reclaimId?: string, session?: string): { room: Room; participant: Participant } {
    const room = this.createRoom(roomName, opts);
    if (!name.trim()) throw new HubError("A display name is required to join.");
    if (name.length > 64) throw new HubError("Display names are capped at 64 characters.");
    if (!/^[^\n\r<>]+$/.test(name)) throw new HubError("Display names cannot contain newlines or angle brackets.");

    let participant = reclaimId ? room.participants.get(reclaimId) : undefined;
    if (participant && participant.name !== name) throw new HubError("participant_id does not belong to that name.");
    if (!participant) participant = [...room.participants.values()].find((p) => p.name === name && !p.active);
    // Humans are identified by name alone (they come in over plain HTTP with no session), so they always reclaim.
    if (!participant && agent === "human") participant = [...room.participants.values()].find((p) => p.name === name && p.agent === "human");
    if (!participant) {
      if ([...room.participants.values()].some((p) => p.name === name && p.active)) {
        throw new HubError(`Someone named "${name}" is already active in "${roomName}". Pick another name.`);
      }
      if (agent !== "human" && this.voters(room).length >= Hub.MAX_LIVE_PER_ROOM) {
        this.post(room, "system", undefined, `Cap hit: ${Hub.MAX_LIVE_PER_ROOM} live agents in this room; ${name} could not join. Recruit into a new room instead.`);
        throw new HubError(`Room "${roomName}" already has ${Hub.MAX_LIVE_PER_ROOM} live agents (per-run cap). Open a sub-room instead.`);
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
        session,
      };
      room.participants.set(participant.id, participant);
      this.persist({ type: "join", room: roomName, p: participant });
      this.post(room, "system", undefined, `${this.shown(room, participant)}${room.anonymous ? "" : ` (${agent})`} joined the room.`);
    } else if (!participant.active) {
      participant.active = true;
      participant.lastActiveAt = now();
      if (session) participant.session = session;
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
    const v = this.voters(room);
    if (v.length === 0) return undefined;
    const cur = room.turnPid ? v.find((p) => p.id === room.turnPid) : undefined;
    if (cur) return cur;
    // previous speaker left (or none yet): floor goes to the first voter after their position
    room.turnPid = v[room.turnIndex % v.length].id;
    return v[room.turnIndex % v.length];
  }

  // ---------- messages ----------

  /** Substantive messages from others that this participant has not read yet (system notices do not count). */
  unread(room: Room, p: Participant): Message[] {
    // system notices, and human messages someone else has already answered, never block a send
    return this.deliverable(room, p, p.lastSeenSeq).filter((m) => m.kind !== "system" && !(m.from.agent === "human" && this.isAnswered(room, m)));
  }

  /** Push predicate: quiet messages are pushed only to their audience. Everything else defers to visibleTo. Never used by read(). */
  pushableTo(room: Room, m: Message, pid: string | undefined): boolean {
    if (m.quiet && pid && !(m.audience ?? []).includes(pid)) return false;
    return this.visibleTo(room, m, pid);
  }

  /** Messages this participant has not seen: new pushable ones plus previously withheld ones that are now visible. */
  deliverable(room: Room, p: Participant, since: number): Message[] {
    const held = new Set(p.withheld ?? []);
    return room.messages.filter((m) => m.from.id !== p.id && ((m.seq > since && this.pushableTo(room, m, p.id)) || (held.has(m.seq) && this.visibleTo(room, m, p.id))));
  }

  /** Root of a quiet thread: follow reply_to up to the first quiet message. */
  threadRoot(room: Room, m: Message): Message {
    let cur = m;
    for (let i = 0; i < 50 && cur.replyTo; i++) {
      const parent = room.messages.find((x) => x.id === cur.replyTo);
      if (!parent || !parent.quiet) break;
      cur = parent;
    }
    return cur;
  }

  /** Quiet threads this participant is not part of, collapsed to counts (content excluded). */
  quietActivity(room: Room, p: Participant, since: number) {
    const rows = new Map<string, { thread_id: string; participants: Set<string>; message_count: number; chars: number; last_seq: number }>();
    for (const m of room.messages) {
      if (!m.quiet || m.seq <= since || (m.audience ?? []).includes(p.id)) continue;
      const root = this.threadRoot(room, m);
      const row = rows.get(root.id) ?? { thread_id: root.id, participants: new Set<string>(), message_count: 0, chars: 0, last_seq: 0 };
      for (const id of m.audience ?? []) row.participants.add(this.shown(room, room.participants.get(id) ?? { id, name: id }));
      row.message_count++;
      row.chars += m.content.length;
      row.last_seq = Math.max(row.last_seq, m.seq);
      rows.set(root.id, row);
    }
    return [...rows.values()].map((r) => ({ ...r, participants: [...r.participants] }));
  }

  /** Make a quiet thread public: clear quiet on the chain and re-park its seqs for everyone outside the audience, once. */
  surfaceThread(room: Room, rootId: string, reason: string): number {
    const root = room.messages.find((x) => x.id === rootId);
    if (!root || !root.quiet) return 0;
    const chain = room.messages.filter((m) => m.quiet && this.threadRoot(room, m).id === root.id);
    const audience = new Set(root.audience ?? []);
    for (const m of chain) m.quiet = false;
    for (const p of this.activeParticipants(room)) {
      if (audience.has(p.id)) continue;
      const held = new Set(p.withheld ?? []);
      for (const m of chain) if (m.seq <= p.lastSeenSeq) held.add(m.seq); // already past their cursor: re-park so it is delivered
      p.withheld = [...held];
    }
    this.post(room, "system", undefined, `Quiet thread ${root.id} (${chain.length} messages between ${[...audience].map((id) => this.shown(room, room.participants.get(id) ?? { id, name: id })).join(", ")}) is now public: ${reason}.`);
    return chain.length;
  }

  /** Surface every quiet thread whose message id is cited in `text`. */
  surfaceCited(room: Room, text: string, reason: string) {
    for (const id of new Set(text.match(/m_[0-9a-f]{8}/g) ?? [])) {
      const m = room.messages.find((x) => x.id === id);
      if (m?.quiet) this.surfaceThread(room, this.threadRoot(room, m).id, reason);
    }
  }

  /** Advance the read cursor, remembering anything withheld so it is delivered later. */
  private settleRead(room: Room, p: Participant, since: number, delivered: Message[]) {
    const deliveredSeqs = new Set(delivered.map((m) => m.seq));
    const still = (p.withheld ?? []).filter((seq) => !deliveredSeqs.has(seq));
    for (const m of room.messages) if (m.seq > since && m.from.id !== p.id && !this.visibleTo(room, m, p.id) && !still.includes(m.seq)) still.push(m.seq);
    p.withheld = still.length > 200 ? still.slice(-200) : still;
    this.markRead(room, p, room.messages.at(-1)?.seq ?? since);
  }

  send(roomName: string, pid: string, content: string, replyTo?: string, force = false, quiet = false, surface = false): Message {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    if (quiet && p.agent === "human") throw new HubError("Humans speak to the room; quiet is for agent working exchanges.");
    if (surface && replyTo) {
      const parent = room.messages.find((m) => m.id === replyTo);
      if (parent?.quiet) this.surfaceThread(room, this.threadRoot(room, parent).id, `${this.shown(room, p)} surfaced it`);
      quiet = false; // a surfacing reply is public by definition
    }
    // Chat stays open after a conclusion so humans can still be answered; only proposals close.
    if (!content.trim()) throw new HubError("Message content is empty.");
    if (content.length > room.maxMessageChars) {
      throw new HubError(`Message is ${content.length} chars; this room allows ${room.maxMessageChars}. Say less: one claim, one reason, one ask.`);
    }
    const target = p.agent === "human" ? undefined : this.addressedHuman(room, content, replyTo);
    if (target) {
      const small = this.isSmallTalk(target);
      const to = this.addressee(room, target);
      const answered = this.isAnswered(room, target);
      const resp = this.responderFor(room, target, p.id);
      if (to && to !== "all" && to !== p.id) {
        throw new HubError(`${this.shown(room, target.from)} addressed that to ${resp.who}, not you. Leave it to them.`);
      }
      if (small && answered && !resp.mine) {
        throw new HubError(
          `${resp.who} already answered ${this.shown(room, target.from)}'s "${target.content.slice(0, 60)}". One reply is enough; do not address them again unless they ask you something.`,
        );
      }
      const cap = small ? 240 : 900;
      if (content.length > cap) {
        throw new HubError(
          `${this.shown(room, target.from)} wrote ${target.content.length} characters; match their register. A reply to that message is capped at ${cap} characters` +
            (small ? " (a greeting gets a greeting, not a status report)." : ". Answer the question; keep the debate out of it."),
        );
      }
      if (!replyTo) replyTo = target.id; // record the addressing so the room knows it was answered
    }
    if (room.maxMessagesPerParticipant && p.messageCount >= room.maxMessagesPerParticipant && p.agent !== "human" && !this.unansweredHuman(room)) {
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
    if (!force && !quiet && !target && p.agent !== "human" && room.mode === "free" && this.addressedBy(room, p).length === 0) {
      const sh = this.share(room, p);
      const last = room.messages.at(-1);
      const roomActive = last && Date.now() - Date.parse(last.ts) < 20_000;
      if (sh.over && roomActive) {
        throw new HubError(
          `You have sent ${sh.mine} of the last ${sh.of} messages (fair share is about ${Math.round(sh.fair * sh.of)}). Let the others speak: call pass, ` +
            `or wait_for_messages. Send again only with genuinely new evidence (force=true).`,
          { your_share: sh },
        );
      }
    }
    if (room.mode === "round_robin") this.advanceTurn(room);
    let audience: string[] | undefined;
    if (quiet) {
      const mentions = this.mentionsIn(room, content).filter((id) => id !== p.id);
      const parent = replyTo ? room.messages.find((m) => m.id === replyTo) : undefined;
      const inherited = parent?.quiet ? (parent.audience ?? []) : [];
      const targets = [...new Set([...mentions, ...inherited])].filter((id) => room.participants.get(id)?.agent !== "human");
      if (targets.length === 0) throw new HubError("A quiet message must @-name at least one agent (not a human). Quiet is not privacy: everyone can still read it.");
      audience = [...new Set([p.id, ...targets])];
    }
    const msg = this.post(room, "chat", p, content, { replyTo, ...(quiet ? { quiet: true, audience } : {}) });
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
    const v = this.voters(room);
    if (v.length === 0) return;
    const i = Math.max(0, v.findIndex((p) => p.id === room.turnPid));
    room.turnIndex = (i + 1) % v.length;
    room.turnPid = v[room.turnIndex].id;
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

  read(roomName: string, sinceSeq = 0, limit = 200, viewerPid?: string): Message[] {
    const room = this.getRoom(roomName);
    return room.messages.filter((m) => m.seq > sinceSeq && this.visibleTo(room, m, viewerPid)).slice(0, limit);
  }

  /**
   * Long-poll: resolves as soon as there is a message from someone else with
   * seq > sinceSeq (or immediately if there already is one), otherwise after timeoutMs.
   */
  async wait(roomName: string, pid: string | undefined, sinceSeq: number, timeoutMs: number): Promise<Message[]> {
    const room = this.getRoom(roomName);
    const p = pid ? room.participants.get(pid) : undefined;
    const pending = () => (p ? this.deliverable(room, p, sinceSeq) : room.messages.filter((m) => m.seq > sinceSeq));
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
    if (p) this.settleRead(room, p, sinceSeq, msgs);
    return msgs;
  }

  /** Plain-text rendering of a message as agents see it (pseudonyms in anonymous rooms). */
  fmt(room: Room, m: Message): string {
    const tag = m.kind === "chat" ? "" : `[${m.kind.toUpperCase()}] `;
    const who = m.from.id === "system" ? "system" : this.shown(room, m.from);
    const q = m.audience ? `[${m.quiet ? "quiet" : "was quiet"} → ${m.audience.filter((id) => id !== m.from.id).map((id) => this.shown(room, room.participants.get(id) ?? { id, name: id })).join(", ")}] ` : "";
    return `#${m.seq} ${who}: ${q}${tag}${m.content}`;
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
    if (kind === "chat") {
      const mentions = this.mentionsIn(room, content);
      if (mentions.length) msg.mentions = mentions;
    }
    room.messages.push(msg);
    if (from) from.lastActiveAt = msg.ts;
    this.persist({ type: "message", msg });
    this.notify(room);
    this.armNudge(room);
    return msg;
  }

  /** Post a system notice from outside the hub (e.g. a recruitment). */
  announce(roomName: string, text: string): Message {
    return this.post(this.getRoom(roomName), "system", undefined, text);
  }

  private notify(room: Room) {
    for (const wake of [...room.waiters]) wake();
  }

  /** After a period of silence in an open room, remind people what is blocking. */
  private armNudge(room: Room) {
    if (room.nudgeTimer) clearTimeout(room.nudgeTimer);
    if (!room.nudgeAfterMs || room.state === "concluded" || room.state === "closed") return;
    room.nudgeTimer = setTimeout(() => {
      if (room.state === "concluded" || this.activeParticipants(room).length === 0) return;
      const open = [...room.proposals.values()].find((pr) => pr.status === "open");
      const mins = Math.round(room.nudgeAfterMs / 60000);
      if (open) {
        const waiting = this.voters(room)
          .filter((p) => !open.votes[p.id])
          .map((p) => this.shown(room, p));
        const needsChallenge = this.challengeRequired(room) && open.challenges.length === 0;
        const needsVerify = room.requireVerification && !this.verifiedBy(room, open);
        this.post(
          room,
          "system",
          undefined,
          `${mins} min of silence. Proposal ${open.id} is open` +
            (waiting.length ? `; still waiting for votes from ${waiting.join(", ")}` : "") +
            (needsChallenge ? `; it also needs a challenge from someone other than ${this.shown(room, open.by)} before it can pass` : "") +
            (needsVerify ? `; and a verify/* board entry by someone else naming ${open.id}` : "") +
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
    const cap = Math.min(room.maxMessageChars, 400);
    if (content.length > cap) throw new HubError(`Opening is ${content.length} chars; openings are capped at ${cap}. One or two sentences: your answer and the main reason. Detail goes in the discussion or on the board.`);
    room.openings.set(p.id, content);
    this.persist({ type: "opening", room: roomName, pid: p.id, content });
    const waiting = this.openingsWaitingOn(room);
    if (waiting.length === 0) this.revealOpenings(room);
    return { revealed: room.openingsRevealed, waiting_on: waiting };
  }

  private revealOpenings(room: Room) {
    room.openingsRevealed = true;
    this.persist({ type: "openings_revealed", room: room.name });
    this.post(room, "system", undefined, `Opening answers (${room.openings.size}, written independently):`);
    for (const [pid, content] of room.openings) {
      const p = room.participants.get(pid);
      if (p) this.post(room, "chat", p, content, { tag: "opening" });
    }
    if (room.mode === "round_robin") room.round = 2;
  }

  // ---------- participation share ----------

  /** This agent's share of the recent agent-to-agent chat (last 12 messages, openings and humans excluded). */
  share(room: Room, p: Participant): { mine: number; of: number; fair: number; over: boolean } {
    const recent = room.messages.filter((m) => m.kind === "chat" && m.tag !== "opening" && m.from.agent !== "human" && !m.quiet).slice(-12);
    const mine = recent.filter((m) => m.from.id === p.id).length;
    const n = Math.max(1, this.voters(room).length);
    const fair = 1 / n;
    const over = n >= 3 && recent.length >= 4 && mine / recent.length > fair * 1.5;
    return { mine, of: recent.length, fair: Math.round(fair * 100) / 100, over };
  }

  /** "I have read everything and have nothing to add." Silent in free mode; yields the turn in round_robin. */
  pass(roomName: string, pid: string): { yielded_turn: boolean; next_seq: number } {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    p.passes = (p.passes ?? 0) + 1;
    this.markRead(room, p, room.messages.at(-1)?.seq ?? 0);
    let yielded = false;
    if (room.mode === "round_robin" && this.currentSpeaker(room)?.id === p.id) {
      this.advanceTurn(room);
      yielded = true;
      this.post(room, "system", undefined, `${this.shown(room, p)} passes.`);
    }
    return { yielded_turn: yielded, next_seq: room.messages.at(-1)?.seq ?? 0 };
  }

  // ---------- humans in the loop ----------

  /** A human chat message counts as answered once a non-human replies to it (reply_to) or names them afterwards. */
  isAnswered(room: Room, human: Message): boolean {
    const p = room.participants.get(human.from.id);
    const names = [human.from.name, p?.label].filter(Boolean).map((n) => n!.toLowerCase());
    // a later human message means an un-addressed "hi benji" reply belongs to that one, not this one
    const nextHumanSeq = room.messages.find((m) => m.seq > human.seq && m.kind === "chat" && m.from.agent === "human")?.seq ?? Infinity;
    return room.messages.some(
      (m) =>
        m.seq > human.seq &&
        m.kind === "chat" &&
        m.from.agent !== "human" &&
        (m.replyTo === human.id || (m.seq < nextHumanSeq && names.some((n) => m.content.toLowerCase().includes(n)))),
    );
  }

  /** The newest human chat message nobody has answered yet (older unanswered ones still count). */
  unansweredHuman(room: Room): Message | undefined {
    for (let i = room.messages.length - 1; i >= 0; i--) {
      const m = room.messages[i];
      if (m.kind === "chat" && m.from.agent === "human" && m.tag !== "opening" && !this.isAnswered(room, m)) return m;
    }
    return undefined;
  }

  /** Small talk is anything short with no question in it. */
  isSmallTalk(m: Message): boolean {
    return m.content.trim().length < 60 && !m.content.includes("?");
  }

  /** "@name ..." or "@all ..." at the start of a human message picks who should answer. */
  addressee(room: Room, human: Message): string | "all" | undefined {
    const m = /^@([\w-]+(?: [A-Za-z]\b)?)/.exec(human.content.trim());
    if (!m) return undefined;
    const key = m[1].toLowerCase();
    if (key === "all" || key === "everyone") return "all";
    const p = [...room.participants.values()].find(
      (x) => x.name.toLowerCase() === key || x.label.toLowerCase() === key || x.label.toLowerCase() === `participant ${key}`,
    );
    return p?.id;
  }

  /** All participants named with @ anywhere in a message: @claude-2, @B, @"Participant B". */
  mentionsIn(room: Room, content: string): string[] {
    const ids = new Set<string>();
    for (const m of content.matchAll(/@([\w-]+(?: [A-Za-z]\b)?)/g)) {
      const key = m[1].toLowerCase();
      for (const p of room.participants.values()) {
        const label = p.label.toLowerCase();
        if (p.name.toLowerCase() === key || label === key || label === `participant ${key}` || (key.length === 1 && label.endsWith(` ${key}`))) ids.add(p.id);
      }
    }
    return [...ids];
  }

  /** Was this participant addressed by name in any recent message they have not yet answered? */
  addressedBy(room: Room, p: Participant): Message[] {
    const recent = room.messages.filter((m) => m.kind === "chat" && m.mentions?.includes(p.id) && m.from.id !== p.id && this.pushableTo(room, m, p.id)).slice(-10);
    return recent.filter((m) => !room.messages.some((r) => r.seq > m.seq && r.from.id === p.id && r.kind === "chat"));
  }

  /**
   * Nominate one agent to answer a human message. An @-addressed agent gets it; otherwise the
   * first agent to ask. If the nominee has not replied within 20s (60s when @-addressed) the
   * next asker takes over. Everyone else is told it is covered.
   */
  responderFor(room: Room, human: Message, pid: string): { mine: boolean; who: string } {
    const to = this.addressee(room, human);
    if (to === "all") return { mine: true, who: "everyone" };
    const age = Date.now() - Date.parse(human.ts);
    if (to && room.participants.get(to)?.active && age < 60_000) {
      return { mine: pid === to, who: this.shown(room, room.participants.get(to)!) };
    }
    const cur = room.responders.get(human.id);
    // once answered, the nomination is final: no takeover after the TTL
    if (cur && this.isAnswered(room, human)) return { mine: cur.pid === pid, who: this.shown(room, room.participants.get(cur.pid) ?? { id: cur.pid, name: "someone" }) };
    if (!cur || (cur.pid !== pid && Date.now() - cur.at > 20_000) || !room.participants.get(cur.pid)?.active) {
      room.responders.set(human.id, { pid, at: Date.now() });
      return { mine: true, who: this.shown(room, room.participants.get(pid)!) };
    }
    return { mine: cur.pid === pid, who: this.shown(room, room.participants.get(cur.pid)!) };
  }

  /**
   * Withheld delivery: an unanswered human message is shown only to its nominated responder
   * (for up to 20s, 60s when @-addressed). Everyone else sees it together with the reply, so
   * there is nothing to react to.
   */
  visibleTo(room: Room, m: Message, pid: string | undefined): boolean {
    if (!pid || m.kind !== "chat" || m.from.agent !== "human" || m.from.id === pid) return true;
    if (this.isAnswered(room, m)) return true;
    const to = this.addressee(room, m);
    const age = Date.now() - Date.parse(m.ts);
    if (age > (to && to !== "all" ? 60_000 : 20_000)) return true;
    return this.responderFor(room, m, pid).mine;
  }

  /** The human message a non-human chat message is addressing, if any. */
  addressedHuman(room: Room, content: string, replyTo?: string): Message | undefined {
    if (replyTo) {
      const t = room.messages.find((m) => m.id === replyTo);
      if (t?.from.agent === "human") return t;
    }
    const lower = content.toLowerCase();
    const humans = [...room.participants.values()].filter((p) => p.agent === "human");
    for (let i = room.messages.length - 1; i >= 0; i--) {
      const m = room.messages[i];
      if (m.kind !== "chat" || m.from.agent !== "human") continue;
      const p = humans.find((h) => h.id === m.from.id);
      const names = [m.from.name, p?.label].filter(Boolean).map((n) => n!.toLowerCase());
      if (names.some((n) => lower.includes(n))) return m;
      break; // only the most recent human message can be addressed by name
    }
    return undefined;
  }

  // ---------- shared board ----------

  static readonly BOARD_KEY = /^[\w .:/-]{1,80}$/;

  hold(room: Room): BoardEntry | undefined {
    return room.board.get(`hold/${room.name}`);
  }

  /** inbox/* entries that asked for an acknowledgement and have none yet. */
  unacknowledged(room: Room): string[] {
    return [...room.board.entries()].filter(([k, e]) => k.startsWith("inbox/") && !k.endsWith(".ack") && e.ackRequired && !room.board.has(`${k}.ack`)).map(([k]) => k);
  }

  /** Distinct connections among a set of participants (two names on one connection are one agent). */
  static sessionsOf(ps: Participant[]): number {
    return new Set(ps.map((p) => p.session ?? `nosession:${p.id}`)).size;
  }

  setBoard(roomName: string, pid: string, key: string, text: string, opts: { ifAbsent?: boolean; ifByMe?: boolean; overwrite?: boolean } = {}): BoardEntry | null {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    if (!Hub.BOARD_KEY.test(key)) throw new HubError("Board keys are short names like 'evidence', 'open questions', 'claim/auth', 'verify/auth'.");
    if (text.length > 8000) throw new HubError("Board entries are capped at 8000 characters.");
    const previous = room.board.get(key);
    // reserved prefixes (enforced here, the single write site)
    if (key.startsWith("inbox/") && !key.endsWith(".ack")) throw new HubError("inbox/* entries are written by post_to_room from another room. To acknowledge one, write '<key>.ack'.");
    if (key.startsWith("hold/")) {
      if (key !== `hold/${room.name}`) throw new HubError(`A hold for this room is the key "hold/${room.name}".`);
      if (previous && previous.by !== p.name) throw new HubError(`The hold was placed by ${previous.by}; only they (or a human) can clear or change it.`);
    }
    if (key.startsWith("claim/")) {
      if (previous && previous.by !== p.name) throw new HubError(`claim "${key}" is owned by ${previous.by} (since ${previous.updatedAt}). Join their team via help/ or join-request/, or pick another area.`);
      if (text.trim()) {
        let parsed: { status?: string; team?: unknown } | undefined;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new HubError('claim/* entries are JSON: {"area":..., "owner":..., "team":[names], "status":"open|fixed|verified", "note":...}');
        }
        if (parsed && (parsed.status === "fixed" || parsed.status === "verified")) {
          const team = Array.isArray(parsed.team) ? (parsed.team as unknown[]).map(String) : [];
          const members = this.activeParticipants(room).filter((x) => team.includes(x.name) && x.agent !== "human");
          if (members.length < 2 || Hub.sessionsOf(members) < 2) {
            throw new HubError(`A claim can only be marked ${parsed.status} by a team of 2+ distinct active agents; team=${JSON.stringify(team)} has ${members.length} active on ${Hub.sessionsOf(members)} connection(s).`);
          }
        }
      }
    }
    if (opts.ifAbsent && previous) throw new HubError(`"${key}" already exists (by ${previous.by}, ${previous.updatedAt}).`, { existing: previous });
    if (opts.ifByMe && previous && previous.by !== p.name) throw new HubError(`"${key}" was written by ${previous.by}, not you. Use post_to_room or a different key.`);
    if (previous && previous.by !== p.name && !opts.overwrite && text.trim()) {
      throw new HubError(
        `"${key}" was written by ${previous.by} at ${previous.updatedAt}; replacing it would discard their text. Merge with the current content below and resend with overwrite=true, or use your own key.`,
        { current: previous },
      );
    }
    if (!text.trim()) {
      room.board.delete(key);
      this.persist({ type: "board", room: roomName, key, entry: null });
      this.post(room, "board", p, `cleared board entry "${key}"`);
      if (key === `hold/${room.name}`) for (const pr of room.proposals.values()) if (pr.status === "open") this.evaluate(room, pr);
      return null;
    }
    this.surfaceCited(room, text, `cited on the board under ${key}`);
    const entry: BoardEntry = { text, by: p.name, updatedAt: now() };
    room.board.set(key, entry);
    this.persist({ type: "board", room: roomName, key, entry });
    this.post(room, "board", p, `${previous ? "updated" : "added"} board entry "${key}" (${text.length} chars; read it with board_get)`);
    if (key.endsWith(".ack") || key.startsWith("verify/")) for (const pr of room.proposals.values()) if (pr.status === "open") this.evaluate(room, pr);
    return entry;
  }

  /** System-initiated board write on someone's behalf (e.g. a claim made at recruitment); no membership needed. */
  setBoardAs(roomName: string, byName: string, key: string, text: string): BoardEntry {
    const room = this.getRoom(roomName);
    if (!Hub.BOARD_KEY.test(key)) throw new HubError("Invalid board key.");
    const entry: BoardEntry = { text, by: byName, updatedAt: now() };
    room.board.set(key, entry);
    this.persist({ type: "board", room: roomName, key, entry });
    this.post(room, "board", undefined, `${byName} added board entry "${key}" (${text.length} chars; read it with board_get)`);
    return entry;
  }

  /** Cross-room note: written into the target room's board under inbox/<from>/<key> without joining it. */
  postToRoom(fromRoom: string, pid: string, toRoom: string, key: string, text: string, ackRequired = false): { key: string; entry: BoardEntry } {
    const from = this.getRoom(fromRoom);
    const p = this.requireParticipant(from, pid);
    if (toRoom === fromRoom) throw new HubError("That is your own room; use board_set.");
    const to = this.getRoom(toRoom);
    if (!/^[\w .:-]{1,40}$/.test(key)) throw new HubError("Inbox keys are short names without slashes.");
    if (text.length > 8000) throw new HubError("Notes are capped at 8000 characters.");
    const live = [...to.board.keys()].filter((k) => k.startsWith("inbox/") && !k.endsWith(".ack")).length;
    if (live >= 10) throw new HubError(`${toRoom} already has 10 inbox notes; wait for them to be acknowledged or cleared.`);
    const full = `inbox/${fromRoom}/${key}`;
    const entry: BoardEntry = { text, by: p.name, updatedAt: now(), ...(ackRequired ? { ackRequired: true } : {}) };
    to.board.set(full, entry);
    this.persist({ type: "board", room: toRoom, key: full, entry });
    this.post(to, "system", undefined, `Note from ${p.name} in ${fromRoom} on the board as "${full}"${ackRequired ? ` (acknowledge by writing "${full}.ack")` : ""}: ${text.slice(0, 160)}${text.length > 160 ? "…" : ""}`);
    return { key: full, entry };
  }

  // ---------- proposals as documents ----------

  /**
   * Edit the open proposal in place. Posts only the diff, bumps the version, and
   * resets everyone's vote except the amender's (the text they are agreeing to changed).
   */
  amend(roomName: string, pid: string, proposalId: string, find: string, replace: string): { proposal: Proposal; diff: string } {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    const pr = room.proposals.get(proposalId);
    if (!pr) throw new HubError(`No proposal "${proposalId}" in "${roomName}".`);
    if (pr.status !== "open") throw new HubError(`Proposal ${proposalId} is ${pr.status}; only open proposals can be amended.`);
    let next: string;
    if (!find) {
      if (!replace.trim()) throw new HubError("Nothing to append.");
      next = pr.text.trimEnd() + "\n" + replace;
    } else {
      const n = pr.text.split(find).length - 1;
      if (n === 0) throw new HubError(`"${find.slice(0, 80)}" does not occur in the proposal. Copy the exact text to replace. Current text:\n${pr.text}`);
      if (n > 1) throw new HubError(`"${find.slice(0, 80)}" occurs ${n} times; include more context so it is unique.`);
      next = pr.text.replace(find, replace);
    }
    if (next === pr.text) throw new HubError("That amendment changes nothing.");
    const changed = Math.abs(next.length - pr.text.length) + (find ? find.length : 0);
    const stale = changed > pr.text.length * 0.25 && pr.challenges.length > 0;
    pr.text = next;
    pr.version += 1;
    pr.updatedAt = now();
    pr.votes = { [p.id]: { vote: "agree", name: p.name, ts: now(), reason: `amended to v${pr.version}` } };
    if (stale) pr.challenges = []; // the challenged text no longer exists; the gate must be satisfied again
    this.persist({ type: "amend", room: roomName, proposalId, text: pr.text, version: pr.version, votes: pr.votes, challenges: pr.challenges });
    const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n) + "…" : t);
    const diff = find ? `"${clip(find, 160)}" → "${clip(replace, 240)}"` : `appended "${clip(replace, 240)}"`;
    this.post(room, "amend", p, `AMENDED ${proposalId} to v${pr.version}: ${diff}\n(votes reset${stale ? ", earlier challenges no longer apply" : ""}; read the current text in room_status and re-vote)`, { proposalId });
    return { proposal: pr, diff };
  }

  // ---------- consensus ----------

  challengeRequired(room: Room): boolean {
    if (room.requireChallenge === "auto") return this.voters(room).length >= 3;
    return room.requireChallenge;
  }

  propose(roomName: string, pid: string, text: string): Proposal {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    if (room.state === "concluded" || room.state === "closed") throw new HubError(`Room "${roomName}" is ${room.state}.`);
    if (!text.trim()) throw new HubError("Proposal text is empty.");
    const open = [...room.proposals.values()].find((pr) => pr.status === "open");
    if (open) {
      throw new HubError(
        `Proposal ${open.id} by ${this.shown(room, open.by)} is already open (v${open.version}): "${open.text.slice(0, 200)}". ` +
          `Do not re-propose: use amend to change its wording, challenge it, or vote on it.`,
      );
    }
    const voters = this.voters(room);
    if (room.expectedParticipants !== 1 && Hub.sessionsOf(voters) < 2) {
      throw new HubError("A room of one cannot conclude: at least two agents on different connections must be present. Recruit (request_agent) or ask someone to join.");
    }
    if (room.requireVerification && ![...room.board.keys()].some((k) => k.startsWith("verify/"))) {
      throw new HubError("This room requires verification: before proposing, put the command you actually ran, its cwd/commit and its exit code on the board under verify/<area>. Someone else must then run it and write their own verify/* entry naming the proposal id.");
    }
    const unacked = this.unacknowledged(room);
    if (unacked.length) throw new HubError(`Acknowledge the notes from other rooms first (write "<key>.ack"): ${unacked.join(", ")}`);
    const human = this.unansweredHuman(room);
    if (human && !room.humanWarned.has(human.id)) {
      room.humanWarned.add(human.id);
      throw new HubError(
        `${this.shown(room, human.from)} (a human) said "${human.content.slice(0, 200)}" (message ${human.id}) and nobody has answered. ` +
          `Reply to them first with send_message reply_to="${human.id}" in plain prose, then propose.`,
      );
    }
    this.surfaceCited(room, text, "cited in a proposal");
    const proposal: Proposal = {
      id: shortId("prop"),
      room: roomName,
      by: { id: p.id, name: p.name },
      text,
      createdAt: now(),
      votes: { [p.id]: { vote: "agree", name: p.name, ts: now(), reason: "proposer" } },
      challenges: [],
      status: "open",
      version: 1,
      updatedAt: now(),
      snapshot: voters.map((v) => v.id),
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
    this.surfaceCited(room, objection, "cited in a challenge");
    const challenge: Challenge = { by: { id: p.id, name: p.name }, objection, ts: now() };
    pr.challenges.push(challenge);
    // A challenge must be answered: the challenger's own vote (if any) is reset and must be re-cast
    // after the room has responded, so the proposal cannot pass in the same breath.
    delete pr.votes[p.id];
    this.persist({ type: "challenge", room: roomName, proposalId, challenge, votes: pr.votes });
    this.post(
      room,
      "challenge",
      p,
      `${objection}\n(challenge to ${proposalId}; ${this.shown(room, p)} re-votes once it is answered)`,
      { proposalId },
    );
    this.evaluate(room, pr); // a non-voter's challenge can unpark an already-unanimous proposal
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
      version: pr.version,
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
  /** A verify/* entry by a different agent (different connection), newer than the proposal text, naming the proposal. */
  verifiedBy(room: Room, pr: Proposal): BoardEntry | undefined {
    const proposer = room.participants.get(pr.by.id);
    for (const [k, e] of room.board) {
      if (!k.startsWith("verify/") || k.endsWith(".partial")) continue;
      if (e.by === pr.by.name) continue;
      const author = [...room.participants.values()].find((x) => x.name === e.by);
      if (author && proposer && author.session && author.session === proposer.session) continue; // same process, two names
      if (pr.updatedAt && e.updatedAt < pr.updatedAt) continue;
      if (!e.text.includes(pr.id)) continue;
      return e;
    }
    return undefined;
  }

  private evaluate(room: Room, pr: Proposal) {
    if (pr.status !== "open" || room.state === "concluded" || room.state === "closed") return;
    const all = this.voters(room);
    const snap = pr.snapshot ? all.filter((p) => pr.snapshot!.includes(p.id)) : all;
    const active = snap.length ? snap : all;
    if (active.length === 0) return;
    if (room.expectedParticipants && this.voters(room).length < room.expectedParticipants) return;
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
    // late joiners are not waited on, but a disagree from anyone active still counts
    if (accepted && room.quorum === "unanimous" && all.some((p) => pr.votes[p.id]?.vote === "disagree")) {
      accepted = false;
      rejected = true;
    }
    if (accepted && this.hold(room)) {
      if (!pr.nudged) this.post(room, "system", undefined, `${pr.id} has the votes but the room is on hold by ${this.hold(room)!.by}: ${this.hold(room)!.text.slice(0, 120)}. It passes when the hold is cleared.`);
      pr.nudged = true;
      return;
    }
    if (accepted && room.requireVerification && !this.verifiedBy(room, pr)) {
      if (!pr.nudged) {
        this.post(room, "system", undefined, `${pr.id} has the votes but no verification: someone other than ${this.shown(room, pr.by)} (on a different connection) must run the fix and write verify/<area> naming ${pr.id}, dated after the current text.`);
      }
      pr.nudged = true;
      return;
    }

    // Adversarial gate: unanimous agreement without a single challenge is suspicious.
    if (accepted && this.challengeRequired(room) && pr.challenges.length === 0) {
      if (!pr.nudged) {
        pr.nudged = true;
        this.post(
          room,
          "system",
          undefined,
          `Everyone agrees with ${pr.id} but nobody has tested it. Someone other than ${this.shown(room, pr.by)} should name its weakest claim (challenge) before it passes.`,
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
    for (const m of room.messages) if (m.quiet) this.surfaceThread(room, this.threadRoot(room, m).id, "room concluded");
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

  /** Close a room without a conclusion (stale, abandoned, or a human decided to stop it). */
  closeRoom(roomName: string, by: string, reason = ""): Room {
    const room = this.getRoom(roomName);
    if (room.state === "concluded") throw new HubError("Room already concluded.");
    if (room.state === "closed") return room;
    for (const pr of room.proposals.values()) if (pr.status === "open") pr.status = "superseded";
    for (const p of room.participants.values()) {
      if (p.active) {
        p.active = false;
        this.persist({ type: "leave", room: roomName, p });
      }
    }
    this.setState(room, "closed");
    if (room.nudgeTimer) clearTimeout(room.nudgeTimer);
    this.post(room, "system", undefined, `Room closed by ${by}${reason ? `: ${reason}` : ""}. No conclusion was recorded.`);
    return room;
  }

  // ---------- liveness ----------

  /** Mark participants inactive after `idleMs` without any activity in a room that has not concluded. */
  sweepIdle(idleMs: number): string[] {
    const swept: string[] = [];
    const cutoff = Date.now() - idleMs;
    for (const room of this.rooms.values()) {
      if (room.state === "concluded" || room.state === "closed") continue;
      for (const p of room.participants.values()) {
        if (p.active && p.agent !== "human" && Date.parse(p.lastActiveAt) < cutoff) {
          p.active = false;
          this.persist({ type: "leave", room: room.name, p });
          this.post(room, "system", undefined, `${this.shown(room, p)} went quiet for ${Math.round(idleMs / 60000)} min and was marked as left.`);
          for (const pr of room.proposals.values()) if (pr.status === "open") this.evaluate(room, pr);
          swept.push(p.name);
        }
      }
    }
    return swept;
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
        let ev: Event;
        try {
          ev = JSON.parse(line) as Event;
        } catch {
          console.error(`[hub] skipping unreadable line in ${file} (truncated write?)`);
          continue;
        }
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
              requireVerification: legacy.requireVerification ?? false,
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
            const legacyPr = ev.proposal as Partial<Proposal> & Omit<Proposal, "challenges" | "version">;
            room?.proposals.set(ev.proposal.id, { ...legacyPr, challenges: legacyPr.challenges ?? [], version: legacyPr.version ?? 1 });
            break;
          }
          case "vote": {
            const pr = this.rooms.get(ev.room)?.proposals.get(ev.proposalId);
            if (pr) pr.votes[ev.pid] = ev.entry;
            break;
          }
          case "challenge": {
            const pr = this.rooms.get(ev.room)?.proposals.get(ev.proposalId);
            if (pr) {
              pr.challenges.push(ev.challenge);
              if (ev.votes) pr.votes = ev.votes;
            }
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
          case "board": {
            const room = this.rooms.get(ev.room);
            if (!room) break;
            if (ev.entry) room.board.set(ev.key, ev.entry);
            else room.board.delete(ev.key);
            break;
          }
          case "amend": {
            const pr = this.rooms.get(ev.room)?.proposals.get(ev.proposalId);
            if (pr) {
              pr.text = ev.text;
              pr.version = ev.version;
              pr.votes = ev.votes;
              if (ev.challenges) pr.challenges = ev.challenges;
            }
            break;
          }
        }
      }
    }
  }
}
