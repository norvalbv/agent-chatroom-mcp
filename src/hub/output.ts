/**
 * What each seat has put on the record, as functions over the Hub instance (claim/seat-performance, swarm-000525-jcz8).
 *
 * Liveness is a heartbeat: a seat that loops on local tools reads "active" for as long as it runs, so room_status could
 * say a seat is alive but never what it has produced. Across 57 concluded board-using rooms only 10 of 372 agent worker
 * seats (2.7%) left no evidence, verify, proposal or challenge, so nothing here removes a seat: the record makes such a
 * seat visible, tells it once, opens the removal vote itself if nothing follows (7 of the 9 votes on record were opened
 * by the human, none for work), and gives every kick vote the hub's numbers instead of the accuser's word. Everything is derived from room state, so a replay rebuilds it.
 */
import type { Hub } from "../hub.js";
import { coordinates } from "./keys.js";
import { claimReleased } from "./board.js";
import { openKickByHub, reevaluateOpenKicks } from "./kick.js";
import type { Participant, Proposal, Room } from "./types.js";

/** In the room this long with nothing on the record before a worker is listed (the stale-claim and suspected-dead window). */
/** An unset, empty or malformed value keeps the default: "" would read as 0 (everyone listed at once) and "2m" as NaN (silently off). */
export const windowMs = (raw: string | undefined, fallback: number) => { const v = Number(raw); return raw?.trim() && Number.isFinite(v) && v > 0 ? v : fallback; };
export const NO_OUTPUT_MS = windowMs(process.env.CHATROOM_NO_OUTPUT_MS, 10 * 60_000);
/** The same for a worker that holds a claim: a builder's commits never reach the hub, so a claim buys time, not immunity.
 * Replayed over 62 past rooms (392 worker seats): one 10 min window warns 61 seats of which 54 delivered minutes later;
 * 10 min unclaimed / 45 min claimed, with two delivering witnesses, warns 14, of which 3 never delivered and 11 delivered
 * a median 12 min later. */
export const NO_OUTPUT_CLAIMED_MS = windowMs(process.env.CHATROOM_NO_OUTPUT_CLAIMED_MS, 45 * 60_000);
/** Told, and still nothing this much later: the hub opens the vote. Two windows, not one: in the same replay 14 seats are
 * warned under the final rule (11 delivered later, 3 never); a vote one window after the warning would open on 10 of them,
 * 7 of whom delivered later, two windows after on 6: the 3 that never delivered and 3 that did (theirs is withdrawn). */
export const VOTE_AFTER_MS = 2 * NO_OUTPUT_MS;

export interface SeatOutput { claims: number; evidence: number; verifies: number; proposals: number; challenges: number; age_seconds: number | null }

/** Board keys that coordinate rather than deliver: a claim is a promise, a hold is a switch, and inbox/* is another room's
 * note or its ack (its author is a name from that room, which a seat here may share). */
// (the list lives in keys.ts, shared with open-work, work and the scrutiny check, so a new reserved prefix is added once)
/** Shorter than this an entry is a placeholder: one character must not clear a seat. */
const MIN_ENTRY_CHARS = 40;

export function seatOutput(room: Room, p: Participant, observedAt = Date.now()): SeatOutput {
  const out: SeatOutput = { claims: 0, evidence: 0, verifies: 0, proposals: 0, challenges: 0, age_seconds: null };
  let last = 0;
  const seen = (ts: string) => { last = Math.max(last, Date.parse(ts) || 0); };
  for (const [key, e] of room.board) {
    if (e.by !== p.name) continue;
    if (key.startsWith("claim/")) { out.claims++; continue; }
    if (coordinates(key) || e.text.trim().length < MIN_ENTRY_CHARS) continue;
    if (key.startsWith("verify/") || key.startsWith("review/")) out.verifies++;
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
export const hasDelivered = (room: Room, p: Participant) => delivered(seatOutput(room, p));
const agents = (hub: Hub, room: Room) => hub.activeParticipants(room).filter((p) => p.agent !== "human" && p.role !== "chair");

/** Workers in an open room past their window with nothing delivered, while at least two other agent seats, and more than
 * half of them, have delivered something: in a room that does not work on the record an empty record says nothing about
 * a seat, and one peer's entry is not a room's habit. The verifier counts as a witness but is never listed: it waits for
 * work by design. Humans and the chair steer. */
export function noOutput(hub: Hub, room: Room, observedAt = Date.now()): Participant[] {
  // nor while the room is held: nobody is expected to deliver under a hold
  if (room.state === "concluded" || room.state === "closed" || hub.hold(room)) return [];
  const seats = agents(hub, room).map((p) => { const o = seatOutput(room, p, observedAt); return { p, done: delivered(o), window: windowFor(o) }; });
  return seats.filter((w) => {
    if (w.done || w.p.role === "verifier" || observedAt - Date.parse(w.p.joinedAt) < w.window) return false;
    const others = seats.filter((o) => o.p.id !== w.p.id);
    const done = others.filter((o) => o.done).length;
    return done >= 2 && done * 2 > others.length;
  }).map((w) => w.p);
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const WARNED = "you have put nothing on the record";

/** The hub's line to a seat, by the name the room sees; the line itself is the receipt, so a replay does not repeat it. */
const warningTo = (hub: Hub, room: Room, p: Participant) => `@${hub.shown(room, p)} ${WARNED}`;
const warning = (hub: Hub, room: Room, p: Participant) => room.messages.find((m) => m.from.id === "system" && m.content.startsWith(warningTo(hub, room, p)));

/** What room_status lists: seats the hub has already told, so nobody is listed (or voted on) before they were warned. */
export function listedNoOutput(hub: Hub, room: Room, observedAt = Date.now()): Participant[] {
  return noOutput(hub, room, observedAt).filter((p) => warning(hub, room, p));
}

/** Tell each such seat once, in the room, where its peers can see it; two further windows later, open the vote. */
export function warnNoOutput(hub: Hub, room: Room): void {
  reevaluateOpenKicks(hub, room); // withdraws a hub-opened vote whose target has delivered
  for (const p of noOutput(hub, room)) {
    const warned = warning(hub, room, p);
    if (warned) {
      // still nothing two further windows after being told: the hub opens the vote, once, and seats only ballot
      if (Date.now() - Date.parse(warned.ts) >= VOTE_AFTER_MS) openKickByHub(hub, room, p, "nothing on the record, and nothing since the hub said so");
      continue;
    }
    const o = seatOutput(room, p);
    // kind "chat", not "system": only a chat line carries its @-mention as an owed ask, so it reaches a seat held in a wait (see board.ts, reviewer notice)
    hub.post(room, "chat", undefined,
      `${warningTo(hub, room, p)} of this room in ${Math.round(windowFor(o) / 60_000)} min: no board entry, verify, proposal or challenge, while most seats have` +
      `${o.claims ? `, and you hold ${n(o.claims, "claim")}. Work on your branch is invisible here until you say where it stands` : ""}. ` +
      `room_status now lists you under no_output and a kick vote would quote that. Put what you have on the board (a partial finding counts; votes and chat do not), ` +
      `or hand your area over (handoff/<area>) and leave_room with the reason.`);
  }
}

/** One line of the hub's own numbers for a kick vote, so ballots are cast on the record. Empty for a verifier: it waits for
 * work by design, so its zeros would read as a verdict they are not. */
export function outputLine(hub: Hub, room: Room, p: Participant): string {
  if (p.role === "verifier") return "";
  const o = seatOutput(room, p);
  return `Hub record for ${hub.shown(room, p)}: ${n(o.claims, "claim")}, ${n(o.evidence, "evidence entry", "evidence entries")}, ${n(o.verifies, "verify", "verifies")}, ` +
    `${n(o.proposals, "proposal")}, ${n(o.challenges, "challenge")}, ${n(p.messageCount, "chat message")}, ${Math.round((Date.now() - Date.parse(p.joinedAt)) / 60_000)} min in the room. `;
}

/** What a conclusion carries about the record behind it, the way it carries unresolved objections: reported, never refused. */
export interface ConclusionOutput { agreed_without_output: string[]; undelivered_claims: { key: string; by: string }[] }

/** Workers whose agree counted with nothing of their own on the record (5 seats over 57 concluded rooms), and claim/*
 * entries whose owner put no evidence or verify on the board and wrote no proposal (10 of 271 claimants). A released claim, and one whose
 * area has a handoff/<area>, has been passed on and is not listed. */
export function conclusionOutput(hub: Hub, room: Room, pr: Proposal): ConclusionOutput {
  const measured = (p: Participant) => p.agent !== "human" && (p.role ?? "worker") !== "chair" && p.role !== "verifier";
  const agreed_without_output = hub.electorate(room, pr).members
    .filter((p) => measured(p) && pr.votes[p.id]?.vote === "agree" && !delivered(seatOutput(room, p))).map((p) => hub.shown(room, p));
  const undelivered_claims: ConclusionOutput["undelivered_claims"] = [];
  for (const [key, e] of room.board) {
    if (!key.startsWith("claim/") || !e.text.trim() || claimReleased(e) || room.board.has(`handoff/${key.slice("claim/".length)}`)) continue;
    const owner = [...room.participants.values()].find((p) => p.name === e.by);
    if (owner && !measured(owner)) continue;
    if ([...room.board].some(([k, o]) => o.by === e.by && !coordinates(k))) continue;
    // a proposal is delivery: the builder of a small fix often commits and proposes with no finding on the board
    // (swarm-082539-kns2 dev rooms swarm-084332-n0je and swarm-084600-o53f named the author of the concluded proposal)
    if ([...room.proposals.values()].some((x) => x.by.name === e.by)) continue;
    undelivered_claims.push({ key, by: owner ? hub.shown(room, owner) : e.by });
  }
  return { agreed_without_output, undelivered_claims };
}

/** The clauses the conclusion line gains, each only when it has something to say. */
export function conclusionOutputLines(o: ConclusionOutput): string {
  return (o.agreed_without_output.length ? `\nAgreed with nothing on the record: ${o.agreed_without_output.join(", ")}` : "") +
    (o.undelivered_claims.length ? `\nClaimed, nothing delivered: ${o.undelivered_claims.map((c) => `${c.key} (${c.by})`).join(", ")}` : "");
}
