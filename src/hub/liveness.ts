/** Seat liveness: launcher seat keys bound to MCP connections, heartbeats, the steps a seat ran, and which departed seats
 * are only away. The Hub keeps a one-line delegator for each member called from outside. */
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { spawnSync } from "node:child_process";
import type { Hub } from "../hub.js";
import { HubError } from "./types.js";
import type { Participant, Room } from "./types.js";
import { now } from "./internal.js";
import { SUSPECTED_DEAD_MS } from "./kick.js";
import { noteWork } from "./idle.js";
import { countWork, workClass } from "./work.js";
import { priorArt } from "../telemetry/prior-art.js";

/** `hub`: the beat is a chatroom tool call the hub served itself, not local work the seat's process reported. */
export type Beat = { tool: string; step?: number; detail?: string; hub?: boolean };

/** Where a room's remote clones landed, so a later run inside one is tagged as running outside code. In memory only: a run
 * after a hub restart of a clone made before it goes untagged. */
const roomClones = new WeakMap<Room, Set<string>>();
const clonesOf = (room: Room) => { let s = roomClones.get(room); if (!s) roomClones.set(room, (s = new Set())); return s; };

/** sha256 of a launcher seat key, persisted on the participant (seatKeyHash) so a beat after a hub restart still finds its seat. */
export function seatHash(seatKey: string): string { return createHash("sha256").update(seatKey).digest("hex"); }

/** A beat no live connection claims (the hub restarted, or the MCP session dropped): the process is still running, so record
 * it on the inactive seats that key joined as. They stay inactive; room_status shows them as "away", not dead. */
function beatAwaySeats(hub: Hub, seatKey: string, record: (room: Room, p: Participant) => void): void {
  const hash = seatHash(seatKey);
  for (const room of hub.rooms.values()) {
    if (room.state === "concluded" || room.state === "closed") continue;
    for (const p of room.participants.values()) if (!p.active && p.seatKeyHash === hash) record(room, p);
  }
}

/**
 * A seat that is out of the room but not a vacancy: it rejoins on its next hub call. Either its launcher's heartbeat
 * (by seat key) arrived after it went inactive, or a hub restart restored it inactive while it was in the room and it
 * has been silent for less than SUSPECTED_DEAD_MS since (a seat inside one long command sends nothing until the
 * command ends; the old process's beats were not kept). The same 10 minutes the idle sweep gives a live seat.
 * A seat that called leave_room itself, was kicked or already has a successor is never away. request_agent(replacing=)
 * refuses an away seat (src/index.ts), so a quiet live seat is not duplicated (swarm-181144-uxtr, 6-astra-3).
 */
export function away(p: Participant): { age_seconds: number; evidence: string } | undefined {
  if (p.active || p.kicked || p.replacedBy || p.pendingReplacementName) return undefined;
  if (p.leaveReason && !p.leaveReason.startsWith("MCP session closed")) return undefined;
  const ageOf = (at: string) => Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 1000));
  if (p.working && Date.parse(p.working.at) > Date.parse(p.lastActiveAt) && Date.now() - Date.parse(p.working.at) < SUSPECTED_DEAD_MS) {
    const age = ageOf(p.working.at);
    return { age_seconds: age, evidence: `its process is still running: it heartbeated ${age}s ago (step ${p.working.step}, ${p.working.tool})` };
  }
  if (p.restoredAt && Date.now() - Date.parse(p.restoredAt) < SUSPECTED_DEAD_MS) {
    const age = ageOf(p.restoredAt);
    return { age_seconds: age, evidence: `it was in the room when the hub restarted ${age}s ago and has not been silent long enough to read as dead (a seat inside a long command rejoins when the command ends)` };
  }
  return undefined;
}

/**
 * The seat a reconnecting connection held in this room, if its launcher's seat key says so. After a hub restart (or a
 * dropped MCP session) the client opens a new session, as the protocol requires, and the hub no longer knows who it is;
 * in a drill both seats' first call was refused and they had to work out that join_room with the old id was the way
 * back (swarm-003601-tky5, evidence/reconnect-drill). The key is the proof, as for heartbeats: only the seat's process
 * and its launcher hold it. A seat that left on purpose, was kicked or has a successor is not brought back, and nobody
 * is brought back into a closed room.
 */
export function reseatable(room: Room, hash: string | undefined, wantId?: string): Participant | undefined {
  // closing a room marks every seat inactive with no leave reason, which reads like a dropped session: nobody is put back
  // in a room nobody can act in (a concluded room keeps its seats, they read the conclusion there)
  if (!hash || room.state === "closed") return undefined;
  // an active seat with this key is the same process on an older connection the hub has not yet seen close
  const mine = [...room.participants.values()].filter((p) => p.seatKeyHash === hash && !p.kicked && !p.replacedBy && !p.pendingReplacementName &&
    (p.active || !p.leaveReason || p.leaveReason.startsWith("MCP session closed")) && (!wantId || p.id === wantId));
  return mine.length === 1 ? mine[0] : undefined;
}

export class Seats {
  constructor(private readonly hub: Hub) {}

  /**
   * Seat keys: a launcher gives each seat process a random key, puts it in the seat's MCP URL (?seat=) and in its env
   * (CHATROOM_SEAT_KEY). The hub binds the key to the MCP connection it arrives on, so a process that cannot know its
   * participant ids (a claude -p tool hook, a launcher watching codex output) can still heartbeat as that connection,
   * and only as that connection (identity-is-the-connection). Ephemeral, like the heartbeats themselves.
   */
  private seatSessions = new Map<string, string>();
  /** session -> the worktree its launcher started the seat in (from the MCP URL, never from the seat's own words) */
  private sessionWorktrees = new Map<string, string>();
  /** session -> sha256 of its seat key, stamped on the participants it joins (seatKeyHash) */
  private sessionSeatHashes = new Map<string, string>();

  bind(seatKey: string, session: string, worktree?: string): void {
    if (seatKey && session) this.seatSessions.set(seatKey, session);
    if (seatKey && session) this.sessionSeatHashes.set(session, seatHash(seatKey));
    if (session && worktree) this.sessionWorktrees.set(session, worktree);
  }

  hashOf(session: string | undefined): string | undefined { return session ? this.sessionSeatHashes.get(session) : undefined; }

  /** Every participant, in any room and state, that a seat key's connection ever held: a seat stays a seat after it leaves. */
  everHeld(seatKey: string): { room: Room; p: Participant }[] {
    const session = this.seatSessions.get(seatKey);
    if (!session) return [];
    return [...this.hub.rooms.values()].flatMap((room) => [...room.participants.values()].filter((p) => p.session === session).map((p) => ({ room, p })));
  }

  /**
   * A seat's own liveness signal (POST /rooms/:room/heartbeat from src/seat.ts on every step): what it is doing and
   * when. Local tools never reach the hub, so without this a builder on step 71 of a build looked like "1 msg, 12m ago"
   * and nobody could tell it from a dead seat. Not persisted: it is about the process, not the room's history.
   */
  heartbeat(roomName: string, pid: string, info: Beat): void {
    const room = this.hub.getRoom(roomName);
    this.recordWork(room, this.hub.requireParticipant(room, pid), info);
  }

  /** A step with no count of its own (a hook, an MCP call) is the seat's next step. */
  private recordWork(room: Room, p: Participant, info: Beat): void {
    const cls = info.hub ? undefined : workClass(info.tool, info.detail);
    const counted = cls ? countWork(p, cls, info.detail) : undefined;
    if (cls && counted) noteWork(room);
    // tagged from the whole detail the seat sent, before the target is cut to 120 characters for display
    const prior = cls && counted ? priorArt(cls, String(info.tool), String(info.detail ?? ""), clonesOf(room)) : undefined;
    if (cls && counted) this.hub.persist({ type: "work", room: room.name, pid: p.id, cls, tool: String(info.tool).slice(0, 40), target: counted.target, ...(counted.key !== counted.target ? { key: counted.key } : {}), ...(prior ? { prior } : {}), ts: now() });
    const detail = String(info.detail ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    const step = Number(info.step) || (p.working?.step ?? 0) + 1;
    p.working = { tool: String(info.tool).slice(0, 40), step, at: now(), ...(detail ? { detail } : {}) };
    (p.activity ??= []).push({ tool: p.working.tool, step: p.working.step, at: p.working.at, detail });
    if (p.activity.length > 60) p.activity.splice(0, p.activity.length - 60);
  }

  /** Where a seat's work in progress lives: its bound worktree and the branch checked out there now. */
  workspaceOf(p: Participant): { branch?: string; worktree: string } | undefined {
    const worktree = p.session ? this.sessionWorktrees.get(p.session) : undefined;
    if (!worktree) return undefined;
    const r = spawnSync("git", ["-C", worktree, "branch", "--show-current"], { encoding: "utf8", timeout: 5_000 });
    const branch = r.status === 0 ? r.stdout.trim() : "";
    return branch ? { branch, worktree } : { worktree };
  }

  /** Heartbeat every active participant the seat's connection holds, in rooms still open. Returns how many were marked. */
  heartbeatSeat(seatKey: string, info: Beat): number {
    const seats = this.participants(seatKey);
    for (const { room, p } of seats) this.recordWork(room, p, info);
    // a local command naming another room's HTTP address or log file reads that room from outside (curl, WebFetch, cat)
    const session = this.seatSessions.get(seatKey);
    if (session && !info.hub && info.detail) {
      const named = (re: RegExp) => new Set([...info.detail!.matchAll(re)].map((x) => x[1]));
      for (const m of new Set([...info.detail.matchAll(/\/rooms\/([A-Za-z0-9._~%-]+)(\$)?/g)].map((x) => x[1] + (x[2] ?? "")))) {
        // a name finished by a shell variable (`/rooms/<run>-$g` in a loop, dev room swarm-010735-tvdw) reads every
        // room that starts with what is written: counted as a pattern read of each, an upper bound for that command
        if (m.endsWith("$")) {
          for (const name of this.hub.rooms.keys()) if (name.startsWith(m.slice(0, -1)) && name.length > m.length - 1) this.hub.recordOutsideRead(name, session, "http_pattern", info.tool);
          continue;
        }
        let name = m;
        try { name = decodeURIComponent(m); } catch { /* not an encoded name */ }
        this.hub.recordOutsideRead(name, session, "http", info.tool);
      }
      for (const name of named(/([A-Za-z0-9._~-]+)\.jsonl\b/g)) this.hub.recordOutsideRead(name, session, "file", info.tool);
    }
    if (!seats.length) beatAwaySeats(this.hub, seatKey, (room, p) => this.recordWork(room, p, info));
    return seats.length;
  }

  /** The active participants a launched seat's connection holds (by seat key), in rooms still open. */
  participants(seatKey: string): { room: Room; p: Participant }[] {
    const session = this.seatSessions.get(seatKey);
    if (!session) return [];
    return [...this.hub.rooms.values()].filter((room) => room.state !== "concluded" && room.state !== "closed")
      .flatMap((room) => [...room.participants.values()].filter((p) => p.active && p.session === session).map((p) => ({ room, p })));
  }

  /** A participant's recent steps, oldest first (GET /rooms/:room/participants/:name/activity). */
  activity(roomName: string, name: string): { tool: string; step: number; at: string; detail: string }[] {
    const room = this.hub.getRoom(roomName);
    const p = [...room.participants.values()].filter((x) => x.name === name).sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0))[0];
    if (!p) throw new HubError(`No participant named "${name}" in "${roomName}".`, undefined, "not-found");
    return p.activity ?? [];
  }
}

// ---------- idle MCP sessions: which the sweep reaps and which it spares ----------
/**
 * Idle MCP sessions: which the liveness sweep reaps and which it spares (decision/reaping-liveness).
 *
 * The sweep closed a session after SESSION_IDLE_MS with no MCP request and its seat left every room. Over hub 7717's
 * records and the research server's, 15 of 17 such reaps in open rooms took a seat that was alive (scripts/reap-replay.mjs):
 * a seat parked on a background job makes no call of any kind (swarm-164210-9f66 bk4: claude-recruit-11 was reaped at
 * 23:32, lost its claim to another seat and came back at 00:22 when its job ended), and a chair talking to the owner
 * makes none either. The hub held proof each time and did not look at it:
 * - stream: an SDK client (Claude Code included) holds a GET /mcp SSE stream open for the life of its session. Its socket
 *   closes when the process ends; TCP keepalive finds a peer that vanished without closing it.
 * - heartbeat: a launched seat's tool hook (POST /heartbeat) or seat loop (POST /rooms/:room/heartbeat) within the window.
 * - process: the seat key's agent process in the memory watcher's last process-table sample, while that process is not an
 *   orphan (a job left behind by a dead seat is adopted by launchd and does not keep its seat).
 * A session with none of these is reaped as before; a killed launched seat is closed sooner by its launcher's exit receipt.
 * The three say the CLI is alive, not that it is getting anywhere: a background `until [ -f x ]; do sleep 30; done` on a
 * file that never comes keeps the CLI, its stream and its process forever (attack/decision/reaping-liveness 1). So past
 * spareMaxMs idle (CHATROOM_SESSION_SPARE_MAX_MS, default four windows: the 15 live seats reaped in the records came back
 * at most 94 min after their last call, a chair; the 4 that were not chairs, 80 min) only a running job (memory.ts
 * jobsOf: a sleep or a shell loop is not one) or a tool call within the window keeps the seat. Recorded jobs ran p95
 * 48 min, p99 166 min, n=1628, so a job is not cut off at the ceiling.
 * A chair's idle session is closed but the chair keeps its seat: it is never waited on, so marking it left frees nothing,
 * and a departed chair cannot be @-named (departed-mention). Each idle episode writes one reap_check event, with the jobs
 * it waits on, and a spared seat's rooms get one line saying so, so a room waiting on it sees why it is quiet.
 */
export type AliveBy = "stream" | "heartbeat" | "process";
export type ReapOutcome = "spared" | "reaped" | "chair_kept";

/** What the hub keeps per MCP session (src/index.ts transports). */
export interface SessionEntry {
  t: { close(): Promise<void> };
  leaveAll: (reason?: string, final?: boolean, keepChair?: boolean) => void;
  /** the hub-side session key (never logged) */
  session: string;
  /** the last MCP request on this session */
  lastSeen: number;
  seatKey?: string;
  /** GET /mcp streams open now */
  streams: number;
  /** the last heartbeat from this session's seat */
  lastBeat?: number;
  /** this idle episode has been recorded as spared */
  spared?: boolean;
}

/** The signals that say an idle session's client is still alive, in a fixed order. */
export function aliveBy(e: Pick<SessionEntry, "streams" | "lastBeat">, at: number, idleMs: number, agentSeenAt?: number, processFreshMs = 0): AliveBy[] {
  const by: AliveBy[] = [];
  if (e.streams > 0) by.push("stream");
  if (e.lastBeat !== undefined && at - e.lastBeat <= idleMs) by.push("heartbeat");
  if (agentSeenAt !== undefined && at - agentSeenAt <= processFreshMs) by.push("process");
  return by;
}

/** A GET /mcp is the client's standing stream: counted while it is open. */
export function watchStream(e: SessionEntry, req: IncomingMessage, res: ServerResponse): void {
  e.streams++;
  req.socket.setKeepAlive(true, 30_000);
  res.once("close", () => { e.streams = Math.max(0, e.streams - 1); });
}

/** A heartbeat from a seat's process tree: every session of that seat is alive as of now. */
export function noteBeat(transports: Map<string, SessionEntry>, mine: (e: SessionEntry) => boolean, at = Date.now()): void {
  for (const e of transports.values()) if (mine(e)) e.lastBeat = at;
}

/** One reap_check per seat the session holds in an open room: what kept it, or that nothing did. A spared seat that is
 * not the chair also gets one line in that room. */
export function recordReapCheck(hub: Hub, session: string, outcome: "spared" | "reaped", alive: AliveBy[], idleMs: number,
  more: { waiting_on?: string[]; past_ceiling?: boolean; spareMaxMs?: number } = {}): void {
  const { waiting_on = [], past_ceiling, spareMaxMs } = more;
  for (const room of hub.rooms.values()) {
    if (room.state === "concluded" || room.state === "closed") continue;
    for (const p of room.participants.values()) {
      if (!p.active || p.session !== session) continue;
      hub.persist({ type: "reap_check", room: room.name, participant: p.id, name: p.name,
        outcome: outcome === "reaped" && p.role === "chair" ? "chair_kept" : outcome, alive_by: alive, waiting_on,
        ...(past_ceiling ? { past_ceiling } : {}), idle_s: Math.round(idleMs / 1000), idle_min: Math.round(idleMs / 60_000), ts: now() });
      if (outcome !== "spared" || p.role === "chair") continue;
      hub.post(room, "system", undefined, `${hub.shown(room, p)} has made no hub call for ${Math.round(idleMs / 60_000)} min, but its client is alive (${alive.join(", ")})` +
        `${waiting_on.length ? `, running \`${waiting_on[0]!.slice(0, 120)}\`` : ", with no job the hub can see"}. It keeps its seat` +
        `${spareMaxMs ? `; at ${Math.round(spareMaxMs / 60_000)} min idle with no job and no tool call it is reaped` : ""}.`);
    }
  }
}

/** The sweep: spare what is alive (once per idle episode on the record), reap the rest. */
export function reapIdle(hub: Hub, transports: Map<string, SessionEntry>, opts: { idleMs: number; processFreshMs: number; spareMaxMs?: number; at?: number }): void {
  const at = opts.at ?? Date.now();
  const spareMaxMs = opts.spareMaxMs ?? 4 * opts.idleMs;
  for (const [id, e] of transports) {
    const idle = at - e.lastSeen;
    if (idle <= opts.idleMs) { e.spared = false; continue; }
    const seat = e.seatKey ? seatHash(e.seatKey) : undefined;
    const alive = aliveBy(e, at, opts.idleMs, seat ? hub.memory.agentSeenAt(seat) : undefined, opts.processFreshMs);
    const waiting_on = hub.memory.jobs(seat).map((j) => j.command).slice(0, 3);
    // past the ceiling a live client is kept only by work the hub can see: a job running, or a tool call in the window
    const pastCeiling = idle > spareMaxMs && alive.length > 0 && !waiting_on.length && !alive.includes("heartbeat");
    if (alive.length && !pastCeiling) {
      if (!e.spared) recordReapCheck(hub, e.session, "spared", alive, idle, { waiting_on, spareMaxMs });
      e.spared = true;
      continue;
    }
    recordReapCheck(hub, e.session, "reaped", alive, idle, { waiting_on, past_ceiling: pastCeiling });
    // the same opening words as a plain close: liveness.away and result.ts read them
    e.leaveAll(pastCeiling ? `MCP session closed without leave_room (idle ${Math.round(idle / 60_000)} min, client alive by ${alive.join("+")} but no job and no tool call past the ${Math.round(spareMaxMs / 60_000)} min ceiling, reaped)`
      : `MCP session closed without leave_room (idle ${Math.round(opts.idleMs / 60_000)} min, reaped)`, false, true);
    e.t.close().catch(() => {});
    transports.delete(id);
  }
}
