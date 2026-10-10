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
const HINT_ITEMS = 3;

export function openWork(hub: Hub, room: Room, p: Participant): OpenWork[] {
  if (room.state !== "open" || p.agent === "human") return [];
  const entries = [...room.board.entries()].filter(([, e]) => e.text.trim());
  const area = (key: string) => key.slice(key.indexOf("/") + 1);
  const shownName = (name: string) => {
    const who = [...room.participants.values()].find((x) => x.name === name);
    return who ? hub.shown(room, who) : name;
  };
  const hasWork = (name: string) => entries.some(([k, e]) => e.by === name && !NOT_WORK.some((pre) => k.startsWith(pre)));
  const verifies = entries.filter(([k]) => k.startsWith("verify/") && !k.endsWith(".partial"));
  /** A verify/* entry covers a claim when its key is the claim's area, or it names the area, the owner or the owner's branch. */
  const covers = (claimKey: string, claim: BoardEntry) => ([k, v]: [string, BoardEntry]) => {
    const text = `${k}\n${v.text}`;
    return v.by !== claim.by && (area(k) === area(claimKey) || text.includes(area(claimKey)) || text.includes(claim.by) ||
      (!!claim.workspace?.branch && text.includes(claim.workspace.branch)));
  };

  const review: OpenWork[] = [], own: OpenWork[] = [], orphaned: OpenWork[] = [], help: OpenWork[] = [];
  for (const [k, e] of entries) {
    if (k.startsWith("help/") || k.startsWith("join-request/")) {
      if (e.by !== p.name) help.push({ kind: "help_wanted", key: k, owner: shownName(e.by) });
      continue;
    }
    if (!k.startsWith("claim/") || claimReleased(e)) continue;
    if (e.by === p.name) {
      if (!hasWork(p.name)) own.push({ kind: "own_claim_empty", key: k });
      continue;
    }
    if (hub.claimTakeover(room, e, p)) { orphaned.push({ kind: "claim_orphaned", key: k, owner: shownName(e.by) }); continue; }
    if (!hasWork(e.by)) continue;
    const mine = e.reviewerId === p.id;
    if (mine && !verifies.some((v) => v[1].by === p.name && covers(k, e)(v))) {
      review.push({ kind: "review_owed", key: k, owner: shownName(e.by) });
    } else if (!mine && !verifies.some(covers(k, e)) &&
      (p.role === "verifier" || (!!e.reviewerId && !room.participants.get(e.reviewerId)?.active))) {
      review.push({ kind: "unreviewed", key: k, owner: shownName(e.by) });
    }
  }
  return [...review, ...orphaned, ...own, ...help];
}

function describe(w: OpenWork): string {
  const slug = w.key.slice(w.key.indexOf("/") + 1);
  switch (w.kind) {
    case "review_owed": return `you are the assigned reviewer of ${w.owner}'s ${w.key} and have written no verify/${slug}: exercise their work and write it`;
    case "unreviewed": return `${w.owner}'s ${w.key} has work on the board and no verify/* entry from anyone: review it and write verify/${slug}`;
    case "claim_orphaned": return `${w.owner} left holding ${w.key}: you may take it over now (board_set ${w.key}; read handoff/${slug} first if it exists)`;
    case "own_claim_empty": return `your ${w.key} has nothing on the board behind it: post what you have found or built, or release the claim`;
    case "help_wanted": return `${w.owner} asked for help in ${w.key} (board_get it)`;
  }
}

/** The idle line with the first few items in it; the plain line when there is nothing to name. */
export function idleHint(work: OpenWork[]): string {
  if (!work.length) return IDLE_HINT;
  const shown = work.slice(0, HINT_ITEMS).map((w, i) => `(${i + 1}) ${describe(w)}`).join("; ");
  const rest = work.length > HINT_ITEMS ? ` (${work.length - HINT_ITEMS} more in open_work)` : "";
  return `No new messages. Open work the hub can see for you: ${shown}${rest}. Take one now and say which in one line so nobody duplicates it; ` +
    "if you are mid-task, carry on and ignore this.";
}
