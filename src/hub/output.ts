/**
 * What each seat has put on the record, as functions over the Hub instance (claim/seat-performance, swarm-000525-jcz8).
 *
 * Liveness is a heartbeat: a seat that loops on local tools reads "active" for as long as it runs, so room_status could
 * say a seat is alive but never what it has produced. Across 57 concluded board-using rooms only 10 of 372 agent worker
 * seats (2.7%) left no evidence, verify, proposal or challenge, so nothing here removes a seat: the record makes such a
 * seat visible, tells it once, and gives a kick vote the hub's numbers instead of the accuser's word (all 9 kick votes
 * on record were for dead sessions, none for work). Everything is derived from room state, so a replay rebuilds it.
 */
import type { Hub } from "../hub.js";
import type { Participant, Room } from "./types.js";

/** In the room this long with nothing on the record before a worker is listed (the stale-claim and suspected-dead window). */
export const NO_OUTPUT_MS = Number(process.env.CHATROOM_NO_OUTPUT_MS ?? 10 * 60_000);
/** The same for a worker that holds a claim: a builder's commits never reach the hub, so a claim buys time, not immunity.
 * Replayed over 62 past rooms (392 worker seats): one 10 min window warns 61 seats of which 54 delivered minutes later;
 * 10 min unclaimed / 45 min claimed warns 12, of which 3 never delivered and 9 delivered a median 12 min later. */
export const NO_OUTPUT_CLAIMED_MS = Number(process.env.CHATROOM_NO_OUTPUT_CLAIMED_MS ?? 45 * 60_000);

export interface SeatOutput { claims: number; evidence: number; verifies: number; proposals: number; challenges: number; age_seconds: number | null }

/** Board keys that coordinate rather than deliver: a claim is a promise, a hold or an ack is a switch. */
const coordinates = (key: string) => key.startsWith("claim/") || key.startsWith("hold/") || (key.startsWith("inbox/") && key.endsWith(".ack"));

export function seatOutput(room: Room, p: Participant, observedAt = Date.now()): SeatOutput {
  const out: SeatOutput = { claims: 0, evidence: 0, verifies: 0, proposals: 0, challenges: 0, age_seconds: null };
  let last = 0;
  const seen = (ts: string) => { last = Math.max(last, Date.parse(ts) || 0); };
  for (const [key, e] of room.board) {
    if (e.by !== p.name) continue;
    if (key.startsWith("claim/")) { out.claims++; continue; }
    if (coordinates(key)) continue;
    if (key.startsWith("verify/")) out.verifies++;
    else out.evidence++;
    seen(e.updatedAt);
  }
  for (const pr of room.proposals.values()) {
    if (pr.by.id === p.id) { out.proposals++; seen(pr.createdAt); }
    for (const c of pr.challenges) if (c.by.id === p.id) { out.challenges++; seen(c.ts); }
  }
  if (last) out.age_seconds = Math.max(0, Math.floor((observedAt - last) / 1000));
  return out;
}

const windowFor = (o: SeatOutput) => (o.claims ? NO_OUTPUT_CLAIMED_MS : NO_OUTPUT_MS);
const delivered = (o: SeatOutput) => o.evidence + o.verifies + o.proposals + o.challenges > 0;
/** Seats the record is a fair measure of: agent workers. The verifier waits for work by design; humans and the chair steer. */
const workers = (hub: Hub, room: Room) => hub.activeParticipants(room).filter((p) => p.agent !== "human" && (p.role ?? "worker") !== "chair" && p.role !== "verifier");

/** Workers in an open room past NO_OUTPUT_MS with nothing delivered, while more than half of the other workers have
 * delivered something: in a room that does not work on the record, an empty record says nothing about a seat. */
export function noOutput(hub: Hub, room: Room, observedAt = Date.now()): Participant[] {
  if (room.state === "concluded" || room.state === "closed") return [];
  const ws = workers(hub, room).map((p) => { const o = seatOutput(room, p, observedAt); return { p, done: delivered(o), window: windowFor(o) }; });
  return ws.filter((w) => !w.done && observedAt - Date.parse(w.p.joinedAt) >= w.window
    && ws.filter((o) => o.p.id !== w.p.id && o.done).length * 2 > ws.length - 1).map((w) => w.p);
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const WARNED = "you have put nothing on the record";

/** Tell each listed seat once, in the room, where its peers can see it. The line itself is the receipt, so a replay does not repeat it. */
export function warnNoOutput(hub: Hub, room: Room): void {
  for (const p of noOutput(hub, room)) {
    const at = `@${p.name} `;
    if (room.messages.some((m) => m.kind === "system" && m.content.startsWith(at) && m.content.includes(WARNED))) continue;
    const o = seatOutput(room, p);
    hub.post(room, "system", undefined,
      `${at}${WARNED} of this room in ${Math.round(windowFor(o) / 60_000)} min: no board entry, verify, proposal or challenge, while most seats have` +
      `${o.claims ? `, and you hold ${n(o.claims, "claim")}. Work on your branch is invisible here until you say where it stands` : ""}. ` +
      `room_status lists you under no_output and a kick vote would quote that. Put what you have on the board now (a partial finding or a status line counts), ` +
      `or hand your area over (handoff/<area>) and leave_room with the reason.`);
  }
}

/** One line of the hub's own numbers for a kick vote, so ballots are cast on the record. */
export function outputLine(hub: Hub, room: Room, p: Participant): string {
  const o = seatOutput(room, p);
  return `Hub record for ${hub.shown(room, p)}: ${n(o.claims, "claim")}, ${n(o.evidence, "evidence entry", "evidence entries")}, ${n(o.verifies, "verify", "verifies")}, ` +
    `${n(o.proposals, "proposal")}, ${n(o.challenges, "challenge")}, ${n(p.messageCount, "chat message")}, ${Math.round((Date.now() - Date.parse(p.joinedAt)) / 60_000)} min in the room.`;
}
