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
import { mkdirSync } from "node:fs";
import { analyzeReplyMetrics, type ReplyMetricEvent } from "./reply-metrics.js";

export * from "./hub/types.js";
import { VERIFY_HEAD_EXAMPLE, VERIFY_HEAD_RULE, parseVerifyHead, readVerifyHead, failToPassShortfall, ROLES, REFUSAL_CODES, HubError } from "./hub/types.js";
import type { MessageKind, Vote, Quorum, RoomState, VerifyHead, Role, Participant, KickVote, Message, CodeState, BoardExpiryOptions, BoardEntry, Challenge, ElectorateSummary, ConclusionVerification, Proposal, RoomOptions, JoinOptions, Room, CallOutcome, RefusalCode, BoardManifestObservation } from "./hub/types.js";
import { now, shortId, norm, emptyBoardManifestCounters, manifestBytes, codeState } from "./hub/internal.js";
import type { Opts, Event, BoardManifestCounters } from "./hub/internal.js";
import * as board from "./hub/board.js";
import * as kick from "./hub/kick.js";
import * as liveness from "./hub/liveness.js";
import * as persistence from "./hub/persistence.js";

export class Hub {
  readonly rooms = new Map<string, Room>();
  /** Fired on every room state transition (setState); the consolidator spawn listens for "concluded". */
  onRoomState?: (room: string, state: RoomState) => void;
  /** Observed waits only: deliberately not restored from historical room logs. */
  private readonly boardManifestObserved = new WeakMap<Room, BoardManifestCounters>();
  /** @internal */ readonly dataDir?: string;
  /** project directory whose git state is stamped on rooms and verify entries */
  /** @internal */ readonly cwd?: string;
  /** Ordered metric inputs retain historical membership, including in-memory rooms. */
  /** @internal */ readonly replyMetricEvents = new Map<string, ReplyMetricEvent[]>();

  constructor(opts: { dataDir?: string; cwd?: string } = {}) {
    this.dataDir = opts.dataDir;
    this.cwd = opts.cwd;
    if (this.dataDir) {
      mkdirSync(this.dataDir, { recursive: true });
      this.replay();
      // a sealed draft round interrupted by a restart still reveals on its original deadline, announced
      for (const room of this.rooms.values()) if (room.state !== "concluded" && room.state !== "closed") this.armDraftsDeadline(room);
    }
  }

  // ---------- rooms ----------

  listRooms(reveal = false, includeArchived = false) {
    return [...this.rooms.values()].filter((r) => includeArchived || !r.archived).map((r) => this.summary(r, reveal));
  }

  getRoom(name: string): Room {
    const r = this.rooms.get(name);
    if (!r) throw new HubError(Hub.ROOM_NAME.test(name) ? `Room "${name}" does not exist. Use join_room (it auto-creates) or list_rooms.` : "Invalid room name.");
    return r;
  }

  static readonly MAX_ROOMS = 500;
  /** Rendered chars one wait/read may carry: a 66 KB backlog once overflowed a client's tool-result limit. */
  static DELIVERY_MAX_CHARS = 24_000;
  static MAX_ROOMS_PER_RUN = Number(process.env.CHATROOM_MAX_ROOMS_PER_RUN ?? 12);
  static MAX_LIVE_PER_ROOM = Number(process.env.CHATROOM_MAX_LIVE_PER_ROOM ?? 12);
  /** silence before the hub nudges a room (and reveals stale openings); CHATROOM_NUDGE_AFTER_MS lets tests shorten it */
  static DEFAULT_NUDGE_MS = Number(process.env.CHATROOM_NUDGE_AFTER_MS ?? 180_000);
  /** draft/* is revealed this long after the first draft even if some drafter never wrote one (0 = wait for all) */
  static DRAFT_REVEAL_MS = Number(process.env.CHATROOM_DRAFT_REVEAL_MS ?? 600_000);
  static readonly ROOM_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

  static codeState(cwd?: string): CodeState | undefined { return codeState(cwd); }
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
      ...(opts.parent ? { parent: opts.parent } : {}),
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

  /** @internal */ materialiseRoom(name: string, opts: Opts, createdAt: string): Room {
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
      boardVersion: 0,
      boardVersions: new Map(),
      humanWarned: new Set(),
      responders: new Map(),
      kickVotes: new Map(),
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
    const observedAt = Date.now();
    const active = this.activeParticipants(room);
    const nm = (p: Participant) => (reveal ? p.name : this.shown(room, p));
    const speaker = this.currentSpeaker(room);
    return {
      name: room.name,
      topic: room.topic,
      ...(room.parent ? { parent: room.parent } : {}),
      ...(this.breakouts(room).length ? { breakouts: this.breakouts(room) } : {}),
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
      archived: !!room.archived,
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
        last_seen_at: this.lastSeen(p),
        working: p.working ?? null,
        liveness: (() => {
          const age = (at: string) => Math.max(0, Math.floor((observedAt - Date.parse(at)) / 1000));
          const age_seconds = age(this.lastSeen(p));
          const away = this.away(p);
          if (away) return { status: "away", age_seconds, heartbeat_age_seconds: p.working ? age(p.working.at) : null, away: away.evidence };
          return { status: !p.active ? "left" : age_seconds < 60 ? "active" : age_seconds * 1000 < kick.SUSPECTED_DEAD_MS ? "idle" : "suspected_dead",
            age_seconds, heartbeat_age_seconds: p.working ? age(p.working.at) : null };
        })(),
        left_reason: p.active ? null : p.leaveReason ?? null,
        ...(p.kicked ? { kicked: p.kicked } : {}),
      })),
      kick_votes: [...room.kickVotes.values()].map((kv) => this.kickView(room, kv, reveal)),
      // claim/* entries whose owner left: its registered successor may take one at once, anyone after Hub.STALE_CLAIM_MS
      stale_claims: this.staleClaims(room, reveal),
      active_count: active.length,
      message_count: room.messages.length,
      latest_seq: room.messages.at(-1)?.seq ?? 0,
      proposals: [...room.proposals.values()].map((pr) => this.proposalView(room, pr, reveal, pr.status === "open" || pr.status === "accepted")),
      // agents get a manifest (board_get <key> fetches text); the human dashboard (reveal) gets the text
      board: Object.fromEntries([...room.board].filter(([k, e]) => reveal || (!this.boardEntryExpired(room, k, e) && !this.draftSealed(room, k, e))).map(([k, e]) => [k, { ...(reveal ? { text: e.text } : {}), by: e.by, chars: e.text.length, updated_at: e.updatedAt, ...(e.postReveal ? { post_reveal: true } : {}), ...(e.reviewer ? { reviewer: e.reviewer } : {}) }])),
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

  /** Optional integration hook for full or delta wait responses. Call exactly once
   * per successfully returned wait, with only its manifest envelope. */
  observeBoardManifest(room: Room, envelope: BoardManifestObservation): void {
    const counters = this.boardManifestObserved.get(room) ?? emptyBoardManifestCounters();
    counters.waits_observed++;
    counters.full_baseline_manifest_bytes += manifestBytes({ board_keys: [...room.board.keys()] });
    counters.shipped_manifest_bytes += manifestBytes(envelope);
    counters.keys_shipped += envelope.board_keys?.length ?? envelope.board_delta?.keys.length ?? 0;
    counters.deleted_tombstones_shipped += envelope.board_delta?.tombstones.length ?? 0;
    this.boardManifestObserved.set(room, counters);
  }

  private boardManifestStats(room: Room) {
    const entriesByPrefix: Record<string, number> = {
      "claim/": 0, "evidence/": 0, "sources/": 0, "handoff/": 0,
      "inbox/": 0, "verify/": 0, other: 0,
    };
    for (const key of room.board.keys()) {
      const prefix = key.includes("/") ? key.slice(0, key.indexOf("/") + 1) : "other";
      entriesByPrefix[Object.hasOwn(entriesByPrefix, prefix) ? prefix : "other"]++;
    }
    return {
      coverage: "since-process-start" as const,
      ...(this.boardManifestObserved.get(room) ?? emptyBoardManifestCounters()),
      current_full_manifest_bytes: manifestBytes({ board_keys: [...room.board.keys()] }),
      entries_by_prefix: entriesByPrefix,
    };
  }

  stats(room: Room, replyWindowMinutes = 15) {
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
      reply_metrics: analyzeReplyMetrics(this.replyMetricEvents.get(room.name) ?? [], {
        windowMinutes: replyWindowMinutes,
        asOf: now(),
        ...(room.state === "closed" || room.state === "concluded" ? { observationEnd: this.replyMetricObservationEnd(room.name) } : {}),
      }),
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
      proposal_electorates: [...room.proposals.values()].filter((pr) => pr.status === "open").map((pr) => ({
        proposal_id: pr.id, ...this.electorateSummary(room, pr),
      })),
      // Legacy conclusions did not record an electorate; do not reconstruct a false historical denominator.
      conclusion_electorate: room.conclusion?.electorate ?? null,
      amendments: [...room.proposals.values()].reduce((a, p) => a + (p.version - 1), 0),
      challenges: [...room.proposals.values()].reduce((a, p) => a + p.challenges.length, 0),
      board_entries: room.board.size,
      board_manifests: room.boardManifests ?? null, // persisted pretty-byte counters (delta branch)
      board_manifest: this.boardManifestStats(room), // compact since-process-start counters (stats branch)
      refusals: room.refusals ?? {},
      call_outcomes: callOutcomes,
      refusal_rates: refusalRates,
      refusal_rate_coverage: room.telemetryVersion === 1 ? "complete" : "unknown",
      near_simultaneous_replies: bursts,
      unanswered_human_messages: room.messages.filter((m) => m.kind === "chat" && m.from.agent === "human" && !this.isAnswered(room, m)).length,
    };
  }

  // ---------- participants ----------

  /** Trusted launcher control only: the departed process is known by the launcher, not inferred by the hub.
   * Registers an explicit old->new replacement, deactivates the predecessor immediately and reserves the
   * successor name behind a one-use token the successor must present at join. */
  registerReplacement(roomName: string, predecessor: string, successorName: string): { replacementToken: string } {
    const room = this.getRoom(roomName);
    const old = room.participants.get(predecessor) ?? [...room.participants.values()].find((p) => p.name === predecessor);
    if (!old) throw new HubError("Replacement predecessor is not registered in this room.");
    if (!successorName.trim() || successorName.length > 64 || !/^[^\n\r<>]+$/.test(successorName)) throw new HubError("Invalid replacement display name.");
    if (old.replacedBy || old.pendingReplacementName) throw new HubError("A replacement is already registered for this participant.");
    if ([...room.participants.values()].some((p) => p.name === successorName || p.pendingReplacementName === successorName)) {
      throw new HubError("Replacement must be a new, unreserved participant name.");
    }
    // The launcher asserts the process exit; do not wait for the idle sweep to mark the old seat departed.
    const replacementToken = randomBytes(32).toString("hex");
    old.pendingReplacementAskIds = this.addressedBy(room, old).map((m) => m.id);
    old.active = false;
    old.pendingReplacementName = successorName;
    old.pendingReplacementTokenHash = createHash("sha256").update(replacementToken).digest("hex");
    this.persist({ type: "leave", room: roomName, p: old });
    this.post(room, "system", undefined, `${this.shown(room, old)} left the room; the launcher registered a replacement seat.`);
    for (const pr of room.proposals.values()) if (pr.status === "open") this.evaluate(room, pr);
    this.latchDrafts(room);
    return { replacementToken };
  }

  /** Follow only explicit links; restored or subsequently departed successors are never recommended. */
  private activeReplacement(room: Room, old: Participant): Participant | undefined {
    const seen = new Set([old.id]);
    let current = old;
    let active: Participant | undefined;
    while (current.replacedBy) {
      const next = room.participants.get(current.replacedBy);
      if (!next || seen.has(next.id)) break;
      seen.add(next.id);
      if (next.active) active = next;
      current = next;
    }
    return active;
  }

  join(roomName: string, name: string, agent: string, opts: JoinOptions = {}, reclaimId?: string, session?: string, role?: Role): { room: Room; participant: Participant } {
    const existing = this.rooms.get(roomName);
    if (existing && opts.parent !== undefined && existing.parent !== opts.parent) {
      throw new HubError(`"${roomName}" already exists${existing.parent ? ` as a breakout of "${existing.parent}"` : " and is not a breakout"}; a room is never re-parented. Join it without parent, or open a breakout under a new name.`);
    }
    const opening = opts.parent !== undefined && !existing;
    if (opening) this.checkBreakout(roomName, opts.parent!, session);
    const room = this.createRoom(roomName, opening ? opts : { ...opts, parent: undefined });
    if (opening) this.announceBreakout(room, name);
    if (role && !ROLES.includes(role)) throw new HubError(`role must be one of ${ROLES.join(", ")}.`);
    if (role === "chair") {
      // the chair is bound to a name: the room option (set at creation) or, failing that, the first claimant
      if (room.chair && room.chair !== name) throw new HubError(`This room's chair is ${room.chair}. Join without role=chair.`);
    }
    if (!name.trim()) throw new HubError("A display name is required to join.");
    if (name.length > 64) throw new HubError("Display names are capped at 64 characters.");
    if (!/^[^\n\r<>]+$/.test(name)) throw new HubError("Display names cannot contain newlines or angle brackets.");

    // Identity is the connection: the session that already holds this name in this room is asking again (a model
    // that dropped context and forgot it had joined). Give it its own seat back instead of "pick another name",
    // which is how bench-3 became bench-3b next to its own live seat.
    const mine = session ? [...room.participants.values()].find((p) => p.active && p.session === session && p.name === name) : undefined;
    let participant = mine ?? (reclaimId ? room.participants.get(reclaimId) : undefined);
    if (participant && participant.name !== name) throw new HubError("participant_id does not belong to that name.");
    if (!participant) participant = [...room.participants.values()].find((p) => p.name === name && !p.active);
    // A removed seat stays removed: not under its old name, its old id, or a new name on the same connection.
    const kickedSeat = participant?.kicked ? participant
      : session ? [...room.participants.values()].find((p) => p.kicked && p.session === session) : undefined;
    if (kickedSeat) throw new HubError(Hub.kickedMessage(room, kickedSeat), undefined, "auth");
    // Humans are identified by name alone (they come in over plain HTTP with no session), so they always reclaim.
    if (!participant && agent === "human") participant = [...room.participants.values()].find((p) => p.name === name && p.agent === "human");
    if (participant && opts.replacementToken !== undefined) throw new HubError("Replacement token has already been consumed or is not reserved for this join.");
    if (!participant) {
      const reserved = [...room.participants.values()].find((p) => p.pendingReplacementName === name);
      const tokenHash = opts.replacementToken ? createHash("sha256").update(opts.replacementToken).digest("hex") : undefined;
      if (reserved ? !tokenHash || tokenHash !== reserved.pendingReplacementTokenHash : opts.replacementToken !== undefined) {
        throw new HubError("A valid launcher replacement token for this room and name is required.");
      }
      if ([...room.participants.values()].some((p) => p.name === name && p.active)) {
        throw new HubError(`Someone named "${name}" is already active in "${roomName}". Pick another name.`);
      }
      if (agent !== "human" && this.voters(room).length >= Hub.MAX_LIVE_PER_ROOM) {
        this.post(room, "system", undefined, `Cap hit: ${Hub.MAX_LIVE_PER_ROOM} live agents in this room; ${name} could not join. Recruit into a new room instead.`);
        throw new HubError(`Room "${roomName}" already has ${Hub.MAX_LIVE_PER_ROOM} live agents (per-run cap). Open a sub-room instead.`);
      }
      const n = room.participants.size;
      if (role === "chair" && !room.chair) room.chair = name;
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
        seatKeyHash: this.seats.hashOf(session),
        ...(role && role !== "worker" ? { role } : {}),
      };
      const predecessor = [...room.participants.values()].find((p) => p.pendingReplacementName === name);
      if (predecessor) {
        participant.replacementOf = predecessor.id;
        predecessor.replacedBy = participant.id;
        participant.inheritedAskIds = predecessor.pendingReplacementAskIds ?? [];
        delete predecessor.pendingReplacementName;
        delete predecessor.pendingReplacementTokenHash;
        delete predecessor.pendingReplacementAskIds;
        this.persist({ type: "leave", room: roomName, p: predecessor });
      }
      room.participants.set(participant.id, participant);
      this.persist({ type: "join", room: roomName, p: participant });
      this.post(room, "system", undefined, `${this.shown(room, participant)}${room.anonymous ? "" : ` (${agent})`}${this.roleTag(participant)} joined the room.`);
    } else if (!participant.active) {
      participant.active = true;
      participant.lastActiveAt = now();
      if (session) participant.session = session;
      participant.seatKeyHash = this.seats.hashOf(session) ?? participant.seatKeyHash;
      delete participant.restoredAt;
      if (role && role !== "worker") participant.role = role;
      this.persist({ type: "join", room: roomName, p: participant });
      this.post(room, "system", undefined, `${this.shown(room, participant)} rejoined the room.`);
    }
    // Bind the chair only after admission succeeds: rejected joins must not reserve it.
    if (role === "chair") room.chair = name;
    // Reclaiming even an active seat is an explicit delivery reset (lost response recovery).
    delete participant.lastBoardSeen;
    delete participant.seenBoardKeys;
    for (const pr of room.proposals.values()) if (pr.status === "open") this.evaluate(room, pr);
    return { room, participant };
  }

  /** Why this participant's departure would leave the open proposal unpassable, if it would. */
  leavingWouldBlock(room: Room, p: Participant): { proposal: Proposal; reason: string } | undefined {
    if (p.agent === "human" || p.role === "chair") return undefined;
    if (room.state === "concluded" || room.state === "closed") return undefined; // nothing left to block
    const open = [...room.proposals.values()].find((pr) => pr.status === "open");
    if (!open) return undefined;
    const others = this.electorate(room, open, p.id).members;
    if (room.expectedParticipants !== 1 && Hub.sessionsOf(others) < 2) {
      return { proposal: open, reason: `the room would be left with ${others.length} voter(s), and a room of one cannot conclude, so ${open.id} could never pass` };
    }
    return undefined;
  }

  leave(roomName: string, pid: string, reason?: string): void {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    const why = reason?.trim() || undefined;
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
    if (why) p.leaveReason = why;
    this.persist({ type: "leave", room: roomName, p });
    this.post(room, "system", undefined, `${this.shown(room, p)} left the room${why ? `: ${why}` : "."}`);
    for (const pr of room.proposals.values()) if (pr.status === "open") this.evaluate(room, pr);
    this.latchDrafts(room); // the last non-drafter leaving completes the set: reveal and announce it
  }

  /**
   * Why an agent should not leave yet, or null. Refused once per participant (like the quorum-floor refusal): the
   * point is to make the seat write the handoff or answer the ask, not to cage it. Humans and session cleanup skip it,
   * and so does a concluded or closed room: the hub has already released every claim/* itself (releaseClaims), so
   * there is nothing left to hand off, and an unanswered ask in a room nobody can act in owes nobody anything.
   * A claim/* by this seat counts as handed over when a handoff/* by the same seat exists or the claim's JSON status
   * says done/fixed/handed; the launcher's respawn rule (src/respawn.ts) reads the board the same way.
   */
  leaveRefusal(room: Room, p: Participant): string | null {
    if (p.agent === "human" || p.leaveWarnedExit) return null;
    if (room.state === "concluded" || room.state === "closed") return null; // the hub releases claims itself; nobody is owed a handoff in a room nobody can act in
    const name = p.name;
    const handedOff = [...room.board.entries()].some(([k, e]) => k.startsWith("handoff/") && e.by === name);
    const orphaned = [...room.board.entries()].filter(([k, e]) => {
      if (!k.startsWith("claim/") || e.by !== name || handedOff) return false;
      try { const j = JSON.parse(e.text) as { status?: string }; if (/^(done|fixed|handed|handed-over|closed|complete|completed)$/i.test(j.status ?? "")) return false; } catch {}
      return true;
    }).map(([k]) => k);
    const owed = this.addressedBy(room, p);
    if (!orphaned.length && !owed.length) return null;
    p.leaveWarnedExit = true;
    const parts: string[] = [];
    if (orphaned.length) parts.push(`you still own ${orphaned.slice(0, 3).join(", ")} with no handoff/* by you: board_set handoff/${orphaned[0].slice("claim/".length)} saying what is done, where it is, and what is undone (or mark the claim's status done)`);
    if (owed.length) parts.push(`${this.shown(room, owed[0].from)} asked you at #${owed[0].seq}: reply (send_message reply_to="${owed[0].id}") or pass`);
    return `Before you leave: ${parts.join("; ")}. Then leave_room again with your reason. Calling leave_room again now leaves anyway.`;
  }

  requireParticipant(room: Room, pid: string): Participant {
    const p = room.participants.get(pid);
    if (!p) throw new HubError(`You are not a participant of "${room.name}". Call join_room first.`, undefined, "auth");
    if (p.kicked) throw new HubError(Hub.kickedMessage(room, p), undefined, "auth");
    if (!p.active) throw new HubError(`You have left "${room.name}". Call join_room again to rejoin.`, undefined, "auth");
    return p;
  }

  /** What a removed seat is told on its next call: unambiguous, and it says not to rejoin. */
  static kickedMessage(room: Room, p: Participant): string {
    const k = p.kicked!;
    return `KICKED: you (${p.name}) were removed from "${room.name}" by ${k.by} at ${k.at}: ${k.reason}. This seat is closed; you cannot rejoin, send, vote or write to the board here. Stop working on this room.`;
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

  /**
   * Proposal membership: ordinary leavers are excluded, ordinary late joiners are not counted.
   * If attrition drops the surviving snapshot below the independent-connection floor, the
   * earliest joined eligible voters on new connections replace it (Map order breaks timestamp
   * ties). This is pure, including for hypothetical departures, and is reproducible after replay.
   * Missing/empty snapshots are legacy rooms and retain their all-voter compatibility.
   */
  electorate(room: Room, pr: Pick<Proposal, "snapshot">, leavingId?: string) {
    const all = this.voters(room).filter((p) => p.id !== leavingId);
    const snapshot = pr.snapshot?.length ? new Set(pr.snapshot) : undefined;
    const members = snapshot ? all.filter((p) => snapshot.has(p.id)) : [...all];
    const replacements: Participant[] = [];
    const identity = (p: Participant) => p.session ?? p.id;
    const sessions = new Set(members.map(identity));
    if (snapshot && room.expectedParticipants !== 1 && sessions.size < 2) {
      for (const p of [...all].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))) {
        if (sessions.has(identity(p))) continue;
        members.push(p);
        replacements.push(p);
        sessions.add(identity(p));
        if (sessions.size >= 2) break;
      }
    }
    const excluded = snapshot ? [...snapshot].filter((id) => id === leavingId || !room.participants.get(id)?.active)
      .map((id) => ({ id, reason: "left-before-close" as const })) : [];
    return { members, replacements, excluded, distinctSessions: sessions.size };
  }

  private electorateSummary(room: Room, pr: Proposal): ElectorateSummary {
    const e = this.electorate(room, pr);
    const tally = { agree: 0, disagree: 0, abstain: 0 };
    for (const p of e.members) {
      const vote = pr.votes[p.id]?.vote;
      if (vote) tally[vote]++;
    }
    return { electorate: e.members.length, ...tally, excluded_leavers: e.excluded.length,
      distinct_sessions: e.distinctSessions, denominator: "electorate" };
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

  /** Substantive messages from others that this participant has not read yet (hub notices do not count). */
  unread(room: Room, p: Participant): Message[] {
    // Hub notices are news, not debt: system lines, [BOARD] lines and hub-authored @-notices (reviewer assignment)
    // never block a send, and nor do human messages someone else has already answered. They stay unread, so the next
    // wait still delivers them. Counting them cost a refused call plus a forced retry (13 of 140 arrived-refusals in
    // four real runs, scripts/refused-send-split.py).
    return this.deliverable(room, p, p.lastSeenSeq).filter((m) =>
      m.kind !== "system" && !this.isHubNotice(m) && !(m.from.agent === "human" && this.isAnswered(room, m)));
  }

  /** A [BOARD] line or a hub-authored chat notice (reviewer assignment, claim overlap): news that nobody can reply to. */
  isHubNotice(m: Message): boolean {
    return m.kind === "board" || (m.from.id === "system" && m.kind === "chat");
  }

  /** Push predicate: quiet messages are pushed only to their audience. Everything else defers to visibleTo. Never used by read(). */
  pushableTo(room: Room, m: Message, pid: string | undefined): boolean {
    if (m.quiet && pid && !(m.audience ?? []).includes(pid)) return false;
    return this.visibleTo(room, m, pid);
  }

  /** Messages this participant has not seen: new pushable ones plus previously withheld ones that are now visible. */
  deliverable(room: Room, p: Participant, since: number): Message[] {
    const focus = this.attentionFocus(room, p);
    if (focus && this.focusExclusive(focus)) return [focus];
    const held = new Set(p.withheld ?? []);
    const queue = room.messages.filter((m) => m.from.id !== p.id && ((m.seq > since && this.pushableTo(room, m, p.id)) || (held.has(m.seq) && this.visibleTo(room, m, p.id))));
    return this.focusFirst(focus, queue);
  }

  /**
   * Only a human's message holds a seat's whole inbox until it is answered (humans-answered-once). A peer's
   * @-ask is delivered first with the queue behind it: pinned alone, it hid everything else until the seat
   * replied, and in swarm-083203-kooz that starvation produced duplicate builds and stale merges.
   */
  focusExclusive(focus: Message): boolean {
    return focus.from.agent === "human";
  }

  /**
   * Cut one delivery to DELIVERY_MAX_CHARS of rendered text (never below one message) and record how many
   * were left for the next call. The rest keep their place: the caller settles only up to the last one sent.
   */
  capDelivery(room: Room, p: Participant, msgs: Message[]): Message[] {
    let used = 0;
    let n = 0;
    for (const m of msgs) {
      used += this.fmt(room, m).length;
      if (n > 0 && used > Hub.DELIVERY_MAX_CHARS) break;
      n++;
    }
    p.deliveryRemaining = msgs.length - n;
    return n < msgs.length ? msgs.slice(0, n) : msgs;
  }

  /** How many messages the seat's last wait/read left for the next call. */
  deliveryRemaining(p: Participant): number {
    return p.deliveryRemaining ?? 0;
  }

  /** The focused ask leads; the rest keep log order. */
  private focusFirst(focus: Message | undefined, queue: Message[]): Message[] {
    return focus ? [focus, ...queue.filter((m) => m.id !== focus.id)] : queue;
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
    // A hub notice that @-names a seat (the reviewer assignment) is news, not a question: it has no author to
    // reply_to, so once delivered it retires instead of staying the focused ask. Left as debt, it pinned every
    // later wait/read to that one message and refused send_message as "arrived while composing" until pass.
    for (const m of delivered) {
      if (m.from.id !== "system" || m.kind !== "chat" || !m.mentions?.includes(p.id) || p.declinedAsks?.includes(m.id)) continue;
      p.declinedAsks = [...(p.declinedAsks ?? []), m.id];
      p.declinedAt = { ...(p.declinedAt ?? {}), [m.id]: m.seq };
    }
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
    const exclusive = focus && this.focusExclusive(focus) ? focus : undefined;
    const all = room.messages.filter((m) => (m.seq > since || held.has(m.seq)) && this.visibleTo(room, m, p.id) && m.id !== focus?.id);
    // the focused ask counts toward the limit: it used to ride on top of `limit` queued messages
    const msgs = exclusive ? [exclusive] : this.capDelivery(room, p, this.focusFirst(focus, all.slice(0, focus ? limit - 1 : limit)));
    p.deliveryRemaining = exclusive ? 0 : all.length + (focus ? 1 : 0) - msgs.length;
    const queue = msgs.filter((m) => m.id !== focus?.id);
    // settle only up to the last message sent, so a capped page leaves the rest unread rather than parked
    if (msgs.length) this.settleRead(room, p, Math.min(since, p.lastSeenSeq), msgs,
      exclusive ? undefined : Math.max(queue.length ? 0 : p.lastSeenSeq, ...queue.map((m) => m.seq), focus?.seq ?? 0));
    return msgs;
  }

  send(roomName: string, pid: string, content: string, replyTo?: string, force = false, quiet = false, surface = false): Message {
    const room = this.getRoom(roomName);
    const p = this.requireParticipant(room, pid);
    // Validate before any delivery, surfacing or turn mutation, even on forced sends.
    // Keep departed identities in mentionsIn: filtering them there would silently lose the ask.
    // Rejoin/reclaim reactivates the same pid (and name); no name-similarity replacement is inferred.
    // Humans are exempt: they come and go over HTTP and a reply to their ask must name them; so is the author of the
    // message being replied to, whose ask outlives them (a reply_to is how the hub counts it answered).
    const replyAuthor = replyTo ? room.messages.find((m) => m.id === replyTo)?.from.id : undefined;
    const departed = this.mentionsIn(room, content)
      .map((id) => room.participants.get(id)!)
      .filter((participant) => !participant.active && participant.agent !== "human" && participant.id !== replyAuthor);
    if (departed.length) {
      // Rejoin/reclaim reactivates the same pid (and name); no name-similarity replacement is inferred.
      const replacements = departed.map((participant) => this.activeReplacement(room, participant));
      if (replacements.some(Boolean)) {
        throw new HubError(`Cannot send: ${departed.map((participant, i) =>
          `"${participant.name}" has left the room; ${replacements[i] ? `their replacement is "${replacements[i]!.name}"` : "no replacement is recorded"}`,
        ).join("; ")}. Remove the departed @-mention or address an active participant.`);
      }
      throw new HubError(
        `Cannot send: ${departed.map((participant) => `"${participant.name}"`).join(", ")} ${departed.length === 1 ? "has" : "have"} left the room. Remove the departed @-mention or address an active participant; no replacement is recorded.`,
      );
    }
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
      // The human room's verified contract (ea78cf9, human-takeover-regression): only the hub's responder may answer a
      // targeted human ask: the addressee while live and within its window, then the nominated successor. An ask whose
      // addressee left is therefore not open to everyone; it is handed to the current nominee (supersedes the
      // maintainer's "anyone may take an orphaned ask" fix of 9b69261, whose test now asserts the nominee path).
      if (to && to !== "all" && !resp.mine) {
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
        // An ask the seat was already shown did not "arrive while composing": it is a reply still owed.
        const focus = this.attentionFocus(room, p);
        const owed = focus && unread[0].id === focus.id && p.focusedAsk === focus.id ? focus : undefined;
        // the refusal IS the delivery: settle the cursor so the same batch is not shipped again by the next wait
        this.settleRead(room, p, p.lastSeenSeq, unread);
        if (owed) {
          const queued = unread.length - 1;
          const latest = [...room.messages].reverse().find((m) => this.pushableTo(room, m, p.id))!.seq;
          throw new HubError(
            `You still owe a reply to #${owed.seq} from ${this.shown(room, owed.from)}. Reply with send_message reply_to="${owed.id}", or call pass to decline it. ` +
              `${queued} other message(s) queued behind it (below); the latest seq is #${latest}.`,
            { hint: this.attentionHint(room, p), owed_seq: owed.seq, queued, latest_seq: latest, unread: unread.map((m) => this.fmt(room, m)), next_seq: latest },
          );
        }
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
      // A reply already names its audience: the parent's author, when that is another live agent.
      const author = parent && parent.from.id !== p.id && room.participants.get(parent.from.id)?.active ? [parent.from.id] : [];
      const targets = [...new Set([...mentions, ...inherited, ...author])].filter((id) => {
        const agent = room.participants.get(id)?.agent;
        return agent !== undefined && agent !== "human";
      });
      if (targets.length === 0) throw new HubError("A quiet message must @-name at least one agent (not a human), or reply_to another agent's message. Quiet is not privacy: everyone can still read it.");
      audience = [...new Set([p.id, ...targets])];
    }
    if (this.attentionFocus(room, p) || p.withheld?.length) this.settleRead(room, p, p.lastSeenSeq, []);
    // Notices did not block this send (unread()), but sending moves the cursor past them: hold them so the next wait
    // still delivers them.
    const notices = room.messages.filter((m) => m.seq > p.lastSeenSeq && m.from.id !== p.id && this.isHubNotice(m) && this.pushableTo(room, m, p.id));
    if (notices.length) p.withheld = [...new Set([...(p.withheld ?? []), ...notices.map((m) => m.seq)])];
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
    if (!p) return msgs;
    const page = this.capDelivery(room, p, msgs);
    // a capped page settles only up to its last message; the rest stay unread for the next call
    this.settleRead(room, p, sinceSeq, page, page.length < msgs.length ? Math.max(...page.map((m) => m.seq)) : undefined);
    return page;
  }

  /** Plain-text rendering of a message as agents see it (pseudonyms in anonymous rooms). */
  fmt(room: Room, m: Message): string {
    const tag = m.kind === "chat" ? "" : `[${m.kind.toUpperCase()}] `;
    const who = m.from.id === "system" ? "system" : this.shown(room, m.from) + this.roleTag(room.participants.get(m.from.id) ?? {});
    const q = m.audience ? `[${m.quiet ? "quiet" : "was quiet"} → ${m.audience.filter((id) => id !== m.from.id).map((id) => this.shown(room, room.participants.get(id) ?? { id, name: id })).join(", ")}] ` : "";
    return `#${m.seq} ${who}: ${q}${tag}${m.content}`;
  }

  /** @internal */ post(room: Room, kind: MessageKind, from: Participant | undefined, content: string, extra: Partial<Message> = {}): Message {
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
  recordRefusal(roomName: string | undefined, tool: string, errorOrMessage: string | HubError, participant: string | null = null) {
    const room = roomName ? this.rooms.get(roomName) : undefined;
    if (!room) return;
    // Error messages can interpolate submitted text/secrets. Persist exactly one
    // closed-enum code: only a typed code set by the throw site classifies a
    // refusal, and it must be a member of REFUSAL_CODES at runtime (JS callers
    // can bypass the TS union); anything else (string errors, untyped HubErrors,
    // out-of-enum codes) stays hub_guard. Never raw text or args.
    const reason: RefusalCode = errorOrMessage instanceof HubError
      && errorOrMessage.code !== undefined
      && REFUSAL_CODES.includes(errorOrMessage.code)
      ? errorOrMessage.code
      : "hub_guard";
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

  /** @internal */ applyCallCompletion(room: Room, tool: string, outcome: CallOutcome) {
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
    // No delivered focus means no decline. Never acknowledge unseen asks. With no focus set, the next open peer ask
    // counts as focused once it has been delivered (seq <= lastSeenSeq), so N passes retire N delivered asks instead
    // of costing a wait per ask (swarm-092653-202z: an integrator's 5 answered READYs each ended a held wait at once).
    if (!p.focusedAsk) {
      const next = this.attentionFocus(room, p);
      if (next && next.from.agent !== "human" && next.seq <= p.lastSeenSeq) p.focusedAsk = next.id;
    }
    if (p.focusedAsk &&(this.addressedBy(room, p).some((m) => m.id === p.focusedAsk) || room.messages.some((m) => m.id === p.focusedAsk && m.from.agent === "human" && !this.isAnswered(room, m)))) {
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
    // ...except from the seat the hub itself asked to answer (the nominated responder) or the seat the human addressed:
    // their named reply is the answer whenever it lands. Without this, an ask addressed to a seat that then died was
    // re-served to every fresh seat for an hour because its answers arrived after the human's next message and
    // without reply_to (swarm-214936-s3jy-room #587; answered at #694, #720, #731, #732).
    const addressed = this.addressee(room, human);
    // Only an ask whose named addressee has left is "orphaned"; un-addressed and @all asks keep the strict rule, so a
    // generic reply after two un-addressed asks still attaches to the newer one.
    const orphaned = !!addressed && addressed !== "all" && !room.participants.get(addressed)?.active;
    const nominated = orphaned ? room.responders.get(human.id)?.pid : undefined;
    return room.messages.some(
      (m) =>
        m.seq > human.seq &&
        m.kind === "chat" &&
        m.from.agent !== "human" &&
        (m.replyTo === human.id ||
          ((m.seq < nextHumanSeq || m.from.id === nominated || (addressed !== "all" && m.from.id === addressed)) && this.namesHuman(room, human, m.content))),
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

  /** Linked chat resolves agent debt: reply_to settles its target and @-back settles
   * every earlier ask from each named sender, including when both appear together.
   * Other post kinds never resolve debt (hub-carries-what-it-knows). */
  addressedBy(room: Room, p: Participant): Message[] {
    const declined = new Set(p.declinedAsks ?? []);
    // Snapshot only outstanding debt at registration; successors settle it under their own
    // identity. A later replacement snapshots that successor, not all earlier ancestors.
    const inherited = new Set(p.inheritedAskIds ?? []);
    const pending: Message[] = [];
    for (const m of room.messages) {
      for (let i = pending.length - 1; i >= 0; i--) if ((p.declinedAt?.[pending[i].id] ?? Infinity) < m.seq) pending.splice(i, 1);
      if (m.kind !== "chat" || m.tag === "opening") continue;
      if (m.from.id === p.id) {
        // A reply settles its target, and @-naming someone settles everything they asked before it:
        // clearing only their oldest ask re-delivered the rest as focused asks on every later wait.
        const senders = new Set(m.mentions ?? []);
        for (let i = pending.length - 1; i >= 0; i--) {
          if (pending[i].id === m.replyTo || senders.has(pending[i].from.id)) pending.splice(i, 1);
        }
      } else {
        // A "one of you" ask: once any other seat it named replies, nobody it named still owes it.
        // Same rule as a seat's own reply: reply_to retires that ask, an @-back the oldest from each sender.
        const namedReplier = (ask: Message) => ask.mentions?.includes(m.from.id) ?? false;
        if (m.replyTo) {
          const i = pending.findIndex((ask) => ask.id === m.replyTo && namedReplier(ask));
          if (i >= 0) pending.splice(i, 1);
        } else {
          for (const sender of m.mentions ?? []) {
            const i = pending.findIndex((ask) => ask.from.id === sender && namedReplier(ask));
            if (i >= 0) pending.splice(i, 1);
          }
        }
        if (m.from.agent !== "human" &&
          ((m.mentions?.includes(p.id) && this.pushableTo(room, m, p.id)) || inherited.has(m.id))) pending.push(m);
      }
    }
    return pending.filter((m) => !declined.has(m.id));
  }

  attentionFocus(room: Room, p: Participant): Message | undefined {
    if (p.agent === "human" || p.role === "chair" || room.state === "closed" || room.state === "concluded") return;
    const human = [...room.messages].reverse().find((m) => m.kind === "chat" && m.tag !== "opening" &&
      m.from.agent === "human" && !this.isAnswered(room, m) && !p.declinedAsks?.includes(m.id) && this.responderFor(room, m, p.id).mine);
    // hub notices ride the normal stream (settleRead retires them on delivery); only an author can be answered
    return human ?? this.addressedBy(room, p).find((m) => m.from.id !== "system");
  }

  attentionHint(room: Room, p: Participant): string | undefined {
    const ask = this.attentionFocus(room, p);
    if (!ask) return;
    return `${ask.from.agent === "human" ? "You are the one answering this human. " : ""}${this.shown(room, ask.from)} addressed you directly in #${ask.seq}. Reply with send_message reply_to="${ask.id}" or call pass to decline only this focused ask. ${this.focusExclusive(ask) ? "Other messages remain queued." : "The rest of your queue is delivered with it, after it."}`;
  }

  /** A missing vote is individually owed; one current-version electorate vote clears carried-vote freshness. */
  needsVote(room: Room, p: Participant, pr: Proposal): boolean {
    if (pr.status !== "open") return false;
    const members = this.electorate(room, pr).members;
    if (!members.some((v) => v.id === p.id)) return false;
    return !pr.votes[p.id] || (pr.version > 1 &&
      !members.some((v) => pr.votes[v.id] && (pr.votes[v.id].version ?? 1) === pr.version));
  }

  /** An addressed ask, owed vote/challenge, or terminal state wakes a held wait. Human messages only
   * wake their nominated responder: bystanders cannot see or act on an unanswered human message. */
  actionableNow(room: Room, p: Participant): boolean {
    if (room.state === "closed" || room.state === "concluded") return true;
    if (this.attentionFocus(room, p)) return true;
    if (this.addressedBy(room, p).length) return true;
    const open = [...room.proposals.values()].find((pr) => pr.status === "open");
    if (!open) return false;
    return this.needsVote(room, p, open) || this.owesChallenge(room, open, p);
  }

  /** The open proposal still needs a challenge and this seat could give it (this room's waits and other rooms' other_rooms). */
  owesChallenge(room: Room, open: Proposal, p: Participant): boolean {
    return this.challengeRequired(room) && !open.challenges.some((c) => c.blocking !== false) && open.by.id !== p.id;
  }

  private resolvesAddress(room: Room, p: Participant, content: string, replyTo?: string): boolean {
    const focus = this.attentionFocus(room, p);
    if (replyTo && (focus?.id === replyTo || this.addressedBy(room, p).some((m) => m.id === replyTo))) return true;
    return this.addressedBy(room, p).some((m) => this.mentionsIn(room, content).includes(m.from.id));
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

  boardEntryExpired(room: Room, key: string, entry: BoardEntry, at = Date.now()): boolean { return board.boardEntryExpired(room, key, entry, at); }
  recordBoardManifest(roomName: string, envelope: { board_keys?: string[]; board_delta?: { keys: string[]; tombstones: string[] } }): void { board.recordBoardManifest(this, roomName, envelope); }
  static readonly BOARD_KEY = board.BOARD_KEY;

  /**
   * Seats expected to draft: voters other than the verifier. Independent attempts only help if they
   * stay independent, and a room whose seats share one draft never produces the disagreement that
   * would expose a common slip (tasks/bench-printf-format/ADMISSION.md: one writer, two spot-checkers).
   */
  drafters(room: Room): Participant[] {
    return this.voters(room).filter((p) => p.role !== "verifier");
  }

  /** Pure: every current drafter has a draft/* entry of their own (a drafter who left no longer counts). */
  /** @internal */ draftsComplete(room: Room): boolean {
    const authors = new Set([...room.board].filter(([k]) => k.startsWith("draft/")).map(([, e]) => e.by));
    const drafters = this.drafters(room);
    return drafters.length > 0 && drafters.every((d) => authors.has(d.name));
  }

  /**
   * Pure: the reveal deadline has passed. Like openings, one seat that never drafts (a reviewer, a researcher,
   * a dead session) must not keep every other draft sealed; in a 14-drafter room "all" is rarely reached.
   */
  /** @internal */ draftsDue(room: Room, now = Date.now()): boolean {
    return !!room.draftsOpenedAt && Hub.DRAFT_REVEAL_MS > 0 && now >= Date.parse(room.draftsOpenedAt) + Hub.DRAFT_REVEAL_MS;
  }

  /** The first draft starts the deadline clock; later drafts and edits do not push it back. */
  /** @internal */ openDrafts(room: Room): void {
    if (room.draftsOpenedAt || room.draftsRevealed) return;
    room.draftsOpenedAt = new Date().toISOString();
    this.persist({ type: "drafts_opened", room: room.name, at: room.draftsOpenedAt });
    this.armDraftsDeadline(room);
  }

  private armDraftsDeadline(room: Room): void {
    if (room.draftsTimer) clearTimeout(room.draftsTimer);
    room.draftsTimer = undefined;
    if (!room.draftsOpenedAt || room.draftsRevealed || Hub.DRAFT_REVEAL_MS <= 0) return;
    const ms = Math.max(0, Date.parse(room.draftsOpenedAt) + Hub.DRAFT_REVEAL_MS - Date.now());
    if (!Number.isFinite(ms)) return;
    room.draftsTimer = setTimeout(() => {
      room.draftsTimer = undefined;
      if (room.state === "concluded" || room.state === "closed") return;
      this.latchDrafts(room);
      this.armDraftsDeadline(room);
    }, Math.min(ms, 2_147_483_647));
    room.draftsTimer.unref();
  }

  /** Latch the reveal (all drafters in, or the deadline passed), persist it (replayed seats are inactive, so it cannot be re-derived), and announce it. */
  /** @internal */ latchDrafts(room: Room): void {
    if (room.draftsRevealed) return;
    const complete = this.draftsComplete(room);
    if (!complete && !this.draftsDue(room)) return;
    room.draftsRevealed = true;
    if (room.draftsTimer) clearTimeout(room.draftsTimer);
    room.draftsTimer = undefined;
    this.persist({ type: "drafts_revealed", room: room.name });
    const drafts = [...room.board].filter(([k]) => k.startsWith("draft/"));
    const keys = drafts.map(([k]) => k);
    const authors = new Set(drafts.map(([, e]) => e.by));
    const missing = this.drafters(room).filter((d) => !authors.has(d.name)).map((d) => d.name);
    const why = complete
      ? `Every drafter (${this.drafters(room).map((d) => d.name).join(", ")}) has a draft`
      : `The ${Math.round(Hub.DRAFT_REVEAL_MS / 60000)} min draft deadline passed (no draft from ${missing.join(", ")})`;
    this.post(room, "system", undefined, `[SYSTEM] ${why}, so draft/* is now readable by all: ${keys.join(", ")}. Compare them and settle each disagreement from the brief, not by counting who agrees.`);
  }

  /** "k of n drafters; waiting on X, Y": who still owes a draft, without naming any sealed key. */
  /** @internal */ draftProgress(room: Room): string {
    const authors = new Set([...room.board].filter(([k]) => k.startsWith("draft/")).map(([, e]) => e.by));
    const drafters = this.drafters(room);
    const owed = drafters.filter((d) => !authors.has(d.name)).map((d) => d.name);
    return `${drafters.length - owed.length} of ${drafters.length} drafters; draft/* stays sealed until ${owed.join(", ") || "everyone"} ${owed.length === 1 ? "has" : "have"} one${this.draftsDeadlineNote(room)}`;
  }


  /** ", or until HH:MM:SS UTC (the draft deadline)" while a deadline is running. */
  private draftsDeadlineNote(room: Room): string {
    if (!room.draftsOpenedAt || Hub.DRAFT_REVEAL_MS <= 0) return "";
    return `, or until ${new Date(Date.parse(room.draftsOpenedAt) + Hub.DRAFT_REVEAL_MS).toISOString().slice(11, 19)} UTC (the draft deadline)`;
  }

  /** A draft/* entry is readable only by its author until every drafter has posted one or the deadline passes (the human dashboard always sees it). */
  draftSealed(room: Room, key: string, entry: BoardEntry, viewer?: string): boolean {
    return key.startsWith("draft/") && entry.by !== viewer && !room.draftsRevealed && !this.draftsComplete(room) && !this.draftsDue(room);
  }

  hold(room: Room): BoardEntry | undefined { return board.hold(room); }
  unacknowledged(room: Room): string[] { return board.unacknowledged(room); }
  static sessionsOf(ps: Participant[]): number { return board.sessionsOf(ps); }
  static quorumNeeded(quorum: Quorum, electorateSize: number): number { return board.quorumNeeded(quorum, electorateSize); }
  static manifestBytes(envelope: Record<string, unknown>): number { return board.manifestBytes(envelope); }
  boardManifestTelemetry(room: Room): { waits: number; board_bytes_total: number; board_bytes_mean: number } { return board.boardManifestTelemetry(room); }

  boardManifest(roomName: string, pid: string, follow?: string[], forceFull = false): {
    board_keys?: string[]; board_delta?: { keys: string[]; tombstones: string[] }; board_reset?: boolean;
  } { return board.boardManifest(this, roomName, pid, follow, forceFull); }
  private applyBoard(room: Room, key: string, entry: BoardEntry | null) { return board.applyBoard(room, key, entry); }
  setBoard(roomName: string, pid: string, key: string, text: string, opts: BoardExpiryOptions & { ifAbsent?: boolean; ifByMe?: boolean; overwrite?: boolean } = {}): BoardEntry | null { return board.setBoard(this, roomName, pid, key, text, opts); }
  static claimTerms(key: string, text: string): Set<string> { return board.claimTerms(key, text); }
  claimOverlaps(roomName: string, pid: string, key: string): { key: string; by: string; shared_pct: number; shared: string[] }[] { return board.claimOverlaps(this, roomName, pid, key); }
  static claimOverlapScore(a: Set<string>, aKey: Set<string>, b: Set<string>, bKey: Set<string>) { return board.claimOverlapScore(a, aKey, b, bKey); }
  private activeReviewerFor(room: Room, authorName: string): Participant | undefined { return board.activeReviewerFor(room, authorName); }
  setBoardAs(roomName: string, byName: string, key: string, text: string): BoardEntry { return board.setBoardAs(this, roomName, byName, key, text); }
  postToRoom(fromRoom: string, pid: string, toRoom: string, key: string, text: string, ackRequired = false, opts: BoardExpiryOptions = {}): { key: string; entry: BoardEntry } { return board.postToRoom(this, fromRoom, pid, toRoom, key, text, ackRequired, opts); }

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
      if (c.command) {
        // A new text needs the counterexample rerun: an earlier passing run answered the old text only.
        if (c.status === "answered" && c.blocking !== false) {
          c.status = "open";
          reopened.push(this.shown(room, c.by));
        }
        continue;
      }
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
      throw new HubError("This room requires verification: before proposing, put the command you actually ran, its cwd/commit and its exit code on the board under verify/<area>. Someone else must then check it themselves (the same check failing at the parent commit and passing at yours) and write their own verify/* entry naming the proposal id.");
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

  /** Collapse whitespace so a rerun command matches however it was spaced. */
  static normCommand(c: string): string {
    return c.trim().replace(/\s+/g, " ");
  }

  /** One line for the conclusion notice: who verified, and whether it was fail-to-pass or the refactor exemption. */
  static verificationLine(v: ConclusionVerification): string {
    const kind = v.kind ? `, kind ${v.kind}` : "";
    return v.path === "refactor"
      ? `Verified by ${v.by} (${v.key}) on the refactor path${kind}: the check passed at ${v.base_commit} and at ${v.commit}; no check failed before the change.`
      : `Verified by ${v.by} (${v.key})${kind}: the check failed at ${v.base_commit} and passes at ${v.commit}.`;
  }

  /** The verify/* entry that answers an executable challenge: names the proposal, reruns the challenge's exact
   *  command, is dated after the challenge and the current text, and is not by the proposer's connection. It needs
   *  exit 0, unless it is a ruling: an active verifier/chair seat outside both the proposer's and the challenger's
   *  connections may rule the command itself invalid (e.g. `false`, or a probe the spec does not require) at any
   *  exit code, stating why in 20+ characters of prose below the head. Without that, a challenger's command would
   *  be a one-seat veto nobody but them could lift. */
  executionAnswer(room: Room, pr: Proposal, c: Challenge): { entry: BoardEntry; ruling: boolean } | undefined {
    if (!c.command) return undefined;
    const want = Hub.normCommand(c.command);
    const proposer = room.participants.get(pr.by.id);
    const challenger = room.participants.get(c.by.id);
    for (const [k, e] of room.board) {
      if (!k.startsWith("verify/") || k.endsWith(".partial")) continue;
      if (e.by === pr.by.name) continue;
      const author = [...room.participants.values()].find((x) => x.name === e.by);
      if (author && proposer && author.session && author.session === proposer.session) continue;
      if (e.updatedAt < c.ts || (pr.updatedAt && e.updatedAt < pr.updatedAt)) continue;
      const head = parseVerifyHead(e.text);
      if (!head || head.proposal !== pr.id || Hub.normCommand(head.command) !== want) continue;
      if (head.exit_code === 0) return { entry: e, ruling: false };
      const adjudicator = !!author?.active && (author.role === "verifier" || author.role === "chair" || author.agent === "human")
        && author.id !== c.by.id && !(author.session && challenger?.session && author.session === challenger.session);
      const nl = e.text.indexOf("\n");
      const reason = nl === -1 ? "" : e.text.slice(nl + 1).trim();
      if (adjudicator && reason.length >= 20) return { entry: e, ruling: true };
    }
    return undefined;
  }

  /** Answer open executable challenges whose counterexample now passes; announce each once. */
  private settleExecutableChallenges(room: Room, pr: Proposal) {
    for (const c of pr.challenges) {
      if (!c.command || (c.status ?? "open") !== "open" || c.blocking === false) continue;
      const ans = this.executionAnswer(room, pr, c);
      if (!ans) continue;
      c.status = "answered";
      this.persist({ type: "challenge_status", room: room.name, proposalId: pr.id, challengeId: c.id, status: "answered" });
      const cmd = Hub.normCommand(c.command).slice(0, 120);
      this.post(room, "system", undefined, ans.ruling
        ? `Executable challenge by ${this.shown(room, c.by)} on ${pr.id} answered by ruling: ${ans.entry.by} (adjudicator) ruled \`${cmd}\` not a valid counterexample for v${pr.version}; the reason is in their verify/* entry.`
        : `Executable challenge by ${this.shown(room, c.by)} on ${pr.id} answered: ${ans.entry.by}'s verify/* entry reran \`${cmd}\` with exit 0 against v${pr.version}.`);
    }
  }

  challenge(roomName: string, pid: string, proposalId: string, objection: string, blocking = true, command?: string, confirm = false): Proposal {
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
    const cmd = command?.trim() ? Hub.normCommand(command) : undefined;
    if (cmd !== undefined && (cmd.length < 3 || cmd.length > 1000)) throw new HubError("An executable challenge's `command` must be a runnable command line (3-1000 characters).");
    const cites = this.citedSpan(pr.text, objection);
    // An executable challenge is anchored to its command, not to a span of text: citing is optional.
    if (blocking && !cites && !cmd) {
      throw new HubError(
        `A blocking challenge must quote a matching proposal span (12+ characters) in double quotes. ` +
          `Copy the text from ${proposalId} v${pr.version}; the closest passage is: "${this.closest(pr.text, objection)}". ` +
          `Use blocking=false to record uncited dissent without holding the proposal.`,
      );
    }
    // Six seats filing the same objection within two minutes is one objection: point at the open one first.
    // Only blocking challenges hold the gate, so only they are deduplicated: non-blocking dissent is recorded as
    // written, a blocking challenge is never a duplicate of it, and a command is its own evidence.
    const same = blocking && cites && !cmd && !confirm
      ? this.openChallenges(pr).find((c) => c.cites &&
          (norm(c.cites).includes(norm(cites)) || norm(cites).includes(norm(c.cites))))
      : undefined;
    if (same) {
      throw new HubError(
        `${this.shown(room, same.by)} already challenged that clause ("${same.cites!.slice(0, 80)}${same.cites!.length > 80 ? "…" : ""}") in ${same.id}, which is still open. ` +
          `If your objection is the same, say so in chat or vote; if it adds something that challenge does not, file it again with confirm=true.`,
        { duplicate_of: same.id },
      );
    }
    this.surfaceCited(room, objection, "cited in a challenge");
    const challenge: Challenge = { id: shortId("ch"), by: { id: p.id, name: p.name }, objection, ts: now(), version: pr.version, status: "open", blocking, ...(cites ? { cites } : {}), ...(cmd ? { command: cmd } : {}) };
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
        (cmd ? `executable counterexample \`${cmd.slice(0, 160)}\`: rewording does not answer it; a verify/* entry from someone other than ${this.shown(room, pr.by)} rerunning exactly this command with exit_code 0 does, or a verifier/chair ruling it invalid with a reason; read the command before running it; ` : "") +
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
  /** @internal */ applyVote(pr: Proposal, pid: string, entry: Proposal["votes"][string]) {
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
    const anchored = challenges.filter((c) => c.cites && !c.command);
    const legacy = challenges.filter((c) => !c.cites && !c.command);
    const advice: string[] = [];
    const executable = challenges.filter((c) => c.command);
    if (executable.length) advice.push(`executable challenge(s) from ${executable.map((c) => this.shown(room, c.by)).join(", ")}: a verify/* entry from someone other than the proposer must rerun \`${Hub.normCommand(executable[0].command!).slice(0, 120)}\` with exit_code 0 after the current text, or they re-vote`);
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
    const active = this.electorate(room, pr).members;
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
    if (room.requireVerification && !this.verifiedBy(room, pr)) out.push(this.verifyHeadRefusal(room, pr));
    if (this.hold(room)) out.push(`hold by ${this.hold(room)!.by}`);
    if (!active.some((p) => pr.votes[p.id] && (pr.votes[p.id].version ?? 1) === pr.version) && pr.version > 1) out.push(`no vote cast on v${pr.version} yet (carried-over agrees alone cannot pass a new version)`);
    return out;
  }

  proposalView(room: Room, pr: Proposal, reveal = false, withText = true) {
    const active = this.electorate(room, pr).members;
    const nm = (x: { id: string; name: string }) => (reveal ? x.name : this.shown(room, x));
    const decided = pr.status === "accepted" && room.conclusion?.proposalId === pr.id ? room.conclusion : undefined;
    const summary = decided ? decided.electorate : this.electorateSummary(room, pr);
    const tally = decided?.tally ?? (summary ? { agree: summary.agree, disagree: summary.disagree, abstain: summary.abstain } : { agree: 0, disagree: 0, abstain: 0 });
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
      electorate: summary ?? null,
      // Dissent remains binding under the existing rules even when its author is not counted.
      outside_electorate_disagrees: this.standingDisagrees(pr).filter((d) => !active.some((p) => p.id === d.id)).map((d) => nm(d)),
      waiting_on: pr.status === "open" ? active.filter((p) => !pr.votes[p.id]).map((p) => nm(p)) : [],
      needs_challenge: needsChallenge,
      blocked_by: this.blockedBy(room, pr),
      challenges: pr.challenges.map((c) => ({ id: c.id, by: nm(c.by), objection: c.objection, status: c.status ?? "open", blocking: c.blocking !== false, version: c.version, ...(c.command ? { command: c.command } : {}) })),
      votes: Object.entries(pr.votes).map(([id, v]) => ({ name: nm({ id, name: v.name }), vote: v.vote, confidence: v.confidence, reason: v.reason, version: v.version, ...(v.version !== undefined && v.version !== pr.version ? { stale: `cast at v${v.version}` } : {}) })),
    };
  }

  /**
   * Per-participant delta of a proposal's challenges for wait_for_messages: a challenge's objection (and command)
   * is sent the first time this participant sees it and again whenever its status changes; otherwise only
   * {id, by, status, blocking, version, command?} plus objection_omitted (a command stays: it is what a verifier
   * must rerun verbatim). room_status still carries every objection in full.
   */
  challengesDelta<C extends { id?: string; status: string; objection?: string }>(p: Participant, challenges: C[]) {
    const seen = p.seenChallenges ?? {};
    const out = challenges.map((c) => {
      if (!c.id || seen[c.id] !== c.status) return c; // a legacy challenge without an id always ships in full
      const { objection: _o, ...rest } = c;
      return { ...rest, objection_omitted: "already sent to you at this status; room_status carries it" };
    });
    const ids = challenges.filter((c) => c.id).map((c) => [c.id!, c.status] as const);
    if (ids.length) p.seenChallenges = { ...seen, ...Object.fromEntries(ids) };
    return out;
  }

  /** Re-check whether a proposal has reached the room's quorum. */
  /**
   * A verify/* entry by a different agent (different connection), newer than the proposal text, whose first
   * line is a parseable VerifyHead naming this proposal with exit_code 0 and fail-to-pass evidence (or the
   * refactor path; failToPassShortfall). Content-blind free text (a "BLOCKED" or "PARTIAL" entry that never ran
   * a passing command) never counts, however it names the proposal.
   */
  verifiedBy(room: Room, pr: Proposal): BoardEntry | undefined {
    return this.verification(room, pr)?.entry;
  }

  /** The entry verifiedBy() finds, with its key and parsed head. */
  verification(room: Room, pr: Proposal): { key: string; entry: BoardEntry; head: VerifyHead } | undefined {
    if (!pr.updatedAt) return undefined; // Legacy text timestamps are unknown, not fresh.
    const reviewer = this.activeReviewerFor(room, pr.by.name);
    for (const [key, entry] of room.board) {
      const r = this.verifyEntryVerdict(room, pr, key, entry, reviewer);
      if (r.head && !r.why) return { key, entry, head: r.head };
    }
    return undefined;
  }

  /**
   * The gate's rule for one board entry, in one place so the refusal can never drift from the check: `why` is
   * what stops it counting, in words that say what to write instead; `named` is whether the entry is about this
   * proposal at all (only those are worth naming back in a refusal).
   */
  private verifyEntryVerdict(room: Room, pr: Proposal, key: string, e: BoardEntry, reviewer: Participant | undefined): { head?: VerifyHead; why?: string; named: boolean } {
    if (!key.startsWith("verify/") || key.endsWith(".partial")) return { why: "not a verify/* entry", named: false };
    const read = readVerifyHead(e.text);
    const head = "head" in read ? read.head : undefined;
    const named = head ? head.proposal === pr.id : e.text.includes(pr.id);
    const no = (why: string) => ({ head, why, named });
    if (e.by === pr.by.name) return { ...no("written by the proposer"), named: false }; // the author's own run, required before propose
    const proposer = room.participants.get(pr.by.id);
    const author = [...room.participants.values()].find((x) => x.name === e.by);
    if (author && proposer && author.session && author.session === proposer.session) return no(`it shares ${this.shown(room, pr.by)}'s connection, so it is the proposer's own check`); // same process, two names
    // An active assigned reviewer (Hub.assignReviewer, set at claim/<area> creation; the caller passes
    // activeReviewerFor) is preferred: only their entry counts while they are still in the room. Once they
    // leave, any qualifying non-author entry counts again, so an absent reviewer never deadlocks the room.
    if (reviewer && e.by !== reviewer.name) return no(`the assigned reviewer, ${this.shown(room, reviewer)}, is still in the room and only their entry counts`);
    if (!pr.updatedAt || e.updatedAt < pr.updatedAt) return no(`it was written before v${pr.version}'s text: check v${pr.version} and write it again`);
    if (!head) return no("error" in read ? read.error : "its first line is not a JSON verify head");
    if (head.proposal !== pr.id) return { head, why: `it names ${head.proposal}`, named: false };
    if (head.exit_code !== 0) return no(`it reports exit_code ${head.exit_code} at the proposal's commit, and counts only once the check passes there`);
    const short = failToPassShortfall(head);
    return short ? no(short) : { head, named };
  }

  /** What exactly to write, named precisely enough that "an entry exists but doesn't count" is never a mystery. */
  private verifyHeadRefusal(room: Room, pr: Proposal): string {
    const reviewer = this.activeReviewerFor(room, pr.by.name);
    const who = reviewer
      ? `your assigned reviewer, ${this.shown(room, reviewer)} (falls back to anyone else once they leave the room),`
      : `someone other than ${this.shown(room, pr.by)} (on a different connection)`;
    // Name back the latest entries that are about this proposal but do not count, and why (at most two: blocked_by is re-sent every wait).
    const misses = [...room.board.entries()]
      .map(([key, e]) => ({ key, e, v: this.verifyEntryVerdict(room, pr, key, e, reviewer) }))
      .filter((x) => x.v.named && x.v.why)
      .sort((a, b) => b.e.updatedAt.localeCompare(a.e.updatedAt))
      .slice(0, 2)
      .map((x) => `; ${x.e.by}'s ${x.key} does not count: ${x.v.why}`);
    return `a verify/* board entry from ${who} whose first line is JSON ${VERIFY_HEAD_EXAMPLE.replace("<PROPOSAL_ID>", pr.id)} — ${VERIFY_HEAD_RULE}${misses.join("")}`;
  }

  /** @internal */ evaluate(room: Room, pr: Proposal) {
    if (pr.status !== "open" || room.state === "concluded" || room.state === "closed") return;
    this.settleExecutableChallenges(room, pr);
    const all = this.voters(room);
    const electorate = this.electorate(room, pr);
    const active = electorate.members;
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
    if (room.expectedParticipants !== 1 && electorate.distinctSessions < 2) {
      if (everyoneVoted && agree === active.length) {
        stuck(`${pr.id} v${pr.version} has the agreement of everyone still present (${agree}) but only ${active.length} voter(s) remain and a room of one cannot conclude: nobody here can conclude it. Recruit (request_agent), or a human closes the room.`);
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
      const needed = Hub.quorumNeeded(room.quorum, active.length);
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
    // A replacement cannot merely supply the floor for an already sufficient majority.
    if (accepted && electorate.replacements.some((p) => !pr.votes[p.id])) return;
    if (accepted && pr.version > 1 && !active.some((p) => pr.votes[p.id] && (pr.votes[p.id].version ?? 1) === pr.version)) {
      stuck(`${pr.id} v${pr.version} carries only agrees cast on earlier versions; a version cannot pass until someone votes on its current text. Re-vote (quote a clause of v${pr.version}) to conclude.`);
      return;
    }
    if (accepted && this.hold(room)) {
      stuck(`${pr.id} has the votes but the room is on hold by ${this.hold(room)!.by}: ${this.hold(room)!.text.slice(0, 120)}. It passes when the hold is cleared.`);
      return;
    }
    if (accepted && room.requireVerification && !this.verifiedBy(room, pr)) {
      stuck(`${pr.id} has the votes but no verification: ${this.verifyHeadRefusal(room, pr)}, dated after the current text.`);
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

  /** A breakout is opened from a room the opener is an active member of, by the same connection, and never from a closed one. */
  private checkBreakout(child: string, parent: string, session?: string): void {
    const from = this.rooms.get(parent);
    if (!from) throw new HubError(`parent room "${parent}" does not exist. Open a breakout from a room you are in.`);
    if (from.state === "concluded" || from.state === "closed") throw new HubError(`parent room "${parent}" is ${from.state}; nothing to carry a breakout's conclusion back to.`);
    if (child === parent) throw new HubError("A room cannot be its own breakout.");
    if (!session || ![...from.participants.values()].some((p) => p.active && p.session === session)) {
      throw new HubError(`Only an active member of "${parent}" can open a breakout from it: join_room it first.`, undefined, "auth");
    }
  }

  /** One line in the parent: the breakout exists, how to work in it, and where its conclusion will land. */
  private announceBreakout(child: Room, opener: string): void {
    const parent = this.rooms.get(child.parent!);
    if (!parent) return;
    this.post(parent, "system", undefined,
      `${opener} opened breakout room ${child.name}${child.topic ? `: ${child.topic.slice(0, 200)}${child.topic.length > 200 ? "…" : ""}` : ""}. ` +
      `Work there with join_room(room="${child.name}"); you keep your seat here, and asks or votes owed here still wake your wait there. ` +
      `When it concludes, its conclusion lands here as inbox/${child.name}/conclusion.`);
  }

  /** Breakouts of a room (rooms whose parent is it): name, state and active member names. */
  breakouts(room: Room): { room: string; state: RoomState; members: string[] }[] {
    return [...this.rooms.values()].filter((r) => r.parent === room.name && !r.archived)
      .map((r) => ({ room: r.name, state: r.state, members: this.activeParticipants(r).map((p) => this.shown(r, p)) }));
  }

  /**
   * What this connection owes in its OTHER rooms (a seat in a breakout keeps its parent seat, and the reverse): asks
   * addressed to it, a vote or challenge owed, or a conclusion it has not been sent. Only rooms with something to act on.
   */
  elsewhere(session: string, except: string): { room: string; addressed?: number; vote_owed?: string; challenge_owed?: string; concluded?: true }[] {
    const out: { room: string; addressed?: number; vote_owed?: string; challenge_owed?: string; concluded?: true }[] = [];
    for (const room of this.rooms.values()) {
      if (room.name === except || room.state === "closed") continue;
      for (const p of room.participants.values()) {
        if (!p.active || p.session !== session) continue;
        if (room.state === "concluded") { if (!p.seenConclusion) out.push({ room: room.name, concluded: true }); continue; }
        const addressed = this.addressedBy(room, p).length + (this.attentionFocus(room, p) && !this.addressedBy(room, p).length ? 1 : 0);
        const open = [...room.proposals.values()].find((pr) => pr.status === "open");
        const vote = open && this.needsVote(room, p, open) ? open.id : undefined;
        const challenge = open && this.owesChallenge(room, open, p) ? open.id : undefined;
        if (addressed || vote || challenge) out.push({ room: room.name, ...(addressed ? { addressed } : {}), ...(vote ? { vote_owed: vote } : {}), ...(challenge ? { challenge_owed: challenge } : {}) });
      }
    }
    return out;
  }

  /** How many open rooms this connection holds an active seat in. */
  sessionRoomCount(session: string): number {
    return [...this.rooms.values()].filter((r) => r.state !== "closed" && [...r.participants.values()].some((p) => p.active && p.session === session)).length;
  }

  /**
   * A concluded breakout's decision, written onto its parent's board (no seat has to post_to_room it by hand). A parent
   * that already concluded or closed is left alone: its board is final. Objections go before the text, and a text past
   * the board cap is cut, never silently: where the whole of it lives (room_status on the child) leads the entry.
   */
  private carryConclusion(room: Room): void {
    const parent = room.parent ? this.rooms.get(room.parent) : undefined;
    if (!parent || !room.conclusion || parent.state === "concluded" || parent.state === "closed") return;
    const c = room.conclusion;
    const key = `inbox/${room.name}/conclusion`;
    // where the whole of it lives leads the entry, so no cut can drop it
    const head = `Breakout ${room.name} concluded on ${c.proposalId} v${c.version ?? 1} (${c.tally?.agree ?? "?"}/${c.electorate?.electorate ?? "?"} agree; whole text: room_status room="${room.name}").\n`;
    const body = (c.unresolved_objections?.length ? `Unresolved objections: ${c.unresolved_objections.map((u) => `${u.by}: ${u.objection}`).join(" | ")}\n` : "") + c.text;
    const full = head + body;
    const marker = `\n[cut at the board cap: ${full.length} chars in all; whole text: room_status room="${room.name}"]`;
    const text = full.length <= 8000 ? full : full.slice(0, 8000 - marker.length) + marker;
    const entry: BoardEntry = { text, by: "system", updatedAt: now() };
    board.applyBoard(parent, key, entry);
    this.persist({ type: "board", room: parent.name, key, entry });
    this.post(parent, "system", undefined, `[BOARD] breakout ${room.name} concluded; its conclusion is on this board as ${key} (board_get).`);
  }

  private conclude(room: Room, pr: Proposal) {
    for (const m of room.messages) if (m.quiet) this.surfaceThread(room, this.threadRoot(room, m).id, "room concluded");
    pr.status = "accepted";
    for (const other of room.proposals.values()) if (other.id !== pr.id && other.status === "open") other.status = "superseded";
    const unresolved = pr.challenges.filter((c) => (c.status ?? "open") === "open").map((c) => ({ by: this.shown(room, c.by), objection: c.objection }));
    for (const c of pr.challenges) if ((c.status ?? "open") === "open") c.status = "overruled";
    const electorate = this.electorateSummary(room, pr);
    const tally = { agree: electorate.agree, disagree: electorate.disagree, abstain: electorate.abstain };
    const v = room.requireVerification ? this.verification(room, pr) : undefined;
    const verification: ConclusionVerification | undefined = v && {
      key: v.key, by: v.entry.by, path: v.head.refactor === true ? "refactor" : "fail_to_pass",
      base_commit: v.head.base_commit!, commit: v.head.commit!, ...(v.head.kind ? { kind: v.head.kind } : {}),
    };
    room.conclusion = { text: pr.text, proposalId: pr.id, decidedAt: now(), version: pr.version, tally, electorate, unresolved_objections: unresolved, ...(verification ? { verification } : {}) };
    this.persist({ type: "proposal", proposal: pr });
    this.setState(room, "concluded");
    if (room.nudgeTimer) clearTimeout(room.nudgeTimer);
    this.post(
      room,
      "conclusion",
      undefined,
      `CONSENSUS REACHED on ${pr.id} v${pr.version} (${electorate.agree}/${electorate.electorate} agree; ${electorate.excluded_leavers} leavers-before-close excluded; quorum=${room.quorum}; ${pr.text.length} chars, text in room_status/conclusion)` +
        (unresolved.length ? `\nUnresolved objections, overruled: ${unresolved.map((u) => `${u.by}: "${u.objection.slice(0, 300)}${u.objection.length > 300 ? "…" : ""}"`).join(" | ")}` : "") +
        (verification ? `\n${Hub.verificationLine(verification)}` : ""),
      { proposalId: pr.id },
    );
    this.releaseClaims(room, "Room concluded");
    this.carryConclusion(room);
  }

  /**
   * Once a room concludes or closes nobody can join a team or take over an area in it, so a claim/*'s ownership
   * lock no longer serves any purpose. Announced here, in one system line, so seats are never asked to write a
   * claim release or a handoff/* just to leave (leaveRefusal, leavingWouldBlock). The entries themselves are left
   * on the board untouched, not deleted: a seat's note/status/team JSON is sometimes the only record of what it
   * did (some write that directly into claim/* instead of a separate handoff/*), so it must stay readable via
   * board_get exactly like verify/* and handoff/* are.
   */
  private releaseClaims(room: Room, why: string): void {
    const claims = [...room.board.keys()].filter((k) => k.startsWith("claim/"));
    if (!claims.length) return;
    this.post(room, "system", undefined, `${why}: released ${claims.length} claim/* entr${claims.length === 1 ? "y" : "ies"} (${claims.join(", ")}) — nobody needs to hand off in a room nobody can act in; their content stays on the board (board_get).`);
  }

  private setState(room: Room, state: RoomState) {
    room.state = state;
    this.persist({ type: "state", room: room.name, state, conclusion: room.conclusion });
    this.onRoomState?.(room.name, state);
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
    this.releaseClaims(room, "Room closed");
    return room;
  }

  /**
   * Hide a room from listings without deleting anything: the transcript stays on disk and GET /rooms/:room still
   * answers. An open room is closed first (nobody is in it to object; if someone were, it would not be dead).
   */
  archiveRoom(roomName: string, by: string, archived = true): Room {
    const room = this.getRoom(roomName);
    if (archived && (room.state === "open" || room.state === "stalled") && this.activeParticipants(room).length === 0) this.closeRoom(roomName, by, "archived");
    if (archived && (room.state === "open" || room.state === "stalled")) throw new HubError(`Room "${roomName}" still has participants; close it first.`);
    room.archived = archived;
    this.persist({ type: "archive", room: roomName, archived, by, ts: now() });
    return room;
  }

  /** A dead room has nobody in it and was not created in the last ten minutes (a launcher pre-creates rooms before seats join). */
  isDead(room: Room): boolean {
    return this.activeParticipants(room).length === 0 && Date.now() - Date.parse(room.createdAt) > 10 * 60_000;
  }

  archiveDead(by: string): string[] {
    const done: string[] = [];
    for (const r of [...this.rooms.values()]) if (!r.archived && this.isDead(r)) { this.archiveRoom(r.name, by); done.push(r.name); }
    return done;
  }

  // ---------- liveness (src/hub/liveness.ts) ----------

  /** @internal */ readonly seats = new liveness.Seats(this);
  heartbeat(roomName: string, pid: string, info: liveness.Beat): void { this.seats.heartbeat(roomName, pid, info); }
  bindSeat(seatKey: string, session: string, worktree?: string): void { this.seats.bind(seatKey, session, worktree); }
  /** Out of the room but not a vacancy: it rejoins on its next hub call (liveness.away). */
  away(p: Participant) { return liveness.away(p); }
  workspaceOf(p: Participant): { branch?: string; worktree: string } | undefined { return this.seats.workspaceOf(p); }
  heartbeatSeat(seatKey: string, info: liveness.Beat): number { return this.seats.heartbeatSeat(seatKey, info); }
  seatParticipants(seatKey: string): { room: Room; p: Participant }[] { return this.seats.participants(seatKey); }
  activity(roomName: string, name: string) { return this.seats.activity(roomName, name); }

  // ---------- kick vote / removal ----------

  /** A removed seat learns it on its very next call for that room, reads included (server guard). */
  refuseKicked(roomName: string, pid: string): void {
    const room = this.rooms.get(roomName);
    const p = room?.participants.get(pid);
    if (room && p?.kicked) throw new HubError(Hub.kickedMessage(room, p), undefined, "auth");
  }

  kickNeeded(room: Room, target: Participant): number { return kick.kickNeeded(this, room, target); }
  static dashboardHuman(p: Participant): boolean { return kick.dashboardHuman(p); }
  kickVote(roomName: string, pid: string, target: string, vote: "kick" | "keep" = "kick", reason?: string): KickVote { return kick.kickVote(this, roomName, pid, target, vote, reason); }
  removeParticipant(roomName: string, target: string, by: string, reason: string): Participant { return kick.removeParticipant(this, roomName, target, by, reason); }

  /** How long a departed owner's claim/* stays reserved for its registered successor before anyone may take it over. */
  static STALE_CLAIM_MS = Number(process.env.CHATROOM_STALE_CLAIM_MS ?? 10 * 60_000);

  /** The departed owner of a claim/* entry, if it has one: the most recent participant under that name, when inactive. */
  private departedClaimOwner(room: Room, e: BoardEntry): Participant | undefined {
    if (e.by === "system" || !e.text.trim()) return undefined;
    const named = [...room.participants.values()].filter((x) => x.name === e.by);
    if (!named.length || named.some((x) => x.active)) return undefined;
    return named.reduce((a, b) => (Date.parse(this.lastSeen(b)) > Date.parse(this.lastSeen(a)) ? b : a));
  }

  /** Why `writer` may take over a departed owner's claim/*: its registered successor (at once), or anyone once the owner
   * has been gone Hub.STALE_CLAIM_MS. Null while the owner is live or the stale window has not passed. The claim stays
   * owned until then, so respawn still sees it as orphaned (src/respawn.ts). */
  /** @internal */ claimTakeover(room: Room, e: BoardEntry, writer: Participant): { reason: "successor" | "stale"; owner: Participant } | null {
    const owner = this.departedClaimOwner(room, e);
    if (!owner) return null;
    for (let next = owner.replacedBy; next; next = room.participants.get(next)?.replacedBy) if (next === writer.id) return { reason: "successor", owner };
    return Date.now() - Date.parse(this.lastSeen(owner)) >= Hub.STALE_CLAIM_MS ? { reason: "stale", owner } : null;
  }

  /** claim/* entries whose owner has left, for room_status: who may take each one over now. */
  staleClaims(room: Room, reveal = false) {
    const out: { key: string; owner: string; gone_since: string; open_to: "successor" | "anyone" }[] = [];
    for (const [k, e] of room.board) {
      if (!k.startsWith("claim/") || Hub.claimReleased(e)) continue;
      const owner = this.departedClaimOwner(room, e);
      if (!owner) continue;
      const since = this.lastSeen(owner);
      out.push({ key: k, owner: reveal || !room.anonymous ? e.by : this.shown(room, owner), gone_since: since, open_to: Date.now() - Date.parse(since) >= Hub.STALE_CLAIM_MS ? "anyone" : "successor" });
    }
    return out;
  }

  static claimReleased(e: BoardEntry): boolean { return board.claimReleased(e); }
  kickView(room: Room, kv: KickVote, reveal = false) { return kick.kickView(this, room, kv, reveal); }

  /** Latest of the last hub call and the last heartbeat. */
  lastSeen(p: Participant): string {
    return p.working && Date.parse(p.working.at) > Date.parse(p.lastActiveAt) ? p.working.at : p.lastActiveAt;
  }

  sweepIdle(idleMs: number, connected?: Set<string>): string[] {
    const swept: string[] = [];
    const cutoff = Date.now() - idleMs;
    for (const room of this.rooms.values()) {
      if (room.state === "concluded" || room.state === "closed") continue;
      for (const p of room.participants.values()) {
        if (p.session && connected?.has(p.session)) continue;
        if (p.active && p.agent !== "human" && Date.parse(this.lastSeen(p)) < cutoff) {
          p.active = false;
          this.persist({ type: "leave", room: room.name, p });
          this.post(room, "system", undefined, `${this.shown(room, p)} went quiet for ${Math.round(idleMs / 60000)} min and was marked as left.`);
          for (const pr of room.proposals.values()) if (pr.status === "open") this.evaluate(room, pr);
          swept.push(p.name);
          this.latchDrafts(room);
        }
      }
      kick.reevaluateOpenKicks(this, room);
    }
    return swept;
  }
  // ---------- persistence (append-only JSONL per room) ----------

  private replyMetricObservationEnd(roomName: string): string | undefined { return persistence.replyMetricObservationEnd(this, roomName); }
  /** @internal */ persist(ev: Event) { return persistence.persist(this, ev); }
  private replay() { return persistence.replay(this); }
}
