/**
 * The Hub is the single shared state behind the MCP server: rooms, participants,
 * an append-only sequence-numbered message log per room, long-poll waiters,
 * and the proposal / challenge / vote primitives that let a room reach a
 * conclusion that has actually been scrutinised.
 *
 * It is deliberately transport-agnostic so it can be driven by MCP tools,
 * by the plain HTTP endpoints (humans), or by tests.
 */
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type MessageKind = "chat" | "system" | "proposal" | "amend" | "challenge" | "vote" | "conclusion" | "board";
export type Vote = "agree" | "disagree" | "abstain";
export type Quorum = "unanimous" | "majority";
export type RoomMode = "free" | "round_robin";
export type RoomState = "open" | "concluded" | "stalled" | "closed";
/** Role is a display tag plus one quorum rule (chair is never waited on but may veto). It is never a persona. */
export type Role = "worker" | "chair" | "lead" | "verifier" | "recruit";
export const ROLES: Role[] = ["worker", "chair", "lead", "verifier", "recruit"];

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
  /** Sparse receipts for delivered quiet bodies, retained only until their thread is surfaced. */
  quietReceipts?: number[];
  /** explicit "nothing to add" turns */
  passes?: number;
  role?: Role;
  /** proposal id -> version of its text this participant was last sent (wait_for_messages ships text only when it changes) */
  seenProposal?: Record<string, number>;
  /** the conclusion text has been sent to this participant once */
  seenConclusion?: boolean;
  /** proposal id a blocking leave_room was already refused for (the second call proceeds) */
  leaveWarned?: string;
  /** id of the addressed message this participant was last shown by wait_for_messages (the next wait without an answer is refused once) */
  addressWarned?: string;
  /** id of the addressed message a wait_for_messages was already refused for (the call after that proceeds) */
  addressRefused?: string;
  /** mentions at or below this seq are answered (a pass covers everything before it) */
  answeredSeq?: number;
  /** Last ask actually delivered; bare pass declines only this id. */
  focusedAsk?: string;
  declinedAsks?: string[];
  declinedAt?: Record<string, number>;
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

export interface CodeState {
  head: string;
  dirty: boolean;
  at: string;
}

export interface BoardEntry {
  text: string;
  by: string;
  updatedAt: string;
  /** verify/* entries: the tree the verification ran against */
  codeState?: CodeState;
  /** set on inbox/* entries posted with ack_required */
  ackRequired?: boolean;
  /** inbox/*.ack entries cover only the note text hashed when acknowledged. */
  acknowledgedTextHash?: string;
}

export interface Challenge {
  id?: string;
  by: { id: string; name: string };
  objection: string;
  ts: string;
  /** proposal version the objection was written against */
  version?: number;
  /** open: unanswered. answered: the cited text was amended away. conceded: the challenger re-voted agree. overruled: the room concluded over it. */
  status?: "open" | "answered" | "conceded" | "overruled";
  /** the span of the proposal the objection quotes, if it quotes one (used to decide when an amend answers it) */
  cites?: string;
  /** false: recorded dissent that does not hold the proposal or satisfy the challenge gate */
  blocking?: boolean;
}

export interface Proposal {
  id: string;
  room: string;
  by: { id: string; name: string };
  text: string;
  createdAt: string;
  votes: Record<string, { vote: Vote; reason?: string; quote?: string; confidence?: number; name: string; ts: string; version?: number }>;
  challenges: Challenge[];
  status: "open" | "accepted" | "rejected" | "superseded";
  /** bumped by every amend; the text in `text` is always the current version */
  version: number;
  /** when the current text was written; absent means legacy freshness is unknown */
  updatedAt?: string;
  /** voters present when the proposal was made; unanimity is taken over these (late joiners are not waited on) */
  snapshot?: string[];
  /** set once the "needs a challenge" nudge has been posted */
  nudged?: boolean;
  /** version for which the "did not pass, amend it" notice was posted */
  notPassedVersion?: number;
  /** last "stuck because" notice, so it is posted once per state change */
  stuckNotice?: string;
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
  /** Name of the participant honoured as chair (exempt from quorum, may veto). Set at creation, or by the first joiner to claim role=chair. */
  chair?: string;
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
  chair?: string;
  createdAt: string;
  state: RoomState;
  conclusion?: { text: string; proposalId: string; decidedAt: string; version?: number; tally?: { agree: number; disagree: number; abstain: number }; unresolved_objections?: { by: string; objection: string }[] };
  /** identical silence nudges are posted at most twice */
  lastNudge?: { text: string; count: number };
  /** Lifetime refusal counts keyed by tool and bounded reason class (no bodies, no ids). */
  refusals?: Record<string, number>;
  /** Only versioned rooms have a complete guarded-call observation epoch. */
  telemetryVersion?: 1;
  callOutcomes?: Record<string, CallOutcomes>;
  /** git HEAD and dirty state of the project when the room was created */
  codeState?: CodeState;
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
  /** absolute deadline for the opening reveal, armed at creation and re-armed by the first opening; not reset by chat */
  openingsTimer?: NodeJS.Timeout;
  openingsWarned?: boolean;
  /** shared blackboard: named entries agents update in place instead of re-posting */
  board: Map<string, BoardEntry>;
  /** human message ids the propose-gate has already warned about (once each) */
  humanWarned: Set<string>;
  /** who has been asked to answer each human message, so three agents do not all say hello */
  responders: Map<string, { pid: string; at: number }>;
}

type Opts = Required<Omit<RoomOptions, "chair">> & { chair?: string };

export type CallOutcome = "success" | "hub_refusal" | "error";
export type CallOutcomes = Record<CallOutcome, number>;

type Event =
  | { type: "room"; room: string; opts: Opts; createdAt: string; telemetryVersion?: 1 }
  | { type: "message"; msg: Message }
  | { type: "attention"; room: string; pid: string; lastSeenSeq: number; withheld: number[]; quietReceipts: number[]; focusedAsk?: string; declinedAsks: string[]; declinedAt?: Record<string, number> }
  | { type: "join" | "leave"; room: string; p: Participant }
  | { type: "proposal"; proposal: Proposal }
  | { type: "vote"; room: string; proposalId: string; pid: string; entry: Proposal["votes"][string] }
  | { type: "challenge"; room: string; proposalId: string; challenge: Challenge; votes?: Proposal["votes"] }
  | { type: "state"; room: string; state: RoomState; conclusion?: Room["conclusion"] }
  | { type: "opening"; room: string; pid: string; content: string }
  | { type: "openings_revealed"; room: string }
  | { type: "board"; room: string; key: string; entry: BoardEntry | null }
  | { type: "amend"; room: string; proposalId: string; text: string; version: number; updatedAt?: string; votes: Proposal["votes"]; challenges?: Challenge[] }
  | { type: "refusal"; room: string; tool: string; reason: string; ts?: string; participant?: string | null }
  | { type: "call_completion"; room: string; tool: string; outcome: CallOutcome; ts: string; participant: string | null };

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
  /** project directory whose git state is stamped on rooms and verify entries */
  private readonly cwd?: string;

  constructor(opts: { dataDir?: string; cwd?: string } = {}) {
    this.dataDir = opts.dataDir;
    this.cwd = opts.cwd;
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
  /** silence before the hub nudges a room (and reveals stale openings); CHATROOM_NUDGE_AFTER_MS lets tests shorten it */
  static DEFAULT_NUDGE_MS = Number(process.env.CHATROOM_NUDGE_AFTER_MS ?? 180_000);
  static readonly ROOM_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

  /** git HEAD and whether the working tree is dirty, so a citation or a verification names the tree it was read against. */
  static codeState(cwd?: string): CodeState | undefined {
    if (!cwd) return undefined;
    const head = spawnSync("git", ["-C", cwd, "rev-parse", "--short", "HEAD"], { encoding: "utf8" });
    if (head.status !== 0) return undefined;
    const st = spawnSync("git", ["-C", cwd, "status", "--porcelain"], { encoding: "utf8" });
    return { head: head.stdout.trim(), dirty: st.stdout.trim().length > 0, at: now() };
  }
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
      nudgeAfterMs: opts.nudgeAfterMs ?? Hub.DEFAULT_NUDGE_MS,
      requireVerification: opts.requireVerification ?? false,
      ...(opts.chair ? { chair: opts.chair } : {}),
    };
    // Per-run room cap: rooms sharing a swarm prefix (swarm-<id>-*) are counted together.
    const prefix = Hub.runPrefix(name);
    if (prefix && [...this.rooms.keys()].filter((r) => Hub.runPrefix(r) === prefix && this.rooms.get(r)!.state === "open").length >= Hub.MAX_ROOMS_PER_RUN) {
      throw new HubError(`Room limit for this run (${Hub.MAX_ROOMS_PER_RUN} open rooms with prefix ${prefix}) reached. Close or conclude a room first.`);
    }
    // a threshold above the live cap can never be met (a 14-agent flat run deadlocked on it): clamp and say so
    const requested = full.expectedParticipants;
    if (requested > Hub.MAX_LIVE_PER_ROOM) full.expectedParticipants = Hub.MAX_LIVE_PER_ROOM;
    const room = this.materialiseRoom(name, full, now());
    room.codeState = Hub.codeState(this.cwd);
    room.telemetryVersion = 1;
    this.persist({ type: "room", room: name, opts: full, createdAt: room.createdAt, telemetryVersion: 1 });
    if (requested > Hub.MAX_LIVE_PER_ROOM) this.post(room, "system", undefined, `expected_participants ${requested} exceeds this hub's cap of ${Hub.MAX_LIVE_PER_ROOM} live agents per room; clamped to ${Hub.MAX_LIVE_PER_ROOM} so the room can still conclude.`);
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
    this.armOpeningsDeadline(room, room.nudgeAfterMs * 2); // the zero-openings case; the first opening tightens it to one period
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
      opening_max_chars: Math.min(room.maxMessageChars, 400),
      max_live_agents: Hub.MAX_LIVE_PER_ROOM,
      code_state: room.codeState ?? null,
      hold: this.hold(room) ? { by: this.hold(room)!.by, reason: this.hold(room)!.text } : null,
      state: room.state,
      created_at: room.createdAt,
      openings: room.openingsRevealed
        ? "revealed"
        : `${room.openings.size} submitted, waiting for ${this.openingsWaitingOn(room, reveal).join(", ") || "nobody"}`,
      round: room.round,
      current_turn: room.mode === "round_robin" && speaker ? nm(speaker) : null,
      chair: room.chair ? (reveal || !room.anonymous ? room.chair : this.shown(room, room.participants.get([...room.participants.values()].find((p) => p.name === room.chair)?.id ?? "") ?? { id: "", name: room.chair })) : null,
      participants: [...room.participants.values()].map((p) => ({
        name: nm(p),
        ...(reveal && room.anonymous ? { label: p.label } : {}),
        agent: reveal || !room.anonymous ? p.agent : "hidden",
        role: p.role ?? "worker",
        active: p.active,
        messages: p.messageCount,
        last_active_at: p.lastActiveAt,
      })),
      active_count: active.length,
      message_count: room.messages.length,
      latest_seq: room.messages.at(-1)?.seq ?? 0,
      proposals: [...room.proposals.values()].map((pr) => this.proposalView(room, pr, reveal, pr.status === "open" || pr.status === "accepted")),
      // agents get a manifest (board_get <key> fetches text); the human dashboard (reveal) gets the text
      board: Object.fromEntries([...room.board].map(([k, e]) => [k, { ...(reveal ? { text: e.text } : {}), by: e.by, chars: e.text.length, updated_at: e.updatedAt }])),
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
    const callOutcomes = room.callOutcomes ?? {};
    const tools = new Set([...Object.keys(callOutcomes), ...Object.keys(room.refusals ?? {}).map((key) => key.split(": ")[0])]);
    const refusalRates = Object.fromEntries([...tools].map((tool) => {
      const counts = callOutcomes[tool];
      const total = counts ? counts.success + counts.hub_refusal + counts.error : 0;
      return [tool, room.telemetryVersion === 1 && total > 0 ? counts.hub_refusal / total : "unknown"];
    }));
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
      refusals: room.refusals ?? {},
      call_outcomes: callOutcomes,
      refusal_rates: refusalRates,
      refusal_rate_coverage: room.telemetryVersion === 1 ? "complete" : "unknown",
      near_simultaneous_replies: bursts,
      unanswered_human_messages: room.messages.filter((m) => m.kind === "chat" && m.from.agent === "human" && !this.isAnswered(room, m)).length,
    };
  }

  // ---------- participants ----------

  join(roomName: string, name: string, agent: string, opts: RoomOptions = {}, reclaimId?: string, session?: string, role?: Role): { room: Room; participant: Participant } {
    const room = this.createRoom(roomName, opts);
    if (role && !ROLES.includes(role)) throw new HubError(`role must be one of ${ROLES.join(", ")}.`);
    if (role === "chair") {
      // the chair is bound to a name: the room option (set at creation) or, failing that, the first claimant
      if (room.chair && room.chair !== name) throw new HubError(`This room's chair is ${room.chair}. Join without role=chair.`);
      room.chair = name;
    }
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
        ...(role && role !== "worker" ? { role } : {}),
      };
      room.participants.set(participant.id, participant);
      this.persist({ type: "join", room: roomName, p: participant });
      this.post(room, "system", undefined, `${this.shown(room, participant)}${room.anonymous ? "" : ` (${agent})`}${this.roleTag(participant)} joined the room.`);
    } else if (!participant.active) {
      participant.active = true;
      participant.lastActiveAt = now();
      if (session) participant.session = session;
      if (role && role !== "worker") participant.role = role;
      this.persist({ type: "join", room: roomName, p: participant });
      this.post(room, "system", undefined, `${this.shown(room, participant)} rejoined the room.`);
    }
    for (const pr of room.proposals.values()) if (pr.status === "open") this.evaluate(room, pr);
    return { room, participant };
  }

  /** Why this participant's departure would leave the open proposal unpassable, if it would. */
  leavingWouldBlock(room: Room, p: Participant): { proposal: Proposal; reason: string } | undefined {
    if (p.agent === "human" || p.role === "chair") return undefined;
    const open = [...room.proposals.values()].find((pr) => pr.status === "open");
    if (!open) return undefined;
    const others = this.voters(room).filter((x) => x.id !== p.id);
    if (room.expectedParticipants !== 1 && Hub.sessionsOf(others) < 2) {
      return { proposal: open, reason: `the room would be left with ${others.length} voter(s), and a room of one cannot conclude, so ${open.id} could never pass` };
    }
    return undefined;
  }

  leave(roomName: string, pid: string): void {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    const block = this.leavingWouldBlock(room, p);
    if (block && p.leaveWarned !== block.proposal.id) {
      p.leaveWarned = block.proposal.id;
      const mine = block.proposal.votes[p.id]?.vote;
      throw new HubError(
        `Leaving now would block ${block.proposal.id}: ${block.reason}. ${mine ? `You voted ${mine}.` : "You have not voted: vote or pass first."} ` +
          "Call leave_room again to leave anyway.",
      );
    }
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
    return this.activeParticipants(room).filter((p) => p.agent !== "human" && p.role !== "chair");
  }

  /** Voters who have ever joined, active or not. */
  everJoinedVoters(room: Room): Participant[] {
    return [...room.participants.values()].filter((p) => p.agent !== "human" && p.role !== "chair");
  }

  /**
   * Expected participants who never joined. The floor counts arrivals, not attendance: whoever joined
   * and left already had their turn, and waiting on them is what deadlocked a room with a dropout.
   */
  unarrived(room: Room): number {
    return Math.max(0, room.expectedParticipants - this.everJoinedVoters(room).length);
  }

  /** "[chair]" etc. after a name; nothing for workers. */
  roleTag(p: { role?: Role }): string {
    return p.role && p.role !== "worker" ? ` [${p.role}]` : "";
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
    const focus = this.attentionFocus(room, p);
    if (focus) return [focus];
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

  /** Make a quiet thread public: re-park only unseen bodies outside the audience and consume their receipts. */
  surfaceThread(room: Room, rootId: string, reason: string): number {
    const root = room.messages.find((x) => x.id === rootId);
    if (!root || !root.quiet) return 0;
    const chain = room.messages.filter((m) => m.quiet && this.threadRoot(room, m).id === root.id);
    const audience = new Set(root.audience ?? []);
    for (const m of chain) m.quiet = false;
    const surfacedSeqs = new Set(chain.map((m) => m.seq));
    for (const p of room.participants.values()) {
      const receipts = new Set(p.quietReceipts ?? []);
      if (p.active && !audience.has(p.id)) {
        const held = new Set(p.withheld ?? []);
        for (const m of chain) if (m.seq <= p.lastSeenSeq && !receipts.has(m.seq)) held.add(m.seq);
        p.withheld = [...held];
      }
      // Inactive participants and audience members also no longer need these receipts.
      const remaining = [...receipts].filter((seq) => !surfacedSeqs.has(seq));
      if (remaining.length) p.quietReceipts = remaining;
      else delete p.quietReceipts;
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
  settleRead(room: Room, p: Participant, since: number, delivered: Message[], upTo?: number) {
    since = Math.min(since, p.lastSeenSeq);
    const ceiling = upTo ?? room.messages.at(-1)?.seq ?? since;
    const deliveredSeqs = new Set(delivered.map((m) => m.seq));
    const receipts = new Set(p.quietReceipts ?? []);
    for (const m of delivered) if (m.quiet) receipts.add(m.seq);
    if (receipts.size) p.quietReceipts = [...receipts];
    const still = new Set((p.withheld ?? []).filter((seq) => !deliveredSeqs.has(seq)));
    // Keep every skipped push body, including noise before the focused ask. Quiet
    // bystander bodies are not push debt; explicit read still exposes them.
    for (const m of room.messages) {
      if (m.seq <= since || m.seq > ceiling || m.from.id === p.id || deliveredSeqs.has(m.seq)) continue;
      if (this.pushableTo(room, m, p.id) || !this.visibleTo(room, m, p.id)) still.add(m.seq);
    }
    p.withheld = [...still];
    const focus = this.attentionFocus(room, p);
    if (focus && deliveredSeqs.has(focus.seq)) p.focusedAsk = focus.id;
    this.markRead(room, p, ceiling);
    this.persistAttention(room, p);
  }

  private persistAttention(room: Room, p: Participant) {
    this.persist({ type: "attention", room: room.name, pid: p.id, lastSeenSeq: p.lastSeenSeq,
      withheld: p.withheld ?? [], quietReceipts: p.quietReceipts ?? [],
      focusedAsk: p.focusedAsk, declinedAsks: p.declinedAsks ?? [], declinedAt: p.declinedAt ?? {} });
  }

  /** Explicit reads retain quiet-log access, but outstanding asks still take focus. */
  readAs(room: Room, p: Participant, sinceSeq: number | undefined, limit: number): Message[] {
    const since = sinceSeq ?? p.lastSeenSeq;
    const focus = this.attentionFocus(room, p);
    const held = new Set(p.withheld ?? []);
    const msgs = focus ? [focus] : room.messages.filter((m) =>
      (m.seq > since || held.has(m.seq)) && this.visibleTo(room, m, p.id)).slice(0, limit);
    if (msgs.length) this.settleRead(room, p, Math.min(since, p.lastSeenSeq), msgs,
      focus ? undefined : Math.max(p.lastSeenSeq, msgs.at(-1)!.seq));
    return msgs;
  }

  send(roomName: string, pid: string, content: string, replyTo?: string, force = false, quiet = false, surface = false): Message {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    if (quiet && p.agent === "human") throw new HubError("Humans speak to the room; quiet is for agent working exchanges.");
    // reply_to takes the id (m_...) or the seq as printed ("#12" or "12"), since delivered lines show the seq
    if (replyTo && /^#?\d+$/.test(replyTo)) replyTo = room.messages.find((m) => m.seq === Number(replyTo!.replace("#", "")))?.id ?? replyTo;
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
    } else if (!force && p.agent !== "human" && !this.resolvesAddress(room, p, content, replyTo)) {
      // Stale-send guard: never talk past messages you have not read.
      const unread = this.unread(room, p);
      if (unread.length) {
        // the refusal IS the delivery: settle the cursor so the same batch is not shipped again by the next wait
        this.settleRead(room, p, p.lastSeenSeq, unread);
        throw new HubError(
          `${unread.length} message(s) arrived while you were composing. Read them (below); then retry send_message with force=true if your point is still new, or call wait_for_messages.`,
          { hint: this.attentionHint(room, p), unread: unread.map((m) => this.fmt(room, m)), next_seq: room.messages.at(-1)!.seq },
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
    if (this.attentionFocus(room, p) || p.withheld?.length) this.settleRead(room, p, p.lastSeenSeq, []);
    const msg = this.post(room, "chat", p, content, { replyTo, ...(quiet ? { quiet: true, audience } : {}) });
    p.messageCount += 1;
    p.lastSeenSeq = Math.max(p.lastSeenSeq, msg.seq);
    this.persistAttention(room, p);
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
    const who = m.from.id === "system" ? "system" : this.shown(room, m.from) + this.roleTag(room.participants.get(m.from.id) ?? {});
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

  /** Internal actor ids are authenticated by the MCP connection; never included in public stats. */
  recordRefusal(roomName: string | undefined, tool: string, _message: string, participant: string | null = null) {
    const room = roomName ? this.rooms.get(roomName) : undefined;
    if (!room) return;
    // Error messages can interpolate submitted text/secrets. Never persist a raw prefix.
    const reason = "hub_guard";
    const key = `${tool}: ${reason}`;
    room.refusals = room.refusals ?? {};
    room.refusals[key] = (room.refusals[key] ?? 0) + 1;
    this.persist({ type: "refusal", room: room.name, tool, reason, ts: now(), participant });
  }

  /** Completed MCP guard invocations for existing rooms only; no arguments or error text.
   * Pending calls, schema rejections outside guard, roomless calls and failed room creation
   * are excluded. The rate uses this event's matched numerator, never lifetime refusals.
   */
  recordCallCompletion(roomName: string | undefined, tool: string, outcome: CallOutcome, participant: string | null) {
    const room = roomName ? this.rooms.get(roomName) : undefined;
    if (!room) return;
    this.applyCallCompletion(room, tool, outcome);
    this.persist({ type: "call_completion", room: room.name, tool, outcome, ts: now(), participant });
  }

  private applyCallCompletion(room: Room, tool: string, outcome: CallOutcome) {
    room.callOutcomes ??= {};
    const counts = room.callOutcomes[tool] ??= { success: 0, hub_refusal: 0, error: 0 };
    counts[outcome]++;
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
      let text: string;
      if (open) {
        const blockers = this.blockedBy(room, open);
        text = `${mins} min of silence. Proposal ${open.id} v${open.version} is open; blocked by: ${blockers.join("; ") || "nothing (re-evaluating)"}.`;
      } else if (!room.openingsRevealed && room.expectedParticipants) {
        // the reveal itself runs on the openings deadline (not reset by chat); this is only the reminder
        text = `${mins} min of silence. Still waiting for openings from ${this.openingsWaitingOn(room).join(", ")}. Chat is open meanwhile; the openings are revealed on their deadline regardless.`;
      } else {
        const talkers = [...room.participants.values()].filter((p) => p.active && p.agent !== "human").sort((a, b) => b.messageCount - a.messageCount);
        text = `${mins} min of silence. If the discussion has converged, ${talkers[0] ? this.shown(room, talkers[0]) : "someone"} should propose a conclusion.`;
      }
      // the same nudge is posted at most twice; a third identical one adds nothing
      if (room.lastNudge?.text === text && room.lastNudge.count >= 2) return;
      room.lastNudge = room.lastNudge?.text === text ? { text, count: room.lastNudge.count + 1 } : { text, count: 1 };
      this.post(room, "system", undefined, text);
    }, room.nudgeAfterMs);
    room.nudgeTimer.unref();
  }

  // ---------- blind openings ----------

  openingsWaitingOn(room: Room, reveal = false): string[] {
    const active = this.voters(room);
    const missing = active.filter((p) => !room.openings.has(p.id)).map((p) => (reveal ? p.name : this.shown(room, p)));
    const shortfall = this.unarrived(room);
    return shortfall > 0 ? [...missing, `${shortfall} more participant(s) to join`] : missing;
  }

  submitOpening(roomName: string, pid: string, content: string): { revealed: boolean; waiting_on: string[] } {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    if (room.openingsRevealed) throw new HubError("Openings have already been revealed in this room; use send_message.");
    if (!content.trim()) throw new HubError("Opening statement is empty.");
    const cap = Math.min(room.maxMessageChars, 400);
    if (content.length > cap) throw new HubError(`Opening is ${content.length} chars; openings are capped at ${cap}. One or two sentences: your answer and the main reason. Detail goes in the discussion or on the board.`);
    const first = room.openings.size === 0;
    room.openings.set(p.id, content);
    this.persist({ type: "opening", room: roomName, pid: p.id, content });
    if (first) this.armOpeningsDeadline(room, room.nudgeAfterMs); // the clock starts with the first opening, and chat does not reset it
    const waiting = this.openingsWaitingOn(room);
    if (waiting.length === 0) this.revealOpenings(room);
    return { revealed: room.openingsRevealed, waiting_on: waiting };
  }

  /**
   * An opening that has not arrived by the deadline is not coming: reveal what there is rather than hold
   * twelve agents for one. Everyone expected has joined -> reveal; someone never joined -> one warning,
   * then reveal one period later. Armed at creation (two periods, the zero-openings case) and re-armed
   * by the first opening (one period). Unlike the silence nudge, a talking room does not push it back.
   */
  private armOpeningsDeadline(room: Room, ms: number) {
    if (room.openingsTimer) clearTimeout(room.openingsTimer);
    if (!room.expectedParticipants || room.openingsRevealed || !ms) return;
    room.openingsTimer = setTimeout(() => {
      room.openingsTimer = undefined;
      if (room.openingsRevealed || room.state === "concluded" || room.state === "closed") return;
      const mins = Math.round(room.nudgeAfterMs / 60000);
      const waiting = this.openingsWaitingOn(room).join(", ");
      if (this.unarrived(room) > 0 && !room.openingsWarned) {
        room.openingsWarned = true;
        this.post(room, "system", undefined, `Openings deadline: still waiting for ${waiting}. Chat is open meanwhile; whatever has arrived is revealed in ${mins} min.`);
        this.armOpeningsDeadline(room, room.nudgeAfterMs);
        return;
      }
      this.revealOpenings(room, room.openings.size ? `revealed on the ${mins} min deadline without one from ${waiting}, who can still speak in chat` : `nobody submitted one; ${waiting} can still speak in chat`);
    }, ms);
    room.openingsTimer.unref();
  }

  private revealOpenings(room: Room, note?: string) {
    if (room.openingsTimer) clearTimeout(room.openingsTimer);
    room.openingsTimer = undefined;
    room.openingsRevealed = true;
    this.persist({ type: "openings_revealed", room: room.name });
    this.post(room, "system", undefined, `Opening answers (${room.openings.size}${note ? ` of ${room.expectedParticipants}` : ""}, written independently${note ? `; ${note}` : ""}):`);
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
    // No delivered focus means no decline. Never acknowledge unseen asks.
    if (p.focusedAsk && (this.addressedBy(room, p).some((m) => m.id === p.focusedAsk) || room.messages.some((m) => m.id === p.focusedAsk && m.from.agent === "human" && !this.isAnswered(room, m)))) {
      p.declinedAsks = [...new Set([...(p.declinedAsks ?? []), p.focusedAsk])];
      p.declinedAt = { ...(p.declinedAt ?? {}), [p.focusedAsk]: room.messages.at(-1)?.seq ?? 0 };
      p.focusedAsk = undefined;
      this.persistAttention(room, p);
    }
    let yielded = false;
    if (room.mode === "round_robin" && this.currentSpeaker(room)?.id === p.id) {
      this.advanceTurn(room);
      yielded = true;
      this.post(room, "system", undefined, `${this.shown(room, p)} passes.`);
    }
    return { yielded_turn: yielded, next_seq: room.messages.at(-1)?.seq ?? 0 };
  }

  // ---------- humans in the loop ----------

  /** Match human names literally and case-insensitively, never inside a larger word. */
  private namesHuman(room: Room, human: Message, content: string): boolean {
    const p = room.participants.get(human.from.id);
    return [human.from.name, p?.label].some((name) => {
      if (!name) return false;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?<!\\w)${escaped}(?!\\w)`, "i").test(content);
    });
  }

  /** A human chat message counts as answered once a non-human replies to it (reply_to) or names them afterwards. */
  isAnswered(room: Room, human: Message): boolean {
    // a later human message means an un-addressed "hi benji" reply belongs to that one, not this one
    const nextHumanSeq = room.messages.find((m) => m.seq > human.seq && m.kind === "chat" && m.from.agent === "human")?.seq ?? Infinity;
    return room.messages.some(
      (m) =>
        m.seq > human.seq &&
        m.kind === "chat" &&
        m.from.agent !== "human" &&
        (m.replyTo === human.id || (m.seq < nextHumanSeq && this.namesHuman(room, human, m.content))),
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
    const m = /^@((?:[Pp]articipant [A-Za-z](?![\w-]))|[\w-]+)/.exec(human.content.trim());
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
    for (const m of content.matchAll(/@((?:participant [A-Za-z](?![\w-]))|[\w-]+)/gi)) {
      const key = m[1].toLowerCase();
      for (const p of room.participants.values()) {
        const label = p.label.toLowerCase();
        if (
          p.name.toLowerCase() === key ||
          label === key ||
          label === `participant ${key}` ||
          (key.length === 1 && label.endsWith(` ${key}`))
        )
          ids.add(p.id);
      }
    }
    return [...ids];
  }

  /** Compatibility hook: repeated waits now deliver focus instead of throwing. */
  answerBeforeWaiting(_room: Room, _p: Participant, _since: number): void {}

  /** RE-TARGET hub-carries-what-it-knows: only linked chat resolves agent debt.
   * reply_to resolves exactly its target. Without reply_to, @-back resolves the
   * oldest outstanding ask from EACH named sender. Other post kinds never do.
   */
  addressedBy(room: Room, p: Participant): Message[] {
    const declined = new Set(p.declinedAsks ?? []);
    const pending: Message[] = [];
    for (const m of room.messages) {
      for (let i = pending.length - 1; i >= 0; i--) if ((p.declinedAt?.[pending[i].id] ?? Infinity) < m.seq) pending.splice(i, 1);
      if (m.kind !== "chat" || m.tag === "opening") continue;
      if (m.from.id === p.id) {
        if (m.replyTo) {
          const i = pending.findIndex((ask) => ask.id === m.replyTo);
          if (i >= 0) pending.splice(i, 1);
        } else {
          for (const sender of m.mentions ?? []) {
            const i = pending.findIndex((ask) => ask.from.id === sender);
            if (i >= 0) pending.splice(i, 1);
          }
        }
      } else if (m.from.agent !== "human" && m.mentions?.includes(p.id) && this.pushableTo(room, m, p.id)) pending.push(m);
    }
    return pending.filter((m) => !declined.has(m.id));
  }

  attentionFocus(room: Room, p: Participant): Message | undefined {
    if (p.agent === "human" || p.role === "chair" || room.state === "closed" || room.state === "concluded") return;
    const human = [...room.messages].reverse().find((m) => m.kind === "chat" && m.tag !== "opening" &&
      m.from.agent === "human" && !this.isAnswered(room, m) && !p.declinedAsks?.includes(m.id) && this.responderFor(room, m, p.id).mine);
    return human ?? this.addressedBy(room, p)[0];
  }

  attentionHint(room: Room, p: Participant): string | undefined {
    const ask = this.attentionFocus(room, p);
    if (!ask) return;
    return `${ask.from.agent === "human" ? "You are the one answering this human. " : ""}${this.shown(room, ask.from)} addressed you directly in #${ask.seq}. Reply with send_message reply_to="${ask.id}" or call pass to decline only this focused ask. Other messages remain queued.`;
  }

  private resolvesAddress(room: Room, p: Participant, content: string, replyTo?: string): boolean {
    const focus = this.attentionFocus(room, p);
    if (replyTo && (focus?.id === replyTo || this.addressedBy(room, p).some((m) => m.id === replyTo))) return true;
    return !replyTo && this.addressedBy(room, p).some((m) => this.mentionsIn(room, content).includes(m.from.id));
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
    for (let i = room.messages.length - 1; i >= 0; i--) {
      const m = room.messages[i];
      if (m.kind !== "chat" || m.from.agent !== "human") continue;
      if (this.namesHuman(room, m, content)) return m;
      break; // only the most recent human message can be addressed by name
    }
    return undefined;
  }

  // ---------- shared board ----------

  static readonly BOARD_KEY = /^[\w .:/-]{1,80}$/;

  hold(room: Room): BoardEntry | undefined {
    return room.board.get(`hold/${room.name}`);
  }

  private static noteHash(text: string): string {
    return createHash("sha256").update(text).digest("hex");
  }

  /** Shared coverage check; legacy acks without coverage are conservative. */
  private inboxOpen(room: Room, key: string, entry: BoardEntry): boolean {
    return key.startsWith("inbox/") && !key.endsWith(".ack") &&
      room.board.get(`${key}.ack`)?.acknowledgedTextHash !== Hub.noteHash(entry.text);
  }

  /** inbox/* entries still requiring acknowledgement of their current text. */
  unacknowledged(room: Room): string[] {
    return [...room.board.entries()].filter(([k, e]) => e.ackRequired && this.inboxOpen(room, k, e)).map(([k]) => k);
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
    const note = key.startsWith("inbox/") && key.endsWith(".ack") ? room.board.get(key.slice(0, -4)) : undefined;
    const entry: BoardEntry = {
      text, by: p.name, updatedAt: now(),
      ...(key.startsWith("verify/") ? { codeState: Hub.codeState(this.cwd) } : {}),
      ...(note ? { acknowledgedTextHash: Hub.noteHash(note.text) } : {}),
    };
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
    const full = `inbox/${fromRoom}/${key}`;
    const entry: BoardEntry = { text, by: p.name, updatedAt: now(), ...(ackRequired ? { ackRequired: true } : {}) };
    // Replacing an open note consumes no extra slot. A changed text hash invalidates its old ack.
    const otherOpen = [...to.board.entries()].filter(([k, e]) => k !== full && this.inboxOpen(to, k, e)).length;
    if (this.inboxOpen(to, full, entry) && otherOpen >= 10) throw new HubError(`${toRoom} already has 10 inbox notes awaiting acknowledgement; wait for them to be acknowledged or cleared.`);
    to.board.set(full, entry);
    this.persist({ type: "board", room: toRoom, key: full, entry });
    this.post(to, "system", undefined, `Note from ${p.name} in ${fromRoom} on the board as "${full}"${ackRequired ? ` (acknowledge by writing "${full}.ack")` : ""}: ${text.slice(0, 160)}${text.length > 160 ? "…" : ""}`);
    return { key: full, entry };
  }

  // ---------- proposals as documents ----------

  /** ~200 chars of the proposal around the closest thing to `find`, for a bad-find refusal (never the whole document). */
  private closest(text: string, find: string): string {
    const probe = find.trim().slice(0, 24);
    let i = probe ? text.indexOf(probe) : -1;
    if (i < 0) {
      const word = find.trim().split(/\s+/).find((w) => w.length > 5);
      i = word ? text.indexOf(word) : -1;
    }
    const at = Math.max(0, i < 0 ? 0 : i - 40);
    return (at ? "…" : "") + text.slice(at, at + 200) + (at + 200 < text.length ? "…" : "");
  }

  /**
   * Edit the open proposal in place. Posts only the diff and bumps the version. An amend never creates or restores a vote:
   * an existing agree survives only while its quoted clause still appears verbatim in the new text (the amender's included).
   * A challenge is answered when the text it cites is gone, and reopens if a later amend brings that text back.
   */
  amend(roomName: string, pid: string, proposalId: string, find: string, replace: string, replaceAll = false): { proposal: Proposal; diff: string; answered: string[]; reopened: string[] } {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    const pr = room.proposals.get(proposalId);
    if (!pr) throw new HubError(`No proposal "${proposalId}" in "${roomName}".`);
    if (pr.status !== "open") throw new HubError(`Proposal ${proposalId} is ${pr.status}; only open proposals can be amended.`);
    let next: string;
    if (replaceAll) {
      if (!replace.trim()) throw new HubError("replace_all needs the full new text.");
      next = replace;
    } else if (!find) {
      if (!replace.trim()) throw new HubError("Nothing to append.");
      next = pr.text.trimEnd() + "\n" + replace;
    } else {
      const n = pr.text.split(find).length - 1;
      if (n === 0) {
        throw new HubError(
          `"${find.slice(0, 80)}" does not occur in ${proposalId} v${pr.version} (${pr.text.length} chars). Copy the exact text to replace; the closest passage is: "${this.closest(pr.text, find)}". For a whole rewrite use replace_all=true.`,
        );
      }
      if (n > 1) throw new HubError(`"${find.slice(0, 80)}" occurs ${n} times; include more context so it is unique.`);
      // a one-word find in a long document splices wherever that word happens to sit ("findings" for "find"); ask for a span
      if (find.trim().length < 16 && pr.text.length > 2000) throw new HubError(`"${find}" is too short a find for a ${pr.text.length}-char document; copy at least 16 characters of the passage so the replacement lands where you mean.`);
      next = pr.text.replace(find, replace);
    }
    if (next === pr.text) throw new HubError("That amendment changes nothing.");
    pr.text = next;
    pr.version += 1;
    pr.updatedAt = now();
    pr.notPassedVersion = undefined;
    pr.stuckNotice = undefined;
    const kept: Proposal["votes"] = {};
    for (const [id, v] of Object.entries(pr.votes)) if (v.vote === "agree" && v.quote && norm(next).includes(norm(v.quote))) kept[id] = v;
    pr.votes = kept;
    const answered: string[] = [];
    const reopened: string[] = [];
    for (const c of pr.challenges) {
      if (!c.cites) continue;
      const present = norm(next).includes(norm(c.cites));
      if ((c.status ?? "open") === "open" && c.blocking !== false && !present) {
        c.status = "answered";
        answered.push(this.shown(room, c.by));
      } else if (c.status === "answered" && present) {
        c.status = "open";
        reopened.push(this.shown(room, c.by));
      }
    }
    this.persist({ type: "amend", room: roomName, proposalId, text: pr.text, version: pr.version, updatedAt: pr.updatedAt, votes: pr.votes, challenges: pr.challenges });
    const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n) + "…" : t);
    const diff = replaceAll ? `replaced the whole text (${pr.text.length} chars)` : find ? `"${clip(find, 160)}" → "${clip(replace, 240)}"` : `appended "${clip(replace, 240)}"`;
    const survived = Object.values(kept).map((v) => this.shown(room, { id: "", name: v.name }));
    this.post(
      room,
      "amend",
      p,
      `AMENDED ${proposalId} to v${pr.version}: ${diff}\n(votes reset${survived.length ? ` except ${survived.join(", ")}, whose quoted clause survived` : ""}; the new text arrives with your next wait_for_messages` +
        (answered.length ? `; challenge by ${answered.join(", ")} answered: the cited text is gone` : "") +
        (reopened.length ? `; challenge by ${reopened.join(", ")} REOPENED: the cited text is back` : "") +
        ")",
      { proposalId },
    );
    this.evaluate(room, pr);
    return { proposal: pr, diff, answered, reopened };
  }

  // ---------- consensus ----------

  challengeRequired(room: Room): boolean {
    if (room.requireChallenge === "auto") return this.voters(room).length >= 2;
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
      votes: { [p.id]: { vote: "agree", name: p.name, ts: now(), reason: "proposer", version: 1 } },
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

  /** The span of the proposal an objection quotes (longest quoted run that occurs in the text), if any. */
  private citedSpan(text: string, objection: string): string | undefined {
    const spans = [...objection.matchAll(/["“]([^"”]{12,})["”]/g)].map((m) => m[1]).filter((q) => norm(text).includes(norm(q)));
    return spans.sort((a, b) => b.length - a.length)[0];
  }

  /** Blocking challenges that have not been answered or conceded. */
  openChallenges(pr: Proposal): Challenge[] {
    return pr.challenges.filter((c) => (c.status ?? "open") === "open" && c.blocking !== false);
  }

  /** Is this challenge independent scrutiny of a proposal by `proposerId`? True when it comes from a
   *  different participant on a different connection; a same-session alias counts as the proposer
   *  (identity-is-the-connection). Sessionless participants fall back to distinct-id, so legacy
   *  separate HTTP callers and tests keep working. */
  private independentChallenger(room: Room, c: Challenge, proposerId: string): boolean {
    if (c.by.id === proposerId) return false;
    const challenger = room.participants.get(c.by.id);
    const proposer = room.participants.get(proposerId);
    const cs = challenger?.session;
    const ps = proposer?.session;
    if (cs && ps) return cs !== ps; // both sessions known: the connection is the identity
    return true; // missing either side: fall back to distinct participant ids (already checked)
  }

  /** Open blocking challenges from a challenger independent of the proposer's connection: the only ones that count as live scrutiny. */
  private qualifyingChallenges(room: Room, pr: Proposal): Challenge[] {
    return this.openChallenges(pr).filter((c) => this.independentChallenger(room, c, pr.by.id));
  }

  /** Has this proposal received independent scrutiny at all? A challenge conceded or answered still proves
   * the proposal was tested from another connection; a same-session alias never does, in any status. */
  private hasQualifyingChallenge(room: Room, pr: Proposal): boolean {
    return pr.challenges.some((c) => c.blocking !== false && this.independentChallenger(room, c, pr.by.id));
  }

  challenge(roomName: string, pid: string, proposalId: string, objection: string, blocking = true): Proposal {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    const pr = room.proposals.get(proposalId);
    if (!pr) throw new HubError(`No proposal "${proposalId}" in "${roomName}".`);
    if (pr.status !== "open") throw new HubError(`Proposal ${proposalId} is already ${pr.status}.`);
    if (pr.by.id === p.id) throw new HubError("You cannot challenge your own proposal; someone else must.");
    if (blocking && !this.independentChallenger(room, { by: { id: p.id, name: p.name }, objection, ts: now(), version: pr.version }, pr.by.id)) {
      throw new HubError(
        `${this.shown(room, p)} shares a connection with the proposer ${this.shown(room, pr.by)}: a blocking challenge must come from a different session (identity-is-the-connection). ` +
        `A non-blocking objection is still allowed, and a different connection must challenge before this proposal can pass.`,
      );
    }
    if (objection.trim().length < 20) throw new HubError("A challenge must state a specific objection (at least 20 characters).");
    const cites = this.citedSpan(pr.text, objection);
    if (blocking && !cites) {
      throw new HubError(
        `A blocking challenge must quote a matching proposal span (12+ characters) in double quotes. ` +
          `Copy the text from ${proposalId} v${pr.version}; the closest passage is: "${this.closest(pr.text, objection)}". ` +
          `Use blocking=false to record uncited dissent without holding the proposal.`,
      );
    }
    this.surfaceCited(room, objection, "cited in a challenge");
    const challenge: Challenge = { id: shortId("ch"), by: { id: p.id, name: p.name }, objection, ts: now(), version: pr.version, status: "open", blocking, ...(cites ? { cites } : {}) };
    pr.challenges.push(challenge);
    // A blocking challenge must be answered: the challenger's own vote (if any) is reset and must be re-cast
    // after the room has responded, so the proposal cannot pass in the same breath.
    if (blocking) delete pr.votes[p.id];
    this.persist({ type: "challenge", room: roomName, proposalId, challenge, votes: pr.votes });
    this.post(
      room,
      "challenge",
      p,
      `${objection}\n(${blocking ? "challenge" : "non-blocking objection"} to ${proposalId} v${pr.version}${cites ? `, citing "${cites.slice(0, 80)}${cites.length > 80 ? "…" : ""}"` : ""}; ` +
        (blocking ? `${this.shown(room, p)} re-votes once it is answered` : "recorded, carried into the conclusion if still open") +
        ")",
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
    const prior = proposal.votes[p.id];
    if (p.agent === "human" && prior && prior.vote === vote && (prior.version ?? proposal.version) === proposal.version) return proposal; // repeat human votes are idempotent
    if (p.agent !== "human") {
      if (vote === "agree") {
        if (!quote || quote.trim().length < 15) {
          throw new HubError("An agree vote must include `quote`: a verbatim clause (15+ chars) from the proposal you are endorsing. Read it before you vote.");
        }
        if (!norm(proposal.text).includes(norm(quote))) {
          throw new HubError(`Your quote is not in ${proposalId} v${proposal.version} (${proposal.text.length} chars). Quote it verbatim; the closest passage is: "${this.closest(proposal.text, quote)}"`);
        }
        if (this.openChallenges(proposal).length && (!reason || reason.trim().length < 20)) {
          throw new HubError(`A challenge is open on ${proposalId}; an agree now needs \`reason\` (20+ chars) saying why the objection does not hold, not only a quote.`);
        }
      }
      if (vote === "disagree" && (!reason || reason.trim().length < 20)) {
        throw new HubError("A disagree vote must include `reason` stating the specific change that would make you agree (20+ chars).");
      }
    }
    const entry = { vote, reason, quote, confidence, name: p.name, ts: now(), version: proposal.version };
    this.applyVote(proposal, p.id, entry);
    this.persist({ type: "vote", room: roomName, proposalId, pid: p.id, entry });
    const conf = confidence !== undefined ? ` (confidence ${confidence})` : "";
    this.post(room, "vote", p, `${this.shown(room, p)} votes ${vote.toUpperCase()} on ${proposalId}${conf}${reason ? `: ${reason}` : ""}`, { proposalId });
    this.evaluate(room, proposal);
    return proposal;
  }

  /** Apply the same concession transition live and on replay, including legacy vote events. */
  private applyVote(pr: Proposal, pid: string, entry: Proposal["votes"][string]) {
    pr.votes[pid] = entry;
    if (entry.vote !== "agree" || (entry.version ?? pr.version) !== pr.version) return;
    // An earlier-version challenge can remain open through amendments; a current agree concedes it too.
    for (const c of pr.challenges) if (c.by.id === pid && (c.status ?? "open") === "open") c.status = "conceded";
  }

  /** Disagree votes cast against the current text by anyone, present or departed: an objection outlives the agent who filed it. */
  standingDisagrees(pr: Proposal): { id: string; name: string }[] {
    return Object.entries(pr.votes)
      .filter(([, v]) => v.vote === "disagree" && (v.version ?? pr.version) === pr.version)
      .map(([id, v]) => ({ id, name: v.name }));
  }

  /** Legacy uncited blockers cannot be answered by amending an imaginary target. */
  private challengeAdvice(room: Room, challenges: Challenge[]): string {
    const anchored = challenges.filter((c) => c.cites);
    const legacy = challenges.filter((c) => !c.cites);
    const advice: string[] = [];
    if (anchored.length) advice.push(`open challenge(s) from ${anchored.map((c) => this.shown(room, c.by)).join(", ")}: amend the cited text or they re-vote`);
    for (const c of legacy) {
      const author = this.shown(room, c.by);
      const action = room.participants.get(c.by.id)?.active ? "re-vote agree" : "return/rejoin with their original identity and re-vote agree";
      advice.push(`legacy uncited challenge from ${author}: no cited amendment target; ${author} must ${action} with a reason to concede, or a human closes the room`);
    }
    return advice.join("; ");
  }

  /** Everything that stops an open proposal from passing right now, in words an agent can act on. */
  blockedBy(room: Room, pr: Proposal): string[] {
    if (pr.status !== "open") return [];
    const out: string[] = [];
    const active = this.voters(room);
    const unarrived = this.unarrived(room);
    if (unarrived > 0) out.push(`quorum floor: ${unarrived} of the ${room.expectedParticipants} expected participant(s) have never joined (request_agent, or a human closes the room)`);
    else if (room.expectedParticipants !== 1 && Hub.sessionsOf(active) < 2) out.push(`quorum floor: ${active.length} voter(s) left and a room of one cannot conclude (request_agent, or a human closes the room)`);
    const waiting = active.filter((p) => !pr.votes[p.id]).map((p) => this.shown(room, p));
    if (waiting.length) out.push(`votes from ${waiting.join(", ")}`);
    for (const d of this.standingDisagrees(pr)) out.push(`a standing disagree from ${this.shown(room, room.participants.get(d.id) ?? d)}${room.participants.get(d.id)?.active ? "" : " (who has left)"}: they re-vote, or the text they objected to is amended`);
    if (this.challengeRequired(room) && !this.hasQualifyingChallenge(room, pr)) {
      out.push(`a challenge from someone other than ${this.shown(room, pr.by)} (on a different connection)`);
      if (pr.challenges.length) out.push(`its only blocking challenge(s) share the proposer's connection and do not count as scrutiny: a different connection must challenge`);
    }
    const openCh = this.qualifyingChallenges(room, pr);
    if (openCh.length) out.push(this.challengeAdvice(room, openCh));
    if (room.requireVerification && !this.verifiedBy(room, pr)) out.push(`a verify/* board entry by someone other than ${this.shown(room, pr.by)} naming ${pr.id}`);
    if (this.hold(room)) out.push(`hold by ${this.hold(room)!.by}`);
    if (!Object.values(pr.votes).some((v) => (v.version ?? 1) === pr.version) && pr.version > 1) out.push(`no vote cast on v${pr.version} yet (carried-over agrees alone cannot pass a new version)`);
    return out;
  }

  proposalView(room: Room, pr: Proposal, reveal = false, withText = true) {
    const active = this.voters(room);
    const nm = (x: { id: string; name: string }) => (reveal ? x.name : this.shown(room, x));
    const tally = { agree: 0, disagree: 0, abstain: 0 };
    for (const p of active) {
      const v = pr.votes[p.id]?.vote;
      if (v) tally[v] += 1;
    }
    for (const d of this.standingDisagrees(pr)) if (!active.some((p) => p.id === d.id)) tally.disagree += 1;
    const needsChallenge = this.challengeRequired(room) && !this.hasQualifyingChallenge(room, pr) && pr.status === "open";
    return {
      id: pr.id,
      by: nm(pr.by),
      version: pr.version,
      ...(withText ? { text: pr.text } : { text_omitted: `unchanged since v${pr.version}; room_status carries the full text` }),
      chars: pr.text.length,
      status: pr.status,
      created_at: pr.createdAt,
      tally,
      waiting_on: active.filter((p) => !pr.votes[p.id]).map((p) => nm(p)),
      needs_challenge: needsChallenge,
      blocked_by: this.blockedBy(room, pr),
      challenges: pr.challenges.map((c) => ({ id: c.id, by: nm(c.by), objection: c.objection, status: c.status ?? "open", blocking: c.blocking !== false, version: c.version })),
      votes: Object.entries(pr.votes).map(([id, v]) => ({ name: nm({ id, name: v.name }), vote: v.vote, confidence: v.confidence, reason: v.reason, version: v.version, ...(v.version !== undefined && v.version !== pr.version ? { stale: `cast at v${v.version}` } : {}) })),
    };
  }

  /** Re-check whether a proposal has reached the room's quorum. */
  /** A verify/* entry by a different agent (different connection), newer than the proposal text, naming the proposal. */
  verifiedBy(room: Room, pr: Proposal): BoardEntry | undefined {
    if (!pr.updatedAt) return undefined; // Legacy text timestamps are unknown, not fresh.
    const proposer = room.participants.get(pr.by.id);
    for (const [k, e] of room.board) {
      if (!k.startsWith("verify/") || k.endsWith(".partial")) continue;
      if (e.by === pr.by.name) continue;
      const author = [...room.participants.values()].find((x) => x.name === e.by);
      if (author && proposer && author.session && author.session === proposer.session) continue; // same process, two names
      if (e.updatedAt < pr.updatedAt) continue;
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
    const stuck = (text: string) => {
      if (pr.stuckNotice === text) return;
      pr.stuckNotice = text;
      this.post(room, "system", undefined, text);
    };
    const votes = active.map((p) => pr.votes[p.id]?.vote);
    const agree = votes.filter((v) => v === "agree").length;
    const standing = this.standingDisagrees(pr);
    const disagree = new Set([...active.filter((p) => pr.votes[p.id]?.vote === "disagree").map((p) => p.id), ...standing.map((d) => d.id)]).size;
    const everyoneVoted = votes.every(Boolean);
    const unarrived = this.unarrived(room);
    if (unarrived > 0) {
      if (everyoneVoted && agree === active.length) {
        stuck(`${pr.id} v${pr.version} has the agreement of everyone present (${agree}) but ${unarrived} of the ${room.expectedParticipants} expected participant(s) have never joined: nobody here can conclude it. Recruit (request_agent), wait for the missing joiners, or a human closes the room.`);
      }
      return;
    }
    if (room.expectedParticipants !== 1 && Hub.sessionsOf(this.voters(room)) < 2) {
      if (everyoneVoted && agree === active.length) {
        stuck(`${pr.id} v${pr.version} has the agreement of everyone still present (${agree}) but only ${this.voters(room).length} voter(s) remain and a room of one cannot conclude: nobody here can conclude it. Recruit (request_agent), or a human closes the room.`);
      }
      return;
    }
    const humanVeto = this.activeParticipants(room).some((p) => (p.agent === "human" || p.role === "chair") && pr.votes[p.id]?.vote === "disagree");

    let accepted = false;
    let notPassed = false;
    if (room.quorum === "unanimous") {
      if (disagree > 0) notPassed = true;
      else if (everyoneVoted && agree === active.length) accepted = true;
    } else {
      const needed = Math.floor(active.length / 2) + 1;
      if (agree >= needed) accepted = true;
      else if (disagree >= needed) notPassed = true;
      else if (everyoneVoted) notPassed = true;
    }
    if (!accepted && !notPassed && room.state === "stalled" && everyoneVoted && agree > disagree) accepted = true;
    if (humanVeto || (standing.length && room.quorum === "unanimous")) {
      accepted = false;
      notPassed = true;
    }
    // late joiners are not waited on, but a disagree from anyone active still counts
    if (accepted && room.quorum === "unanimous" && all.some((p) => pr.votes[p.id]?.vote === "disagree")) {
      accepted = false;
      notPassed = true;
    }
    if (accepted && pr.version > 1 && !Object.values(pr.votes).some((v) => (v.version ?? 1) === pr.version)) {
      stuck(`${pr.id} v${pr.version} carries only agrees cast on earlier versions; a version cannot pass until someone votes on its current text. Re-vote (quote a clause of v${pr.version}) to conclude.`);
      return;
    }
    if (accepted && this.hold(room)) {
      stuck(`${pr.id} has the votes but the room is on hold by ${this.hold(room)!.by}: ${this.hold(room)!.text.slice(0, 120)}. It passes when the hold is cleared.`);
      return;
    }
    if (accepted && room.requireVerification && !this.verifiedBy(room, pr)) {
      stuck(`${pr.id} has the votes but no verification: someone other than ${this.shown(room, pr.by)} (on a different connection) must run the fix and write verify/<area> naming ${pr.id}, dated after the current text.`);
      return;
    }

    // Adversarial gate: unanimous agreement without independent scrutiny is suspicious, even when a
    // stored (legacy or replayed) challenge from the proposer's own connection claims otherwise.
    if (accepted && this.challengeRequired(room) && !this.hasQualifyingChallenge(room, pr)) {
      stuck(pr.challenges.length
        ? `${pr.id} has no qualifying challenge: its only blocking challenge(s) share the proposer's connection, which does not count as scrutiny (identity-is-the-connection). Someone other than ${this.shown(room, pr.by)} on a different connection must challenge before it can pass.`
        : `Everyone agrees with ${pr.id} but nobody has tested it. Someone other than ${this.shown(room, pr.by)} (on a different connection) should name its weakest claim (challenge) before it passes.`);
      return;
    }
    const openCh = this.qualifyingChallenges(room, pr);
    if (accepted && openCh.length) {
      stuck(`${pr.id} has the votes but ${this.challengeAdvice(room, openCh)}.`);
      return;
    }

    if (accepted) this.conclude(room, pr);
    else if (notPassed && pr.notPassedVersion !== pr.version) {
      pr.notPassedVersion = pr.version;
      const who = standing.map((d) => this.shown(room, room.participants.get(d.id) ?? d));
      this.post(
        room,
        "system",
        undefined,
        `Proposal ${pr.id} v${pr.version} did not pass (${agree} agree / ${disagree} disagree${who.length ? `; standing objection from ${who.join(", ")}` : ""}). It stays open: amend it in place — amend proposal_id="${pr.id}" find="<exact text>" replace="<new text>" — or the objector re-votes. Do not propose a new document.`,
      );
    }
  }

  private conclude(room: Room, pr: Proposal) {
    for (const m of room.messages) if (m.quiet) this.surfaceThread(room, this.threadRoot(room, m).id, "room concluded");
    pr.status = "accepted";
    for (const other of room.proposals.values()) if (other.id !== pr.id && other.status === "open") other.status = "superseded";
    const unresolved = pr.challenges.filter((c) => (c.status ?? "open") === "open").map((c) => ({ by: this.shown(room, c.by), objection: c.objection }));
    for (const c of pr.challenges) if ((c.status ?? "open") === "open") c.status = "overruled";
    const view = this.proposalView(room, pr, false, false);
    room.conclusion = { text: pr.text, proposalId: pr.id, decidedAt: now(), version: pr.version, tally: view.tally, unresolved_objections: unresolved };
    this.persist({ type: "proposal", proposal: pr });
    this.setState(room, "concluded");
    if (room.nudgeTimer) clearTimeout(room.nudgeTimer);
    this.post(
      room,
      "conclusion",
      undefined,
      `CONSENSUS REACHED on ${pr.id} v${pr.version} (${view.tally.agree}/${this.voters(room).length} agree; ${pr.text.length} chars, text in room_status/conclusion)` +
        (unresolved.length ? `\nUnresolved objections, overruled: ${unresolved.map((u) => `${u.by}: "${u.objection.slice(0, 300)}${u.objection.length > 300 ? "…" : ""}"`).join(" | ")}` : ""),
      { proposalId: pr.id },
    );
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
  /** Mark silent participants as left, except those whose MCP session is in `connected`: a seat building in its worktree for 20 minutes is working, not gone. */
  sweepIdle(idleMs: number, connected?: Set<string>): string[] {
    const swept: string[] = [];
    const cutoff = Date.now() - idleMs;
    for (const room of this.rooms.values()) {
      if (room.state === "concluded" || room.state === "closed") continue;
      for (const p of room.participants.values()) {
        if (p.session && connected?.has(p.session)) continue;
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
          case "attention": {
            const p = this.rooms.get(ev.room)?.participants.get(ev.pid);
            if (p) Object.assign(p, { lastSeenSeq: ev.lastSeenSeq, withheld: ev.withheld,
              quietReceipts: ev.quietReceipts, focusedAsk: ev.focusedAsk, declinedAsks: ev.declinedAsks, declinedAt: ev.declinedAt });
            break;
          }
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
            const room = this.materialiseRoom(ev.room, opts, ev.createdAt);
            room.telemetryVersion = ev.telemetryVersion;
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
            if (pr) this.applyVote(pr, ev.pid, ev.entry);
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
          case "call_completion": {
            const room = this.rooms.get(ev.room);
            if (room) this.applyCallCompletion(room, ev.tool, ev.outcome);
            break;
          }
          case "refusal": {
            const room = this.rooms.get(ev.room);
            if (room) {
              const key = `${ev.tool}: ${ev.reason}`;
              room.refusals = room.refusals ?? {};
              room.refusals[key] = (room.refusals[key] ?? 0) + 1;
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
              // Missing legacy timestamps must clear the previous text's freshness.
              pr.updatedAt = ev.updatedAt;
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
