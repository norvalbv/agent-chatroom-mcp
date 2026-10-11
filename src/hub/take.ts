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
import { spawnSync } from "node:child_process";
import type { Hub } from "../hub.js";
import { commitsIn } from "./internal.js";
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
    hub.persist({ type: "take", room: room.name, key, action: "refused", by: p.name, holder: holder.name, ts: new Date().toISOString(), reason: "held" });
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
    if (target.id !== p.id) return commitTake(hub, room, p, key, { action: previous && mine && !previous.offeredBy ? "handover" : "offer", holder: target, offeredBy: p });
  }
  if (previous && mine) return { action: previous.offeredBy ? "accept" : "update", holder: p };
  return commitTake(hub, room, p, key, { action: "take", holder: p });
}

/** Commit tokens in a take's key, e.g. take/review-ba181129 and take/review/ba181129 both name ba181129. */
const commitsOf = (key: string) => commitsIn(key.slice("take/".length));
const sameCommit = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);
/** The kind of work a commit take names: its key without the commits and separators (take/review-<sha>, take/review/<sha> -> "review"). */
const kindOf = (key: string) => commitsOf(key).reduce((k, c) => k.split(c).join(""), key.slice("take/".length)).replace(/[^a-z0-9]+/gi, "").toLowerCase();
/** Kinds the assigned reviewer holds first: the review itself. A merge, a dev room or a rerun on the commit is other work (review/c11f3f22). */
const REVIEW_KIND = /review|verify/;
const claimOpen = (e: BoardEntry) => { try { return (JSON.parse(e.text) as { status?: string }).status !== "released"; } catch { return true; } };

/**
 * A new take whose key names a commit (swarm-180216-182a, decision/review-take). Twice in an hour two seats reviewed one
 * commit and the second learned it at its finished write: the same piece was spelled take/review/<sha> and
 * take/review-<sha>, and nothing tied a take to the reviewer the hub had assigned (all 6 assigned reviewers wrote their
 * review; both duplicates came from a seat that was not assigned). So, before the work:
 * - another active seat's take for the same kind of work on the same commit, however the key is spelled, refuses this
 *   one with its holder (a merge, a dev room or a rerun on a commit someone is reviewing is other work and passes);
 * - reviewing a commit authored by a seat whose live claim has an active hub-assigned reviewer is that reviewer's: any other
 *   holder is refused with who to ask. The author's own takes pass, as does a take the author hands to a seat, and a
 *   seat whose worktree the hub does not know (the commit's author cannot be read there). A second review needs no
 *   take: review/<sha>-<name>.
 */
function commitTake(hub: Hub, room: Room, p: Participant, key: string, w: TakeWrite): TakeWrite {
  if (p.agent === "human") return w;
  const refuse = (reason: "same-commit" | "assigned-reviewer", commit: string, holder: Participant, message: string): never => {
    hub.persist({ type: "take", room: room.name, key, action: "refused", by: p.name, holder: holder.name, ts: new Date().toISOString(), reason, commit });
    throw new HubError(message, undefined, "ownership");
  };
  for (const commit of commitsOf(key)) {
    for (const [k, e] of room.board) {
      if (k === key || !k.startsWith("take/") || !e.text.trim() || kindOf(k) !== kindOf(key) || !commitsOf(k).some((c) => sameCommit(c, commit))) continue;
      const holder = named(room, e.holder ?? e.by);
      if (!holder?.active || holder.id === w.holder.id) continue;
      refuse("same-commit", commit, holder,
        `commit ${commit} is already taken: "${k}" is held by ${hub.shown(room, holder)} since ${e.updatedAt}: "${e.text.slice(0, 200)}". ` +
        `Ask them before doing it, or take something nobody holds (room_status lists each seat's holds).`);
    }
    const worktree = hub.workspaceOf(p)?.worktree;
    if (!worktree || !REVIEW_KIND.test(kindOf(key))) continue;
    const r = spawnSync("git", ["-C", worktree, "log", "-1", "--format=%an", `${commit}^{commit}`], { encoding: "utf8", timeout: 5000 });
    const author = r.status === 0 ? named(room, r.stdout.trim()) : undefined;
    // the author's own takes pass, and so does a take the author hands to a seat: that is the author choosing its reviewer
    if (!author || author.id === w.holder.id || author.id === p.id) continue;
    const assigned = [...room.board].filter(([k, e]) => k.startsWith("claim/") && e.by === author.name && e.reviewerId && claimOpen(e))
      .map(([k, e]) => ({ key: k, reviewer: room.participants.get(e.reviewerId!) })).filter((x) => x.reviewer?.active);
    if (!assigned.length || assigned.some((x) => x.reviewer!.id === w.holder.id)) continue;
    const a = hub.shown(room, author), who = [...new Set(assigned.map((x) => hub.shown(room, x.reviewer!)))];
    refuse("assigned-reviewer", commit, assigned[0]!.reviewer!,
      (assigned.length === 1
        ? `${who[0]} is the hub-assigned reviewer of ${a}'s "${assigned[0]!.key}", and ${commit} is ${a}'s commit. `
        : `${commit} is ${a}'s commit, and ${a}'s claims have hub-assigned reviewers: ${assigned.map((x) => `${hub.shown(room, x.reviewer!)} ("${x.key}")`).join(", ")}. `) +
      `Ask ${who.map((n) => `@${n}`).join(" or ")} whether they are on it before you start. ${a} can also hand it to you (a take/ line starting with @${p.name}). If a second review is wanted, it needs no take: write it as review/${commit}-${p.name}.`);
  }
  return w;
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

/**
 * room_status, per seat: what it holds (its live claim/* entries and its take/* entries, so who holds what is one field
 * whichever prefix a seat picked: in review/take-keys two seats took ranges as claims and one took items as takes) and
 * the takes offered to it. Empty lists are left out.
 */
export function takesOf(room: Room, p: Participant, nm: (x: Participant) => string, claimLive: (e: BoardEntry) => boolean): { holds?: string[]; offered?: { key: string; by: string }[] } {
  const holds: string[] = [], offered: { key: string; by: string }[] = [];
  for (const [key, e] of room.board) {
    if (key.startsWith("claim/") && e.text.trim() && e.by === p.name && named(room, e.by)?.id === p.id && claimLive(e)) holds.push(key);
    if (!key.startsWith("take/") || !e.text.trim() || named(room, e.holder ?? e.by)?.id !== p.id) continue;
    const by = e.offeredBy ? named(room, e.offeredBy) : undefined;
    if (e.offeredBy) offered.push({ key, by: by ? nm(by) : e.offeredBy }); else holds.push(key);
  }
  return { ...(holds.length ? { holds } : {}), ...(offered.length ? { offered } : {}) };
}
