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

/**
 * The seat in this room that authored `commit`, read with git in `p`'s own worktree (seat commits carry the seat's name
 * as author, src/env.ts); undefined when the hub does not know p's worktree, git does not know the commit, or no seat
 * here has that name. Used by the review take rule and by the review notice (src/hub/board.ts).
 */
export function commitAuthor(hub: Hub, room: Room, p: Participant, commit: string): Participant | undefined {
  const worktree = hub.workspaceOf(p)?.worktree;
  if (!worktree) return undefined;
  const r = spawnSync("git", ["-C", worktree, "log", "-1", "--format=%an", `${commit}^{commit}`], { encoding: "utf8", timeout: 5000 });
  return r.status === 0 ? named(room, r.stdout.trim()) : undefined;
}

/** Words a take key spends on how, not what: a key that differs only by these, or by a seat's name, names the same work. */
const HOW_WORDS = new Set(["run", "rerun", "re", "job", "go", "now", "start", "my", "the", "do", "doing", "by", "task", "work"]);
/** A plural is not a difference: take/decode-takers and take/taker-decode were one piece taken twice, 3 s apart
 * (swarm-130459-mrw4-crypto, evidence/duplication). "ss" words (class, pass) and short words keep their s. */
const singular = (t: string) => (t.length > 3 && /[^s]s$/.test(t) ? t.slice(0, -1) : t);
/** The work a take (or a claim's area) names, as its sorted words without how-words and seat names; "" when nothing is left. */
export function workWords(room: Room, key: string): string {
  // a seat's name marks who, not what, only where keys put an owner: as the key's last words, or after "by"
  // (slow_count-bob, rerun/T-B3-4-by-break-claude-2). Anywhere else it is a word of the work: a fragment ("2" of
  // claude-opus-5-5-2) in take/arm-2 (review/3f330ea8), or "verifier" in take/verifier-gate-probe (review/3241ee07-opus1)
  let toks = key.replace(/^(take|claim)\//, "").toLowerCase().split(/[-/_.:\s]+/).filter(Boolean);
  const names = [...new Set([...room.participants.values()].map((x) => x.name.toLowerCase().split(/[-/_.:\s]+/).filter(Boolean)))].sort((a, b) => b.length - a.length);
  const at = (i: number, n: string[]) => n.every((t, j) => toks[i + j] === t);
  for (let changed = true; changed;) {
    changed = false;
    for (const n of names) {
      if (toks.length > n.length && at(toks.length - n.length, n)) { toks = toks.slice(0, toks.length - n.length); changed = true; break; }
      const by = toks.findIndex((t, i) => t === "by" && at(i + 1, n));
      if (by >= 0) { toks = [...toks.slice(0, by), ...toks.slice(by + 1 + n.length)]; changed = true; break; }
    }
  }
  return [...new Set(toks.filter((t) => !HOW_WORDS.has(t)).map(singular))].sort().join(" ");
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
  const refuse = (reason: "same-commit" | "assigned-reviewer" | "already-reviewed" | "same-work", commit: string, holder: Participant, message: string): never => {
    hub.persist({ type: "take", room: room.name, key, action: "refused", by: p.name, holder: holder.name, ts: new Date().toISOString(), reason, ...(commit ? { commit } : {}) });
    throw new HubError(message, undefined, "ownership");
  };
  // the same work under another spelling (the verifier's dev room swarm-210624-lnap: take/slow_count and
  // take/slow_count-run, two seats, the scorer ran twice). Equal words only, so a narrower key (slow_count-gpu) is other
  // work; across every room log this rule matched no pair of takes, so it should not refuse what was meant as different.
  const words = workWords(room, key);
  if (words && !commitsOf(key).length) {
    for (const [k, e] of room.board) {
      if (k === key || !k.startsWith("take/") || !e.text.trim() || commitsOf(k).length || workWords(room, k) !== words) continue;
      const holder = named(room, e.holder ?? e.by);
      if (!holder?.active || holder.id === w.holder.id) continue;
      refuse("same-work", "", holder, `"${key}" names the same work as "${k}", held by ${hub.shown(room, holder)} since ${e.updatedAt}: "${e.text.slice(0, 200)}". ` +
        `Ask them before doing it. If it is different work, use a key that says how it differs (e.g. ${k}-<what>).`);
    }
  }
  for (const commit of commitsOf(key)) {
    for (const [k, e] of room.board) {
      if (k === key || !k.startsWith("take/") || !e.text.trim() || kindOf(k) !== kindOf(key) || !commitsOf(k).some((c) => sameCommit(c, commit))) continue;
      const holder = named(room, e.holder ?? e.by);
      if (!holder?.active || holder.id === w.holder.id) continue;
      refuse("same-commit", commit, holder,
        `commit ${commit} is already taken: "${k}" is held by ${hub.shown(room, holder)} since ${e.updatedAt}: "${e.text.slice(0, 200)}". ` +
        `Ask them before doing it, or take something nobody holds (room_status lists each seat's holds).`);
    }
    if (!REVIEW_KIND.test(kindOf(key))) continue;
    // already reviewed by someone else: say so and name it, rather than pointing at a second review (arm room
    // swarm-192859-kneg: a seat refused for the assigned reviewer wrote review/<sha>-<name> on a commit already reviewed)
    const done = [...room.board].filter(([k, e]) => k.startsWith("review/") && e.text.trim() && e.by !== p.name && commitsOf(`take/${k}`).some((c) => sameCommit(c, commit)));
    if (done.length) {
      const [k, e] = done[0]!;
      const by = named(room, e.by) ?? p;
      refuse("already-reviewed", commit, by,
        `${commit} is already reviewed: ${k} by ${hub.shown(room, by)} at ${e.updatedAt}${done.length > 1 ? ` (and ${done.length - 1} more)` : ""}. Read it before doing another. ` +
        `If it missed something, tell ${hub.shown(room, by)} what; a second review of the same commit is worth writing only when you checked something it did not, and then it needs no take.`);
    }
    const author = commitAuthor(hub, room, p, commit);
    // the author's own takes pass, and so does a take the author hands to a seat: that is the author choosing its reviewer
    if (!author || author.id === w.holder.id || author.id === p.id) continue;
    const assigned = [...room.board].filter(([k, e]) => k.startsWith("claim/") && e.by === author.name && e.reviewerId && claimOpen(e))
      .map(([k, e]) => ({ key: k, reviewer: room.participants.get(e.reviewerId!) })).filter((x) => x.reviewer?.active);
    // the assigned reviewer takes it, or hands it on: in dev room swarm-183036-yisv the verifier could not delegate its own review
    if (!assigned.length || assigned.some((x) => x.reviewer!.id === w.holder.id || x.reviewer!.id === p.id)) continue;
    const a = hub.shown(room, author), who = [...new Set(assigned.map((x) => hub.shown(room, x.reviewer!)))];
    refuse("assigned-reviewer", commit, assigned[0]!.reviewer!,
      (assigned.length === 1
        ? `${who[0]} is the hub-assigned reviewer of ${a}'s "${assigned[0]!.key}", and ${commit} is ${a}'s commit. `
        : `${commit} is ${a}'s commit, and ${a}'s claims have hub-assigned reviewers: ${assigned.map((x) => `${hub.shown(room, x.reviewer!)} ("${x.key}")`).join(", ")}. `) +
      `Ask ${who.map((n) => `@${n}`).join(" or ")} whether they are on it before you start. ${a} or the assigned reviewer can also hand it to you (a take/ line starting with @${p.name}). If a second review is wanted, it needs no take: write it as review/${commit}-${p.name}.`);
  }
  return w;
}

/**
 * A take and a claim naming the same work (equal key words, src/hub/take.ts workWords): take/ and claim/ were never
 * compared, and in swarm-130459-mrw4-tennis take/data-feed-lag and claim/data-feed-lag were written 6 s apart by two
 * seats for one piece (evidence/duplication). Advisory, like the claim overlap notice: a claim is never refused for
 * overlap, and a take inside someone's area may be help. Take-vs-take is refused in commitTake; claim-vs-claim is board.ts noticeClaimOverlap.
 */
export function noticeSameWork(hub: Hub, room: Room, p: Participant, key: string) {
  const words = workWords(room, key);
  const mine = room.board.get(key);
  if (!words || commitsIn(key).length || !mine || (key.startsWith("claim/") && !claimOpen(mine))) return;
  const isTake = key.startsWith("take/");
  for (const [k, e] of room.board) {
    if (k.startsWith("take/") === isTake || !/^(take|claim)\//.test(k) || !e.text.trim() || (k.startsWith("claim/") && !claimOpen(e))) continue;
    const owner = [...room.participants.values()].filter((x) => x.name === (e.holder ?? e.by)).at(-1);
    if (!owner?.active || owner.id === p.id || (owner.session && p.session && owner.session === p.session) || workWords(room, k) !== words) continue;
    hub.persist({ type: "overlap_notice", room: room.name, key, other: k, by: p.name, other_by: owner.name, rule: "same-work", ts: new Date().toISOString() });
    hub.post(room, "chat", undefined,
      `@${p.name} your "${key}" names the same work as @${owner.name}'s "${k}". Before both of you do it: agree who does it, split it explicitly, or pick other work. Advisory only, both stand.`);
    return;
  }
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
