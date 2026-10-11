/**
 * A room that has stopped working, as functions over the Hub instance (owner input B, swarm-003601-tky5).
 *
 * Seats that say they are free get an answer (49 of 58 such messages across 261 recorded rooms, median under a minute).
 * The loss is seats that never say it. swarm-094251-5y46, six seats for eight hours, made 285k output tokens per half
 * hour until 13:00 UTC and 11k-24k from 13:30 on: every lead had been tested by 13:15, the brief said not to wrap up
 * early, and each seat slept ten minutes at a time for three hours (unbroken runs of 159, 91, 84 and 73 minutes).
 * Nobody said so, wrote an idea, recruited or voted, and the hub, which held every seat's tool calls, said nothing.
 *
 * The rule counts what the record already holds. A step is a local tool call on something new (a `work` event: the
 * ledger dedupes on the target, so the same sleep run fifty times is one step), a chat message from an agent, or a
 * board write. A room is quiet when its seats made fewer than ROOM_IDLE_STEPS steps each over ROOM_IDLE_MS. Replayed
 * over every record with work events from three or more seats and an hour of life (3 rooms, 10 room-hours: thin), 5
 * steps over 30 minutes fires once, in that room at 13:57 UTC with 3 h 35 min left, and nowhere else. It is late:
 * that room's steps per 30 minutes ran 188-371 while it worked, then 125, 72, 49, 28, so the line comes about 40
 * minutes into the stall (a second replay by its reviewer, review/seat-guard-and-room-idle).
 *
 * Nothing is enforced: the room is told, with the numbers, and so is the room it was opened from. Who acts is the
 * chair or consolidator (new inputs, a digest from the other groups, a vote on what is done) and the seats themselves.
 */
import type { Hub } from "../hub.js";
import { now } from "./internal.js";
import { windowMs } from "./output.js";
import type { Participant, Room } from "./types.js";

/** The window the rule looks back over. CHATROOM_ROOM_IDLE_MS=0 turns the signal off. */
export const ROOM_IDLE_MS = windowMs(process.env.CHATROOM_ROOM_IDLE_MS, 30 * 60_000);
/** New steps per seat per 30 minutes below which a room is quiet: a rate, so a shorter window asks for proportionally
 * fewer (a dev room on a 2-minute window read an active room as quiet against the unscaled count). */
export const ROOM_IDLE_STEPS = windowMs(process.env.CHATROOM_ROOM_IDLE_STEPS, 5);
const RATE_WINDOW_MS = 30 * 60_000;
/** A repeat waits while anything was said or written this recently: "quiet for N min" on top of a message is false. */
const REPEAT_SETTLE = 1 / 6;
const OFF = process.env.CHATROOM_ROOM_IDLE_MS?.trim() === "0";
/** Still quiet this long after the room was told: it is told again. */
const REPEAT_WINDOWS = 2;

export interface QuietWindow { steps: number; seats: number; window_ms: number; quiet: boolean }
/** What a stalled room carries: when the hub first said so, when it last did, and the numbers it quoted. */
export interface RoomIdle { since: string; toldAt: string; steps: number; seats: number; window_min: number }

/** The rule, over step times (ms) however they were gathered: the hub's live state, or a room record read back
 * (scripts/run-metrics.ts). One seat is not a room. */
export function quietWindow(steps: number[], seats: number, at: number, opts: { windowMs?: number; stepsPerSeat?: number } = {}): QuietWindow {
  const window_ms = opts.windowMs ?? ROOM_IDLE_MS;
  const n = steps.filter((t) => t > at - window_ms && t <= at).length;
  const perSeat = opts.stepsPerSeat ?? Math.max(1, ROOM_IDLE_STEPS * window_ms / RATE_WINDOW_MS);
  return { steps: n, seats, window_ms, quiet: seats >= 2 && n < perSeat * seats };
}

/** When each step in the window happened: counted local tool calls, agents' chat messages, and board writes by the
 * room's own agent seats. A note another room wrote here (a consolidator's digest), the launcher's resource/* seeding
 * and the hub's own entries are things the room received, not work it did: in the dress rehearsal a digest landing on
 * a quiet group's board read as that group working. */
export function roomSteps(room: Room, at: number, window = ROOM_IDLE_MS): number[] {
  const within = (t: number) => t > at - window && t <= at;
  const own = new Set([...room.participants.values()].filter((p) => p.agent !== "human").map((p) => p.name));
  return [
    ...(room.workAt ?? []),
    ...room.messages.filter((m) => m.kind === "chat" && m.from.id !== "system" && m.from.agent !== "human").map((m) => Date.parse(m.ts)),
    ...[...room.board.values()].filter((e) => own.has(e.by)).map((e) => Date.parse(e.updatedAt)),
  ].filter(within);
}

/** A counted tool call, kept for the window (and a little more: a replay may check a moment ago). */
export function noteWork(room: Room, at = Date.now()): void {
  const keep = at - 2 * ROOM_IDLE_MS;
  room.workAt = [...(room.workAt ?? []).filter((t) => t > keep), at];
}

/** Agent seats here for the whole window whose tool calls reach the hub: a claude seat's hook reports each one, so for
 * it nothing counted means nothing done. For any other seat silence proves nothing, and a room with one is not judged. */
function judged(hub: Hub, room: Room, at: number): Participant[] | undefined {
  const seats = hub.activeParticipants(room).filter((p) => p.agent !== "human" && p.role !== "chair");
  if (seats.some((p) => !p.work && !(p.seatKeyHash && p.agent === "claude"))) return undefined;
  return seats.every((p) => Date.parse(p.joinedAt) <= at - ROOM_IDLE_MS) ? seats : undefined;
}

const span = (ms: number) => { const min = Math.round(ms / 60_000); return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`; };

/** Called on the hub's sweep. Tells the room once per stall (and again every REPEAT_WINDOWS windows it lasts), tells
 * its parent, and writes room_idle / room_active to the record so a run's stalls can be read without a transcript. */
export function checkRoomIdle(hub: Hub, room: Room, at = Date.now()): void {
  if (OFF || room.state !== "open") return;
  const seats = judged(hub, room, at);
  const q = seats && quietWindow(roomSteps(room, at), seats.length, at);
  if (q && !q.quiet && room.idle) {
    hub.persist({ type: "room_active", room: room.name, ts: now(), idle_min: Math.round((at - Date.parse(room.idle.since)) / 60_000) });
    room.idle = undefined;
  }
  // a room waiting on a vote, held, or already told it is ending is not stalled; nor is one the hub cannot judge
  if (!q?.quiet || hub.hold(room) || room.deadline?.announced || [...room.proposals.values()].some((pr) => pr.status === "open")) return;
  if (room.idle && at - Date.parse(room.idle.toldAt) < REPEAT_WINDOWS * ROOM_IDLE_MS) return;
  if (room.idle && roomSteps(room, at, ROOM_IDLE_MS * REPEAT_SETTLE).length) return;
  const window_min = Math.round(q.window_ms / 60_000);
  const since = room.idle?.since ?? new Date(at).toISOString();
  room.idle = { since, toldAt: new Date(at).toISOString(), steps: q.steps, seats: q.seats, window_min };
  const left = room.deadline ? Date.parse(room.deadline.at) - at : 0;
  hub.persist({ type: "room_idle", room: room.name, ts: now(), idle: room.idle, steps: q.steps, seats: q.seats, window_min, ...(left > 0 ? { seconds_left: Math.round(left / 1000) } : {}) });
  const chair = hub.activeParticipants(room).find((p) => p.role === "chair" && p.agent !== "human");
  const lasted = at - Date.parse(since);
  const facts = `its ${q.seats} seats made ${q.steps} new step${q.steps === 1 ? "" : "s"} between them in the last ${window_min} min (tool calls on something new, messages, board entries)` +
    `${lasted >= 60_000 ? `, quiet for ${Math.round(lasted / 60_000)} min now` : ""}${left > 0 ? `, and ${span(left)} remain` : ""}`;
  // kind "chat" when a chair is named: only a chat line carries its @-mention as an owed ask (see output.ts)
  hub.post(room, chair ? "chat" : "system", undefined,
    `${chair ? `@${hub.shown(room, chair)} this` : "This"} room has gone quiet: ${facts}. ` +
    `Seats: if your area is finished, say so in one line and put what you would test next on idea/<slug>; if you are waiting on a job, say which and when it ends. Sleeping until the deadline tells nobody. ` +
    `Whoever steers: this is the moment for new inputs or a digest from the other groups, or for the room to vote what is done and carry on from there.`);
  const parent = room.parent ? hub.rooms.get(room.parent) : undefined;
  if (parent && parent.state === "open") hub.post(parent, "system", undefined, `Breakout ${room.name} has gone quiet: ${facts}. Its board holds where it stands (board_get room="${room.name}"); a note to it lands with post_to_room.`);
}

/** room_status: present only while the room is stalled. */
export const idleView = (room: Room) => room.idle && { since: room.idle.since, told_at: room.idle.toldAt, steps: room.idle.steps, seats: room.idle.seats, window_min: room.idle.window_min };
