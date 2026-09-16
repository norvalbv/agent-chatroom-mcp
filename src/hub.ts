/**
 * The Hub is the single shared state behind the MCP server: rooms, participants,
 * an append-only sequence-numbered message log per room, long-poll waiters,
 * and the proposal / vote primitives that let a room reach a conclusion.
 *
 * It is deliberately transport-agnostic so it can be driven by MCP tools,
 * by the plain HTTP endpoints (for humans watching), or by tests.
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type MessageKind = "chat" | "system" | "proposal" | "vote" | "conclusion";
export type Vote = "agree" | "disagree" | "abstain";
export type Quorum = "unanimous" | "majority";
export type RoomMode = "free" | "round_robin";
export type RoomState = "open" | "concluded" | "stalled";

export interface Participant {
  id: string;
  name: string;
  agent: string; // e.g. "claude", "codex", "human"
  joinedAt: string;
  lastActiveAt: string;
  lastSeenSeq: number;
  active: boolean;
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

export interface Proposal {
  id: string;
  room: string;
  by: { id: string; name: string };
  text: string;
  createdAt: string;
  votes: Record<string, { vote: Vote; reason?: string; confidence?: number; name: string; ts: string }>;
  status: "open" | "accepted" | "rejected" | "superseded";
}

export interface Room {
  name: string;
  topic: string;
  mode: RoomMode;
  quorum: Quorum;
  maxRounds: number; // 0 = unlimited
  expectedParticipants: number;
  createdAt: string;
  state: RoomState;
  conclusion?: { text: string; proposalId: string; decidedAt: string };
  participants: Map<string, Participant>;
  messages: Message[];
  proposals: Map<string, Proposal>;
  /** round_robin bookkeeping */
  turnIndex: number;
  round: number;
  /** long-poll waiters keyed by participant */
  waiters: Set<() => void>;
  /** blind opening statements held back until everyone has submitted */
  openings: Map<string, string>;
  openingsRevealed: boolean;
}

export interface RoomOptions {
  topic?: string;
  mode?: RoomMode;
  quorum?: Quorum;
  maxRounds?: number;
  /** Blind openings are revealed, and proposals can be accepted, only once this many participants have joined. */
  expectedParticipants?: number;
}

type Event =
  | { type: "room"; room: string; opts: Required<RoomOptions>; createdAt: string }
  | { type: "message"; msg: Message }
  | { type: "join" | "leave"; room: string; p: Participant }
  | { type: "proposal"; proposal: Proposal }
  | { type: "vote"; room: string; proposalId: string; pid: string; entry: Proposal["votes"][string] }
  | { type: "state"; room: string; state: RoomState; conclusion?: Room["conclusion"] }
  | { type: "opening"; room: string; pid: string; content: string }
  | { type: "openings_revealed"; room: string };

const now = () => new Date().toISOString();
const shortId = (prefix: string) => `${prefix}_${randomBytes(4).toString("hex")}`;

export class HubError extends Error {}

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

  listRooms() {
    return [...this.rooms.values()].map((r) => this.summary(r));
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
    const full: Required<RoomOptions> = {
      topic: opts.topic ?? "",
      mode: opts.mode ?? "free",
      quorum: opts.quorum ?? "unanimous",
      maxRounds: opts.maxRounds ?? 0,
      expectedParticipants: opts.expectedParticipants ?? 0,
    };
    const room = this.materialiseRoom(name, full, now());
    this.persist({ type: "room", room: name, opts: full, createdAt: room.createdAt });
    return room;
  }

  private materialiseRoom(name: string, opts: Required<RoomOptions>, createdAt: string): Room {
    const room: Room = {
      name,
      topic: opts.topic,
      mode: opts.mode,
      quorum: opts.quorum,
      maxRounds: opts.maxRounds,
      expectedParticipants: opts.expectedParticipants,
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

  summary(room: Room) {
    const active = this.activeParticipants(room);
    return {
      name: room.name,
      topic: room.topic,
      mode: room.mode,
      quorum: room.quorum,
      max_rounds: room.maxRounds || null,
      expected_participants: room.expectedParticipants || null,
      state: room.state,
      openings: room.openingsRevealed
        ? "revealed"
        : `${room.openings.size} submitted, waiting for ${this.openingsWaitingOn(room).join(", ") || "nobody"}`,
      round: room.round,
      current_turn: room.mode === "round_robin" ? this.currentSpeaker(room)?.name ?? null : null,
      participants: [...room.participants.values()].map((p) => ({
        id: p.id,
        name: p.name,
        agent: p.agent,
        active: p.active,
        last_active_at: p.lastActiveAt,
      })),
      active_count: active.length,
      message_count: room.messages.length,
      latest_seq: room.messages.at(-1)?.seq ?? 0,
      proposals: [...room.proposals.values()].map((pr) => this.proposalView(room, pr)),
      conclusion: room.conclusion ?? null,
    };
  }

  // ---------- participants ----------

  join(roomName: string, name: string, agent: string, opts: RoomOptions = {}, reclaimId?: string): { room: Room; participant: Participant } {
    const room = this.createRoom(roomName, opts);
    if (!name.trim()) throw new HubError("A display name is required to join.");

    let participant = reclaimId ? room.participants.get(reclaimId) : undefined;
    if (!participant) {
      participant = [...room.participants.values()].find((p) => p.name === name && !p.active);
    }
    if (!participant) {
      if ([...room.participants.values()].some((p) => p.name === name && p.active)) {
        throw new HubError(`Someone named "${name}" is already active in "${roomName}". Pick another name.`);
      }
      participant = {
        id: shortId("p"),
        name,
        agent,
        joinedAt: now(),
        lastActiveAt: now(),
        lastSeenSeq: 0,
        active: true,
      };
      room.participants.set(participant.id, participant);
      this.persist({ type: "join", room: roomName, p: participant });
      this.post(room, "system", participant, `${name} (${agent}) joined the room.`);
    } else if (!participant.active) {
      participant.active = true;
      participant.lastActiveAt = now();
      this.persist({ type: "join", room: roomName, p: participant });
      this.post(room, "system", participant, `${participant.name} rejoined the room.`);
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
    this.post(room, "system", p, `${p.name} left the room.`);
    // Leaving may complete a quorum that was waiting on this participant.
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

  currentSpeaker(room: Room): Participant | undefined {
    const active = this.activeParticipants(room);
    if (active.length === 0) return undefined;
    return active[room.turnIndex % active.length];
  }

  // ---------- messages ----------

  send(roomName: string, pid: string, content: string, replyTo?: string): Message {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    if (room.state === "concluded") {
      throw new HubError(`Room "${roomName}" has concluded: ${room.conclusion?.text}. No further messages are needed.`);
    }
    if (!content.trim()) throw new HubError("Message content is empty.");
    if (room.mode === "round_robin") {
      const speaker = this.currentSpeaker(room);
      if (speaker && speaker.id !== p.id) {
        throw new HubError(`It is ${speaker.name}'s turn to speak, not yours. Call wait_for_messages until your_turn is true.`);
      }
      this.advanceTurn(room);
    }
    const msg = this.post(room, "chat", p, content, { replyTo });
    p.lastSeenSeq = Math.max(p.lastSeenSeq, msg.seq);
    return msg;
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
          `Round limit (${room.maxRounds}) reached without consensus. Please vote on the open proposals now; ` +
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
   * Long-poll: resolves as soon as there is a message with seq > sinceSeq
   * (or immediately if there already is one), otherwise after timeoutMs.
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
    if (p) {
      p.lastActiveAt = now();
      const last = room.messages.at(-1)?.seq ?? 0;
      p.lastSeenSeq = Math.max(p.lastSeenSeq, msgs.at(-1)?.seq ?? sinceSeq, msgs.length ? 0 : last);
    }
    return msgs;
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
    return msg;
  }

  private notify(room: Room) {
    for (const wake of [...room.waiters]) wake();
  }

  // ---------- blind openings ----------

  openingsWaitingOn(room: Room): string[] {
    const active = this.activeParticipants(room);
    const missing = active.filter((p) => !room.openings.has(p.id)).map((p) => p.name);
    const shortfall = Math.max(0, room.expectedParticipants - active.length);
    return shortfall > 0 ? [...missing, `${shortfall} more participant(s) to join`] : missing;
  }

  /**
   * A blind opening statement: held privately until every active participant
   * (and at least `expectedParticipants`) has submitted one, then all are posted
   * at once so nobody anchors on anyone else's first answer.
   */
  submitOpening(roomName: string, pid: string, content: string): { revealed: boolean; waiting_on: string[] } {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    if (room.openingsRevealed) throw new HubError("Openings have already been revealed in this room; use send_message.");
    if (!content.trim()) throw new HubError("Opening statement is empty.");
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

  propose(roomName: string, pid: string, text: string): Proposal {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    if (room.state === "concluded") throw new HubError(`Room "${roomName}" has already concluded.`);
    if (!text.trim()) throw new HubError("Proposal text is empty.");
    const open = [...room.proposals.values()].find((pr) => pr.status === "open");
    if (open) {
      throw new HubError(
        `Proposal ${open.id} by ${open.by.name} is already open: "${open.text.slice(0, 200)}". ` +
          `Vote on it (agree, or disagree with the change you need) instead of proposing a new one.`,
      );
    }
    const proposal: Proposal = {
      id: shortId("prop"),
      room: roomName,
      by: { id: p.id, name: p.name },
      text,
      createdAt: now(),
      votes: { [p.id]: { vote: "agree", name: p.name, ts: now(), reason: "proposer" } },
      status: "open",
    };
    room.proposals.set(proposal.id, proposal);
    this.persist({ type: "proposal", proposal });
    this.post(room, "proposal", p, `PROPOSAL ${proposal.id}: ${text}`, { proposalId: proposal.id });
    this.evaluate(room, proposal); // a solo room concludes immediately
    return proposal;
  }

  vote(roomName: string, pid: string, proposalId: string, vote: Vote, reason?: string, confidence?: number): Proposal {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    const proposal = room.proposals.get(proposalId);
    if (!proposal) throw new HubError(`No proposal "${proposalId}" in "${roomName}". See room_status for open proposals.`);
    if (proposal.status !== "open") throw new HubError(`Proposal ${proposalId} is already ${proposal.status}.`);
    const entry = { vote, reason, confidence, name: p.name, ts: now() };
    proposal.votes[p.id] = entry;
    this.persist({ type: "vote", room: roomName, proposalId, pid: p.id, entry });
    const conf = confidence !== undefined ? ` (confidence ${confidence})` : "";
    this.post(room, "vote", p, `${p.name} votes ${vote.toUpperCase()} on ${proposalId}${conf}${reason ? `: ${reason}` : ""}`, { proposalId });
    this.evaluate(room, proposal);
    return proposal;
  }

  proposalView(room: Room, pr: Proposal) {
    const active = this.activeParticipants(room);
    const tally = { agree: 0, disagree: 0, abstain: 0 };
    for (const p of active) {
      const v = pr.votes[p.id]?.vote;
      if (v) tally[v] += 1;
    }
    return {
      id: pr.id,
      by: pr.by.name,
      text: pr.text,
      status: pr.status,
      created_at: pr.createdAt,
      tally,
      waiting_on: active.filter((p) => !pr.votes[p.id]).map((p) => p.name),
      votes: Object.values(pr.votes).map((v) => ({ name: v.name, vote: v.vote, confidence: v.confidence, reason: v.reason })),
    };
  }

  /** Re-check whether a proposal has reached the room's quorum. */
  private evaluate(room: Room, pr: Proposal) {
    if (pr.status !== "open" || room.state === "concluded") return;
    const active = this.activeParticipants(room);
    if (active.length === 0) return;
    // Do not let an early majority decide before everyone expected has arrived.
    if (room.expectedParticipants && room.participants.size < room.expectedParticipants) return;
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
    // Stalled rooms fall back to plurality once everyone has voted.
    if (!accepted && !rejected && room.state === "stalled" && everyoneVoted && agree > disagree) accepted = true;

    if (accepted) this.conclude(room, pr);
    else if (rejected) {
      pr.status = "rejected";
      this.persist({ type: "proposal", proposal: pr });
      this.post(room, "system", undefined, `Proposal ${pr.id} was rejected (${agree} agree / ${disagree} disagree). Discuss the objections and propose a revision.`);
    }
  }

  private conclude(room: Room, pr: Proposal) {
    pr.status = "accepted";
    for (const other of room.proposals.values()) if (other.id !== pr.id && other.status === "open") other.status = "superseded";
    room.conclusion = { text: pr.text, proposalId: pr.id, decidedAt: now() };
    this.persist({ type: "proposal", proposal: pr });
    this.setState(room, "concluded");
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
          case "room":
            this.materialiseRoom(ev.room, ev.opts, ev.createdAt);
            break;
          case "message": {
            const room = this.rooms.get(ev.msg.room);
            room?.messages.push(ev.msg);
            break;
          }
          case "join":
          case "leave": {
            const room = this.rooms.get(ev.room);
            // Participants from a previous process are restored as inactive; they must rejoin.
            room?.participants.set(ev.p.id, { ...ev.p, active: false });
            break;
          }
          case "proposal": {
            const room = this.rooms.get(ev.proposal.room);
            room?.proposals.set(ev.proposal.id, ev.proposal);
            break;
          }
          case "vote": {
            const pr = this.rooms.get(ev.room)?.proposals.get(ev.proposalId);
            if (pr) pr.votes[ev.pid] = ev.entry;
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
