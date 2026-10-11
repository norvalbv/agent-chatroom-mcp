/**
 * take/<what>: who has taken what, as data (swarm-003601-tky5, board evidence/taken-work-as-data). In three rooms 68 of
 * 94 hand-read take, hand-over and release messages were in chat only: 30 gave work to another seat, which a claim/*
 * cannot record (it belongs to whoever writes it); 29 were pieces smaller than an area, for which a claim (JSON, a
 * reviewer, two room messages) is too heavy; 8 were turns on a shared resource. Seats learned an audit was already
 * taken when the board refused their finished write.
 * A take is one free line under a key naming the thing (take/audit/exp-Q8, take/benchlock): no JSON, no reviewer.
 * - Text starting with @name offers it to that seat (holder = that seat, offeredBy = the writer). The seat accepts by
 *   writing the key itself and declines by clearing it; the offerer may re-address or withdraw while it is only offered.
 *   A holder hands over the same way.
 * - Anyone else's write is refused with the holder, since when and their line, overwrite or not: a second seat learns
 *   it before doing the work. A take whose holder has left the room is open to anyone.
 * - Each step is a "take" record in the room log (telemetry; replay rebuilds the entry from the board record).
 */
import type { Hub } from "../hub.js";
import { HubError } from "./types.js";
import type { BoardEntry, Participant, Room } from "./types.js";

export type TakeAction = "take" | "offer" | "accept" | "update" | "handover" | "release" | "decline" | "withdraw" | "refused";
export interface TakeWrite { action: TakeAction; holder: Participant; offeredBy?: Participant; previousOfferer?: Participant }

/** The most recent participant under a name: a seat that left and came back under the same name is the later one. */
const named = (room: Room, name: string) => [...room.participants.values()].filter((x) => x.name === name).at(-1);

/** Decide a write to take/<what>, or throw the refusal that names the holder. Called by setBoard before it writes. */
export function takeWrite(hub: Hub, room: Room, p: Participant, key: string, text: string, previous: BoardEntry | undefined): TakeWrite {
  const holder = previous ? named(room, previous.holder ?? previous.by) : undefined;
  const offerer = previous?.offeredBy ? named(room, previous.offeredBy) : undefined;
  const mine = holder?.id === p.id;
  if (previous && holder && holder.active && !mine && offerer?.id !== p.id && p.agent !== "human") {
    hub.persist({ type: "take", room: room.name, key, action: "refused", by: p.name, holder: holder.name, ts: new Date().toISOString() });
    throw new HubError(
      `"${key}" is ${offerer ? `offered to ${hub.shown(room, holder)} by ${hub.shown(room, offerer)}` : `held by ${hub.shown(room, holder)}`} since ${previous.updatedAt}: "${previous.text.slice(0, 200)}". ` +
      `Ask them before doing it, or take something nobody holds (room_status lists each seat's holds).`,
      undefined, "ownership");
  }
  if (!text.trim()) return { action: previous?.offeredBy ? (mine ? "decline" : "withdraw") : "release", holder: holder ?? p, previousOfferer: offerer };
  const to = /^@("?)((?:participant )?[\w-]+)\1/i.exec(text.trim());
  if (to) {
    const target = hub.mentionsIn(room, `@${to[2]}`).map((id) => room.participants.get(id)!).filter((x) => x.active).at(-1);
    if (!target) throw new HubError(`"${key}" starts with @${to[2]}, which offers it to that seat, and there is no active seat named "${to[2]}" in this room. Start the line with an active seat's name, or with no @ to take it yourself.`, undefined, "state");
    if (target.id !== p.id) return { action: previous && mine && !previous.offeredBy ? "handover" : "offer", holder: target, offeredBy: p };
  }
  return { action: !previous || !mine ? "take" : previous.offeredBy ? "accept" : "update", holder: p };
}

/** What the room is told: the board notice, and for an offer or a decline an @-line to the seat that must act on it. */
export function announceTake(hub: Hub, room: Room, p: Participant, key: string, text: string, w: TakeWrite): void {
  const line = text.trim().slice(0, 160);
  hub.persist({ type: "take", room: room.name, key, action: w.action, by: p.name, holder: w.holder.name, ts: new Date().toISOString() });
  switch (w.action) {
    case "take": case "accept": hub.post(room, "board", p, `took "${key}": ${line}`); break;
    case "update": hub.post(room, "board", p, `updated "${key}": ${line}`); break;
    case "offer": case "handover":
      hub.post(room, "board", p, `${w.action === "handover" ? "handed" : "offered"} "${key}" to ${hub.shown(room, w.holder)}`);
      // chat kind: an owed @-mention wakes the seat's held wait (as the reviewer notice does)
      hub.post(room, "chat", undefined, `@${hub.shown(room, w.holder)} ${hub.shown(room, p)} offers you "${key}": ${line}. To take it: board_set(key="${key}", text=<one line on what you are doing>). To decline: board_set(key="${key}", text=""). Until then nobody else can take it.`);
      break;
    case "decline":
      hub.post(room, "board", p, `declined "${key}"`);
      if (w.previousOfferer?.active) hub.post(room, "chat", undefined, `@${hub.shown(room, w.previousOfferer)} ${hub.shown(room, p)} declined "${key}": it is held by nobody now. Offer it to another seat or take it yourself.`);
      break;
    default: hub.post(room, "board", p, `${w.action === "withdraw" ? "withdrew the offer of" : "released"} "${key}"`);
  }
}

/** room_status, per seat: the takes it holds and the ones offered to it. Empty lists are left out. */
export function takesOf(room: Room, p: Participant, nm: (x: Participant) => string): { holds?: string[]; offered?: { key: string; by: string }[] } {
  const holds: string[] = [], offered: { key: string; by: string }[] = [];
  for (const [key, e] of room.board) {
    if (!key.startsWith("take/") || !e.text.trim() || named(room, e.holder ?? e.by)?.id !== p.id) continue;
    const by = e.offeredBy ? named(room, e.offeredBy) : undefined;
    if (e.offeredBy) offered.push({ key, by: by ? nm(by) : e.offeredBy }); else holds.push(key);
  }
  return { ...(holds.length ? { holds } : {}), ...(offered.length ? { offered } : {}) };
}
