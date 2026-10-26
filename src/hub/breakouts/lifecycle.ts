/**
 * What happens to a breakout, as functions over the Hub instance (server-chair note 6, swarm-164210-9f66: the owner had
 * to ask what would happen to five breakouts once the parent concluded; decision/breakout-fate).
 *
 * A breakout is not stopped by its parent's conclusion: its seats are told the parent's answer is fixed (tellOpenBreakouts),
 * and its own conclusion is still copied onto the parent's board, marked late, for Hub.LATE_WRITE_MS (src/hub.ts carryConclusion).
 * Across 36 breakouts in 332 recorded rooms (evidence/breakout-fate), 20 concluded before their parent and none after;
 * the other 15 were children of runs the owner stopped, and in all three of those the chair closed the parent and every
 * child by hand within the same second. Two parts went unsaid until now. A conclusion the parent could no longer take
 * (closed, or past the window) vanished with no event and no line, the silent empty return of arXiv:2607.28802's
 * delegation failure; and a parent's close neither told nor closed its breakouts, where a supervisor's or a nursery's
 * cancel ends its children (sources/erlang-otp-supervisor, sources/vorpus-structured-concurrency).
 *
 * Telemetry: breakout_carry (every attempt to copy a conclusion: delivered | late | dropped, with the reason) and
 * parent_closed in the breakout's own log; breakout_fate in room_status and GET /rooms, so the agents in a breakout and
 * the owner on the dashboard read the same sentence.
 */
import type { Hub } from "../../hub.js";
import { lateWindow } from "../board.js";
import { now } from "../internal.js";
import type { Proposal, Room, RoomState } from "../types.js";

export type CarryDrop = "parent_closed" | "past_window" | "parent_missing";

export interface BreakoutFate {
  parent: string;
  parent_state: RoomState | "missing";
  /** the conclusion's copy on the parent's board, once made */
  carried?: { key: string; at: string; late?: true };
  /** why a concluded breakout's conclusion is not on the parent's board */
  not_carried?: CarryDrop;
  /** while the parent is concluded and still takes late results: when that stops */
  late_until?: string;
  /** one sentence: where this room's conclusion goes, and until when */
  line: string;
}

/** Where a breakout's conclusion lands on its parent's board. */
export const carryKey = (child: string): string => `inbox/${child}/conclusion`;

/** Why a conclusion cannot be copied to this parent now; undefined when it can (on time or late). */
export function carryDrop(hub: Hub, parent: Room | undefined): CarryDrop | undefined {
  if (!parent) return "parent_missing";
  if (parent.state === "closed") return "parent_closed";
  if (parent.state === "concluded" && !lateWindow(hub, parent)) return "past_window";
  return undefined;
}

/** When a concluded parent stops taking late results. */
function lateUntil(hub: Hub, parent: Room): string | undefined {
  if (parent.state !== "concluded" || !parent.conclusion?.decidedAt || hub.lateWriteMs <= 0) return undefined;
  return new Date(Date.parse(parent.conclusion.decidedAt) + hub.lateWriteMs).toISOString();
}

const at = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

function dropWords(hub: Hub, name: string, why: CarryDrop, parent?: Room): string {
  if (why === "parent_missing") return `${name} is not on this hub`;
  if (why === "parent_closed") return `${name} was closed without a conclusion`;
  const decided = parent?.conclusion?.decidedAt;
  const until = decided ? new Date(Date.parse(decided) + hub.lateWriteMs).toISOString() : undefined;
  return `${name} concluded${decided ? ` at ${at(decided)}` : ""} and its late window closed${until ? ` at ${at(until)}` : ""}`;
}

/**
 * A conclusion that could not be copied: logged, and said in the breakout, so nobody there takes the missing copy for
 * a delivered one. The parent is not told (closed, or concluded hours ago: nobody is reading it).
 */
export function carryDropped(hub: Hub, child: Room, why: CarryDrop): void {
  const parent = child.parent ? hub.rooms.get(child.parent) : undefined;
  hub.persist({ type: "breakout_carry", room: child.name, parent: child.parent!, outcome: "dropped", reason: why, ts: now() });
  hub.post(child, "system", undefined,
    `This room's conclusion was not copied to ${child.parent}: ${dropWords(hub, child.parent!, why, parent)}. ` +
    `It stays in this room only (room_status room="${child.name}"); if it should change what ${child.parent} decided, tell the owner or the chair.`);
}

/** The breakout_carry event for a conclusion that was copied (late: after the parent concluded, within its window). */
export function carryRecorded(hub: Hub, child: Room, key: string, late?: { after_s: number }): void {
  hub.persist({ type: "breakout_carry", room: child.name, parent: child.parent!, outcome: late ? "late" : "delivered", key, ...(late ? { after_s: late.after_s } : {}), ts: now() });
}

/**
 * Each breakout still open when its parent concludes is told at once that the parent's answer is fixed. In
 * swarm-123021-1nwp the internal group kept waiting on a run with an ETA of 17:00 for 92 min after the leads room
 * concluded at 14:34, never told, and its final board write was refused. Logged as parent_concluded in the breakout.
 */
export function tellOpenBreakouts(hub: Hub, room: Room, pr: Proposal): void {
  for (const name of hub.openBreakouts(room)) {
    const child = hub.rooms.get(name)!;
    hub.persist({ type: "parent_concluded", room: name, parent: room.name, proposalId: pr.id, version: pr.version, ts: now() });
    hub.post(child, "system", undefined,
      `${room.name}, this room's parent, concluded on ${pr.id} v${pr.version} at ${room.conclusion!.decidedAt}: its answer is fixed, and a conclusion here can no longer change it (at most it lands on its board as a late entry) ` +
      `(its text: room_status room="${room.name}"). Decide whether the work still running here changes anything: if not, conclude or leave; if it does, say so in the parent's room or post_to_room it.`);
  }
}

/**
 * A parent's close ends its open breakouts, recursively: each is closed with a reason naming the parent and gets a
 * parent_closed event, and the parent gets one line naming them. A concluded breakout keeps its conclusion. Returns the
 * names of the breakouts closed directly under this parent.
 */
export function closeBreakouts(hub: Hub, room: Room, by: string, reason: string): string[] {
  const open = [...hub.rooms.values()].filter((r) => r.parent === room.name && (r.state === "open" || r.state === "stalled"));
  for (const child of open) {
    hub.persist({ type: "parent_closed", room: child.name, parent: room.name, by, ts: now() });
    hub.closeRoom(child.name, by, `its parent ${room.name} was closed${reason ? ` (${reason})` : ""}`);
  }
  if (open.length) hub.post(room, "system", undefined, `Open breakout${open.length === 1 ? "" : "s"} closed with it: ${open.map((r) => r.name).join(", ")}.`);
  return open.map((r) => r.name);
}

/** One sentence for room_status and the dashboard: where this breakout's conclusion goes and until when. */
export function breakoutFate(hub: Hub, room: Room, lastCallMs: number): BreakoutFate | undefined {
  if (!room.parent) return undefined;
  const name = room.parent;
  const parent = hub.rooms.get(name);
  const key = carryKey(room.name);
  const entry = parent?.board.get(key);
  const carried = entry && entry.by === "system" ? { key, at: entry.updatedAt, ...(entry.late ? { late: true as const } : {}) } : undefined;
  const until = parent ? lateUntil(hub, parent) : undefined;
  const drop = carryDrop(hub, parent);
  const base = { parent: name, parent_state: parent?.state ?? ("missing" as const), ...(carried ? { carried } : {}), ...(until && !drop ? { late_until: until } : {}) };
  if (room.state === "concluded") {
    if (carried) {
      return { ...base, line: `Concluded; its conclusion was copied to ${name} as ${key} at ${at(carried.at)}` +
        (carried.late ? `, marked late: ${name} had already concluded, so it did not change that answer.` : ".") };
    }
    const why = drop ?? "parent_missing";
    return { ...base, not_carried: why, line: `Concluded; its conclusion was not copied to ${name}: ${dropWords(hub, name, why, parent)}. It is in this room only.` };
  }
  if (room.state === "closed") return { ...base, line: `Closed without a conclusion; nothing was copied to ${name}.` };
  if (drop) return { ...base, line: `${dropWords(hub, name, drop, parent)}: a conclusion here stays in this room only.` };
  if (parent!.state === "concluded") {
    return { ...base, line: `${name} concluded at ${at(parent!.conclusion!.decidedAt)}; its answer is fixed. A conclusion here is still copied there as ${key}, marked late, until ${at(until!)}; after that it stays in this room only.` };
  }
  return { ...base, line: `When this room concludes, its conclusion is copied to ${name} as ${key}.` +
    (lastCallMs > 0 ? ` While this room is open and has seats, ${name}'s last call waits up to ${Math.round(lastCallMs / 60_000) || 1} min for it before concluding.` : "") +
    ` If ${name} concludes first, this room is told, and ` +
    (hub.lateWriteMs > 0 ? `its conclusion still lands there marked late for ${Math.round(hub.lateWriteMs / 360_000) / 10} h.` : "its conclusion stays here.") };
}
