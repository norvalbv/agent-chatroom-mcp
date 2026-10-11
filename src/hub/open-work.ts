/** What an idle seat could pick up, read from the board the hub already holds: a wait that returns nothing names it
 * instead of only saying "wait again". Nothing here is owed (asks, votes and challenges outrank it) and nothing is enforced. */
import type { Hub } from "../hub.js";
import { COORDINATION_PREFIXES } from "./keys.js";
import { claimReleased } from "./board.js";
import type { BoardEntry, Participant, Room } from "./types.js";

export const IDLE_HINT = "No new messages yet. Call wait_for_messages again.";

export interface OpenWork {
  /** review_owed: the hub assigned this seat the review and it has written no verify/*. unreviewed: nobody has, and the
   * assigned reviewer is gone (or this seat is the verifier). own_claim_empty: this seat's claim has nothing behind it.
   * claim_orphaned: the owner left and this seat may take it over now. help_wanted: an open help/* or join-request/*.
   * idea_unclaimed: an idea/<slug> nobody holds claim/<slug> for, shown only to a seat with nothing of its own in flight.
   * idea_no_free_seat: the same idea while every worker holds a live claim, shown only to its author: a hand is added
   * with request_agent or the idea is dropped (brief item 2 of swarm-003601-tky5; idea/unowned-work-no-free-seat). */
  kind: "review_owed" | "unreviewed" | "own_claim_empty" | "claim_orphaned" | "help_wanted" | "idea_unclaimed" | "idea_no_free_seat";
  key: string;
  owner?: string;
  /** idea_no_free_seat: how many workers there are, every one holding a live claim */
  workers?: number;
}

/** Board prefixes that are requests or bookkeeping, not work a claim's owner has produced. */
const NOT_WORK = [...COORDINATION_PREFIXES, "help/", "join-request/", "verify/", "review/", "idea/"];
/** Board prefixes where an entry about an area is not a review of it. */
const NOT_REVIEW = [...COORDINATION_PREFIXES, "help/", "join-request/", "handoff/", "draft/"];
const HINT_ITEMS = 3;
/** An idea its author has already ruled on, by the words this room's board used (review/unclaimed-ideas). */
const IDEA_SETTLED = /^\s*(rejected|dropped|withdrawn|built|merged|done)\b/i;

/** The last idle wait each seat was handed: when, and how much it had said by then. */
const lastIdle = new WeakMap<Participant, { at: number; said: number }>();

/** True when this idle wait directly follows another with nothing between them: no message sent and no local tool call
 * heartbeated (a builder mid-task peeks at the room between steps; that is not idleness). Seats with no heartbeat are
 * judged on the two waits alone. Call once per idle wait. */
export function idleAgain(p: Participant): boolean {
  const prev = lastIdle.get(p);
  lastIdle.set(p, { at: Date.now(), said: p.messageCount });
  if (!prev || prev.said !== p.messageCount) return false;
  return !(p.activity ?? []).some((a) => Date.parse(a.at) > prev.at && !/wait_for_messages/.test(a.tool));
}

const area = (key: string) => key.slice(key.indexOf("/") + 1);

/** A claim counts as reviewed once any seat but its owner has put a review where the room can read it: a board entry
 * outside claim/ whose key is the claim's area or whose text names the area, the claim, or the owner's branch, or a
 * chat message since the claim that names the area. Reviews land in verify/*, in review/* and in plain chat, and often
 * from a seat other than the assigned reviewer; asking for one that is already there is noise a seat learns to skip
 * (replay of 116 long idle runs: 15 of 23 review_owed hits). */
function reviewedClaim(room: Room, claimKey: string, claim: BoardEntry): boolean {
  const slug = area(claimKey);
  const word = new RegExp(`(^|[^a-z0-9])${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
  const other = (name: string) => name !== claim.by;
  for (const [k, e] of room.board) {
    if (!e.text.trim() || !other(e.by) || NOT_REVIEW.some((pre) => k.startsWith(pre)) || k.endsWith(".partial")) continue;
    if (area(k) === slug || word.test(e.text) || (!!claim.workspace?.branch && e.text.includes(claim.workspace.branch))) return true;
  }
  return room.messages.some((m) => m.kind === "chat" && m.from.agent !== "hub" && other(m.from.name) && m.ts >= claim.updatedAt && word.test(m.content));
}

/** This seat's claims whose work is still in flight: not released, not marked finished, and not yet reviewed by anyone
 * else. A seat holding one may be waiting on its own long job (a soak, a test suite), which looks like polling. */
/** Live claims this seat was assigned to review and has not seen reviewed yet, whether or not their work has landed:
 * a reviewer whose duty is still coming is not free (dev room swarm-005845-4g7o-room). */
function reviewsComing(room: Room, p: Participant): string[] {
  return [...room.board.entries()].filter(([k, e]) => k.startsWith("claim/") && e.reviewerId === p.id && e.by !== p.name && e.text.trim() &&
    !claimReleased(e) && !settled(e) && [...room.participants.values()].some((x) => x.name === e.by && x.active) &&
    !reviewedClaim(room, k, e)).map(([k]) => k);
}

function claimsInFlight(room: Room, p: Participant): string[] {
  return [...room.board.entries()].filter(([k, e]) => k.startsWith("claim/") && e.by === p.name && e.text.trim() &&
    !claimReleased(e) && !settled(e) && !reviewedClaim(room, k, e)).map(([k]) => k);
}

/** Enumerated items in a chat message: "(1) ... (2) ..." or lines starting "1." / "2)". Two or more distinct numbers
 * make a list; one marker is a reference ("point (2) above"). */
export function listedItems(content: string): number {
  const nums = new Set<string>();
  for (const m of content.matchAll(/\((\d{1,2})\)/g)) nums.add(m[1]);
  for (const m of content.matchAll(/(?:^|\n)\s*(\d{1,2})[.)]\s/g)) nums.add(m[1]);
  return nums.size >= 2 ? nums.size : 0;
}

const nudgedAt = new WeakMap<Participant, string>();

/** The line a list in chat gets back: once, then not again until the seat has written an idea/* entry since. A list left
 * in chat is owed by nobody; on idea/<slug> it is named to free seats until someone claims it (idea_unclaimed). */
export function ideaListHint(room: Room, p: Participant, content: string, quiet: boolean): string | undefined {
  const n = quiet || p.agent === "human" || room.state !== "open" ? 0 : listedItems(content);
  if (!n) return undefined;
  const last = nudgedAt.get(p);
  if (last && ![...room.board.entries()].some(([k, e]) => k.startsWith("idea/") && e.by === p.name && e.updatedAt > last)) return undefined;
  nudgedAt.set(p, new Date().toISOString());
  return `You listed ${n} items. Each one you are not building now goes on idea/<slug> (one entry per idea: the flaw, the design, the evidence), ` +
    "so others can attack it on attack/idea/<slug> and a free seat can claim it; a list left in chat is owed by nobody.";
}

/** How many idle waits running (about one a minute) before a seat with nothing open is offered the door; 0 turns it off.
 * src/seat.ts hands a harnessed seat off after handoffIdleTurns with nothing actionable; a Claude Code seat has no
 * harness, so the hub is the only place that can say it. */
export const idlePolicy = { leaveWaits: Number(process.env.CHATROOM_IDLE_LEAVE_WAITS ?? 8) };

/** The same stretch of nothing, counted in this connection's waits: leaveWaits assumes a wait a minute, and a held
 * connection's empty wait lasts minutes (src/env.ts seatHoldMs), so 8 of those would be half an hour (review/2ee29335). */
export function leaveWaitsFor(holdMs?: number): number {
  const n = idlePolicy.leaveWaits;
  return n && holdMs && holdMs > 55_000 ? Math.max(2, Math.round((n * 55_000) / holdMs)) : n;
}

const streaks = new WeakMap<Participant, number>();

/** Length of this seat's current run of idle waits, given idleAgain()'s verdict for this one. Call once per idle wait. */
export function idleStreak(p: Participant, again: boolean): number {
  const n = again ? (streaks.get(p) ?? 1) + 1 : 1;
  streaks.set(p, n);
  return n;
}

/** Whether this idle wait carries the offer: every leaveWaits-th of a run, to a worker with nothing open while no
 * proposal is open (a vote is owed or about to be), never to a seat whose own claim is unreviewed (dev room
 * swarm-004642-76kz-room: the offer reached a seat polling while its own 6-minute soak ran), and never to the verifier,
 * lead or chair, whom the room needs at the end. */
export function offersLeave(room: Room, p: Participant, streak: number, work: OpenWork[], n = idlePolicy.leaveWaits): boolean {
  if (!n || work.length || streak < n || streak % n !== 0 || room.state !== "open" || p.agent === "human") return false;
  if (p.role === "verifier" || p.role === "lead" || p.role === "chair") return false;
  if (claimsInFlight(room, p).length || reviewsComing(room, p).length) return false;
  return ![...room.proposals.values()].some((pr) => pr.status === "open");
}

export function leaveHint(room: Room, p: Participant, streak: number): string {
  const mine = [...room.board.entries()].filter(([k, e]) => k.startsWith("claim/") && e.by === p.name && e.text.trim() && !claimReleased(e)).map(([k]) => k);
  const handoff = mine.length ? `write handoff/${mine[0].slice("claim/".length)} (what is done, where it is, what is not), then leave_room with a reason`
    : "leave_room with a reason saying what you finished and where it is";
  return `No new messages on ${streak} waits running, and the hub sees nothing open for you. Each empty wait costs a full turn. ` +
    `If your work is on the board, ${handoff}: leaving blocks nothing here and a successor can be recruited if you are needed. ` +
    "If you are waiting on someone, say whom and for what in one line, so the room can see it, and carry on waiting.";
}

/** Text names this board key whole: "claim/abc", "claim/ab/part" and "claim/ab.v2" do not name claim/ab, while the full
 * stop or colon that ends a sentence after it does not hide it (a substring match read a longer claim's result as the
 * shorter claim's, merge-review backlog B9b). */
export function namesKey(text: string, key: string): boolean {
  return new RegExp(`(?<![\\w./:-])${key.replace(/[.\\^$*+?()[\]{}|]/g, "\\$&")}(?![\\w/-]|[.:]\\w)`).test(text);
}

/** `idle`: the seat was already idle on its previous wait (idleAgain). Only then is its own claim with nothing behind it
 * listed, since that is also what a builder between commits looks like. */
export function openWork(hub: Hub, room: Room, p: Participant, idle = true): OpenWork[] {
  if (room.state !== "open" || p.agent === "human") return [];
  const entries = [...room.board.entries()].filter(([, e]) => e.text.trim());
  const shownName = (name: string) => {
    const who = [...room.participants.values()].find((x) => x.name === name);
    return who ? hub.shown(room, who) : name;
  };
  const hasWork = (name: string) => entries.some(([k, e]) => e.by === name && !NOT_WORK.some((pre) => k.startsWith(pre)));
  const reviewed = (claimKey: string, claim: BoardEntry) => reviewedClaim(room, claimKey, claim);

  const review: OpenWork[] = [], own: OpenWork[] = [], orphaned: OpenWork[] = [], help: OpenWork[] = [], ideas: OpenWork[] = [], myIdeas: string[] = [];
  for (const [k, e] of entries) {
    if (k.startsWith("idea/")) {
      const claim = room.board.get(`claim/${area(k)}`);
      if ((!claim?.text.trim() || claimReleased(claim)) && !IDEA_SETTLED.test(e.text) && !settled(e)) {
        ideas.push({ kind: "idea_unclaimed", key: k, owner: shownName(e.by) });
        if (e.by === p.name) myIdeas.push(k);
      }
      continue;
    }
    if (k.startsWith("help/") || k.startsWith("join-request/")) {
      if (e.by !== p.name) help.push({ kind: "help_wanted", key: k, owner: shownName(e.by) });
      continue;
    }
    if (!k.startsWith("claim/") || claimReleased(e) || settled(e)) continue;
    if (e.by === p.name) {
      // work that lives in git and that a peer has already reviewed is not an empty claim
      if (idle && !hasWork(p.name) && !reviewed(k, e)) own.push({ kind: "own_claim_empty", key: k });
      continue;
    }
    if (hub.claimTakeover(room, e, p)) {
      // a departed owner who posted its result (result/<area>, or a result/* naming the claim) and left no handoff/<area>
      // finished it: nothing there to take over
      // (swarm-003601-tky5: the usage limit stopped three seats whose work was merged, and every idle wait then named up
      // to twelve such claims, friction/orphaned-finished-claims). A handoff says something is left, so it is still named.
      const slug = area(k);
      const finished = entries.some(([rk, re]) => re.by === e.by && rk.startsWith("result/") &&
        (rk === `result/${slug}` || rk.startsWith(`result/${slug}-`) || namesKey(re.text, k))) && !room.board.get(`handoff/${slug}`)?.text.trim();
      if (!finished) orphaned.push({ kind: "claim_orphaned", key: k, owner: shownName(e.by) });
      continue;
    }
    if (!hasWork(e.by)) continue;
    const mine = e.reviewerId === p.id;
    if (mine && !reviewed(k, e)) {
      review.push({ kind: "review_owed", key: k, owner: shownName(e.by) });
    } else if (!mine && !reviewed(k, e) &&
      (p.role === "verifier" || (!!e.reviewerId && !room.participants.get(e.reviewerId)?.active))) {
      review.push({ kind: "unreviewed", key: k, owner: shownName(e.by) });
    }
  }
  // the request side of a blackboard (sources/2510.01285): an unbuilt idea is work only for a seat free to take it, so a
  // seat with a live claim of its own is not pulled off it
  const holds = (name: string) => entries.some(([k, e]) => k.startsWith("claim/") && e.by === name && !claimReleased(e) && !settled(e));
  const free = !holds(p.name);
  // Unowned work and no free seat, both stated as fact, is what preceded this room's recruiting (#25, #28 there); a seat
  // never weighed it unprompted (3% of Claude seat-rooms recruited, evidence/recruiting-never-used). Told to the idea's
  // author only, so one seat adds a hand, not every busy seat at once. The verifier, a lead and the chair are not workers.
  const workers = hub.activeParticipants(room).filter((x) => x.agent !== "human" && !["verifier", "lead", "chair"].includes(x.role ?? "worker"));
  const noneFree = !free && workers.length > 0 && workers.every((x) => holds(x.name));
  const recruit: OpenWork[] = noneFree ? myIdeas.map((key) => ({ kind: "idea_no_free_seat" as const, key, workers: workers.length })) : [];
  return [...review, ...orphaned, ...own, ...help, ...recruit, ...(free ? ideas : [])];
}

function describe(w: OpenWork): string {
  const slug = w.key.slice(w.key.indexOf("/") + 1);
  switch (w.kind) {
    case "review_owed": return `you are the assigned reviewer of ${w.owner}'s ${w.key} and have posted no review of it: exercise their work and write verify/${slug}`;
    case "unreviewed": return `${w.owner}'s ${w.key} has work on the board and nobody has reviewed it: exercise it and write verify/${slug}`;
    case "claim_orphaned": return `${w.owner} left holding ${w.key}: you may take it over now (board_set ${w.key}; read handoff/${slug} first if it exists)`;
    case "own_claim_empty": return `your ${w.key} has nothing on the board behind it: post what you have found or built, or release the claim`;
    case "help_wanted": return `${w.owner} asked for help in ${w.key} (board_get it)`;
    case "idea_no_free_seat": return `your ${w.key} has no owner and all ${w.workers} workers hold a claim: request_agent(area="${slug}", brief=<what it is and what done looks like; it may just say board_get ${w.key}>) adds a seat for it, or write one line on ${w.key} saying why it is dropped`;
    case "idea_unclaimed": return `${w.owner}'s ${w.key} is unbuilt and nobody holds claim/${slug}: board_get it, then claim/${slug} and start, or say in one line why it should not be built`;
  }
}

/** A claim whose own JSON status says the work is finished: nothing about it is open, whoever holds it. */
function settled(e: BoardEntry): boolean {
  try { return /^(verified|fixed|merged|done|complete|closed)/i.test(String((JSON.parse(e.text) as { status?: unknown }).status ?? "")); } catch { return false; }
}

const lastNamed = new WeakMap<Participant, string>();

/** The list as `kind:key` strings when it differs from what this seat was last shown; null when it is the same list
 * (or empty). The full list travels, and is logged, only on a change: an idle seat polls every 55 s and an unchanged
 * list resent each time is context paid for nothing and a line seats learn to skim. Call once per idle wait. */
export function newlyNamed(p: Participant, work: OpenWork[]): string[] | null {
  const items = work.map((w) => `${w.kind}:${w.key}`);
  const sig = items.join("\n");
  if (lastNamed.get(p) === sig) return null;
  lastNamed.set(p, sig);
  return items.length ? items : null;
}

/** The short line for a list this seat has already been shown in full. */
export function stillOpenHint(work: OpenWork[]): string {
  return `No new messages. The ${work.length} open item(s) named to you earlier ${work.length === 1 ? "is" : "are"} still open (first: ${work[0].key}).`;
}

/** The idle line with the first few items in it; the plain line when there is nothing to name. */
export function idleHint(work: OpenWork[]): string {
  if (!work.length) return IDLE_HINT;
  const shown = work.slice(0, HINT_ITEMS).map((w, i) => `(${i + 1}) ${describe(w)}`).join("; ");
  const rest = work.length > HINT_ITEMS ? ` (${work.length - HINT_ITEMS} more in this reply's open_work)` : "";
  return `No new messages. Open work the hub can see for you: ${shown}${rest}. Take one now and say which in one line so nobody duplicates it; ` +
    "if you are mid-task, carry on and ignore this.";
}
