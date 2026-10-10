/** What an idle seat could pick up, read from the board the hub already holds: a wait that returns nothing names it
 * instead of only saying "wait again". Nothing here is owed (asks, votes and challenges outrank it) and nothing is enforced. */
import type { Hub } from "../hub.js";
import { claimReleased } from "./board.js";
import type { BoardEntry, Participant, Room } from "./types.js";

export const IDLE_HINT = "No new messages yet. Call wait_for_messages again.";

export interface OpenWork {
  /** review_owed: the hub assigned this seat the review and it has written no verify/*. unreviewed: nobody has, and the
   * assigned reviewer is gone (or this seat is the verifier). own_claim_empty: this seat's claim has nothing behind it.
   * claim_orphaned: the owner left and this seat may take it over now. help_wanted: an open help/* or join-request/*. */
  kind: "review_owed" | "unreviewed" | "own_claim_empty" | "claim_orphaned" | "help_wanted";
  key: string;
  owner?: string;
}

/** Board prefixes that are requests or bookkeeping, not work a claim's owner has produced. */
const NOT_WORK = ["claim/", "help/", "join-request/", "inbox/", "hold/", "verify/"];
/** Board prefixes where an entry about an area is not a review of it. */
const NOT_REVIEW = ["claim/", "help/", "join-request/", "inbox/", "hold/", "handoff/", "draft/"];
const HINT_ITEMS = 3;

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

/** `idle`: the seat was already idle on its previous wait (idleAgain). Only then is its own claim with nothing behind it
 * listed, since that is also what a builder between commits looks like. */
export function openWork(hub: Hub, room: Room, p: Participant, idle = true): OpenWork[] {
  if (room.state !== "open" || p.agent === "human") return [];
  const entries = [...room.board.entries()].filter(([, e]) => e.text.trim());
  const area = (key: string) => key.slice(key.indexOf("/") + 1);
  const shownName = (name: string) => {
    const who = [...room.participants.values()].find((x) => x.name === name);
    return who ? hub.shown(room, who) : name;
  };
  const hasWork = (name: string) => entries.some(([k, e]) => e.by === name && !NOT_WORK.some((pre) => k.startsWith(pre)));
  /** A claim counts as reviewed by `by` (anyone but its owner when omitted) once that seat has put a review where the
   * room can read it: a board entry outside claim/ whose key is the claim's area or whose text names the area, the
   * claim, or the owner's branch, or a chat message since the claim that names the area. Reviews land in verify/*, in
   * review/* and in plain chat; asking for one that is already there is noise a seat learns to skip. */
  const reviewed = (claimKey: string, claim: BoardEntry, by?: string) => {
    const slug = area(claimKey);
    const word = new RegExp(`(^|[^a-z0-9])${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
    const mine = (name: string) => name !== claim.by && (by === undefined || name === by);
    if (entries.some(([k, e]) => mine(e.by) && !NOT_REVIEW.some((pre) => k.startsWith(pre)) && !k.endsWith(".partial") &&
      (area(k) === slug || word.test(e.text) || (!!claim.workspace?.branch && e.text.includes(claim.workspace.branch))))) return true;
    return room.messages.some((m) => m.kind === "chat" && m.from.agent !== "hub" && mine(m.from.name) && m.ts >= claim.updatedAt && word.test(m.content));
  };

  const review: OpenWork[] = [], own: OpenWork[] = [], orphaned: OpenWork[] = [], help: OpenWork[] = [];
  for (const [k, e] of entries) {
    if (k.startsWith("help/") || k.startsWith("join-request/")) {
      if (e.by !== p.name) help.push({ kind: "help_wanted", key: k, owner: shownName(e.by) });
      continue;
    }
    if (!k.startsWith("claim/") || claimReleased(e)) continue;
    if (e.by === p.name) {
      if (idle && !hasWork(p.name)) own.push({ kind: "own_claim_empty", key: k });
      continue;
    }
    if (hub.claimTakeover(room, e, p)) { orphaned.push({ kind: "claim_orphaned", key: k, owner: shownName(e.by) }); continue; }
    if (!hasWork(e.by)) continue;
    const mine = e.reviewerId === p.id;
    if (mine && !reviewed(k, e, p.name)) {
      review.push({ kind: "review_owed", key: k, owner: shownName(e.by) });
    } else if (!mine && !reviewed(k, e) &&
      (p.role === "verifier" || (!!e.reviewerId && !room.participants.get(e.reviewerId)?.active))) {
      review.push({ kind: "unreviewed", key: k, owner: shownName(e.by) });
    }
  }
  return [...review, ...orphaned, ...own, ...help];
}

function describe(w: OpenWork): string {
  const slug = w.key.slice(w.key.indexOf("/") + 1);
  switch (w.kind) {
    case "review_owed": return `you are the assigned reviewer of ${w.owner}'s ${w.key} and have posted no review of it: exercise their work and write verify/${slug}`;
    case "unreviewed": return `${w.owner}'s ${w.key} has work on the board and nobody has reviewed it: exercise it and write verify/${slug}`;
    case "claim_orphaned": return `${w.owner} left holding ${w.key}: you may take it over now (board_set ${w.key}; read handoff/${slug} first if it exists)`;
    case "own_claim_empty": return `your ${w.key} has nothing on the board behind it: post what you have found or built, or release the claim`;
    case "help_wanted": return `${w.owner} asked for help in ${w.key} (board_get it)`;
  }
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
