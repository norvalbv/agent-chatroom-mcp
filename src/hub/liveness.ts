/** Seat liveness: launcher seat keys bound to MCP connections, heartbeats, the steps a seat ran, and which departed seats
 * are only away. The Hub keeps a one-line delegator for each member called from outside. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { Hub } from "../hub.js";
import { HubError } from "./types.js";
import type { Participant, Room } from "./types.js";
import { now } from "./internal.js";
import { SUSPECTED_DEAD_MS } from "./kick.js";
import { noteWork } from "./idle.js";
import { countWork, workClass } from "./work.js";

/** `hub`: the beat is a chatroom tool call the hub served itself, not local work the seat's process reported. */
export type Beat = { tool: string; step?: number; detail?: string; hub?: boolean };

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
 * and its launcher hold it. A seat that left on purpose, was kicked or has a successor is not brought back.
 */
export function reseatable(room: Room, hash: string | undefined, wantId?: string): Participant | undefined {
  if (!hash) return undefined;
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
    if (cls && counted) this.hub.persist({ type: "work", room: room.name, pid: p.id, cls, tool: String(info.tool).slice(0, 40), target: counted.target, ...(counted.key !== counted.target ? { key: counted.key } : {}), ts: now() });
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
      for (const m of named(/\/rooms\/([A-Za-z0-9._~%-]+)/g)) {
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
    if (!p) throw new HubError(`No participant named "${name}" in "${roomName}".`);
    return p.activity ?? [];
  }
}
