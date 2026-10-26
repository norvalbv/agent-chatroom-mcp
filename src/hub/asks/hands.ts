/**
 * Unowned work and no free seat: the hub asks someone who can add a hand (swarm-005940-77tu,
 * decision/hands-for-unowned-ideas; owner asks 1 and 8, the bottlenecks that never broke out and when to recruit).
 *
 * open-work.ts names this case as idea_no_free_seat, but only on an idle wait, only to the idea's author while it holds a
 * claim of its own (so is busy), and with a line ending "if you are mid-task, carry on and ignore this". Across 332 room
 * logs it fired 9 times in 5 rooms and no recruit followed within 30 minutes; 73 of 81 idea/* entries were never claimed
 * (evidence/bottlenecks-9f66). The idle seats it was written for never existed at that moment: every worker held a claim.
 *
 * So the periodic sweep asks once, after the condition has held for HANDS_AFTER_MS: an idea/<slug> with no live
 * claim/<slug> and no verdict in its own text, while every active worker holds a live claim. The ask @-names the idea's
 * author (the chair when the author has left), is tagged "hands", and is owed like a peer's ask: it stays the focused ask
 * after delivery and is steered into a busy seat's turn, until a reply or pass. It names three answers: recruit, claim it
 * for later, or drop it. hands_asked and hands_resolved (recruited / claimed / dropped / built) are logged; run-metrics
 * counts them.
 *
 * An unowned item/<slug> (src/hub/coverage/coverage.ts: a problem the brief requires) is asked about the same way, and
 * the ledger decides when it stops being unowned: a claim naming it counts, not only claim/<slug>. One difference: an
 * idea with nobody to ask is only logged (hands_unasked). An item whose author and chair are both absent (one the
 * launcher seeded in a flat room, say) goes instead to the worker holding the fewest live claims, counting the asks this
 * sweep already gave out, because nobody else will answer for a problem the brief requires.
 */
import type { Hub } from "../../hub.js";
import { claimReleased } from "../board.js";
import { coverage, ITEM_PREFIX, unownedItems } from "../coverage/coverage.js";
import { IDEA_SETTLED, settled } from "../open-work.js";
import { windowMs } from "../output.js";
import type { BoardEntry, Participant, Room } from "../types.js";

/** 0 turns the ask off. */
export const HANDS_AFTER_MS = process.env.CHATROOM_HANDS_AFTER_MS?.trim() === "0" ? 0 : windowMs(process.env.CHATROOM_HANDS_AFTER_MS, 10 * 60_000);
const NOT_WORKERS = ["verifier", "lead", "chair"];
const ASKED = /(?:^|\s)((?:idea|item)\/\S+) has had no owner for /;
const RECRUITED = /"note"\s*:\s*"claimed at recruitment/;

const slugOf = (key: string) => key.slice(key.indexOf("/") + 1);
const live = (e: BoardEntry | undefined): e is BoardEntry => !!e?.text.trim() && !claimReleased(e) && !settled(e);
const team = (e: BoardEntry): string[] => {
  try {
    const j = JSON.parse(e.text) as { owner?: unknown; team?: unknown };
    return [j.owner, ...(Array.isArray(j.team) ? j.team : [])].filter((x): x is string => typeof x === "string");
  } catch { return []; }
};

/** idea/* entries nobody has claimed and nobody has ruled on, with their authors: the work the ask is about. */
export function unownedIdeas(room: Room): { key: string; author: string; since: string }[] {
  return [...room.board].filter(([k, e]) => k.startsWith("idea/") && e.text.trim() && !IDEA_SETTLED.test(e.text) && !settled(e) &&
    !live(room.board.get(`claim/${slugOf(k)}`))).map(([key, e]) => ({ key, author: e.by, since: e.updatedAt }));
}

/** Active workers, and whether each holds a live claim, as writer or as a named owner or team member: a recruit's claim is
 * written by whoever recruited it (friction/recruit-area-claim-owner), with the recruit on its team. */
function workersBusy(hub: Hub, room: Room): { workers: Participant[]; allBusy: boolean; held: Map<string, number> } {
  const workers = hub.activeParticipants(room).filter((p) => p.agent !== "human" && !NOT_WORKERS.includes(p.role ?? "worker"));
  const held = new Map<string, number>();
  for (const [k, e] of room.board) if (k.startsWith("claim/") && live(e)) for (const n of new Set([e.by, ...team(e)])) held.set(n, (held.get(n) ?? 0) + 1);
  return { workers, allBusy: workers.length > 0 && workers.every((p) => held.has(p.name)), held };
}

/** Keys already asked about, read back from the room's own messages so a restarted hub does not ask again. */
export function askedKeys(room: Room): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of room.messages) {
    const key = m.tag === "hands" ? ASKED.exec(m.content)?.[1] : undefined;
    if (key && !out.has(key)) out.set(key, m.ts);
  }
  return out;
}

type How = "recruited" | "claimed" | "dropped" | "built";
/** How an asked-about idea or item stopped being unowned, if it has. */
function resolution(room: Room, key: string): { how: How; by: string } | undefined {
  const idea = room.board.get(key);
  if (!idea?.text.trim()) return { how: "dropped", by: idea?.by ?? "?" };
  if (key.startsWith(ITEM_PREFIX)) {
    const row = coverage(room)?.rows.find((r) => r.key === key);
    if (!row || row.state === "unowned") return undefined;
    if (row.state === "dropped") return { how: "dropped", by: idea.by };
    const held = row.claims.map((k) => room.board.get(k)).find((e) => !!e);
    return held ? { how: RECRUITED.test(held.text) ? "recruited" : "claimed", by: held.by } : { how: "built", by: idea.by };
  }
  const claim = room.board.get(`claim/${slugOf(key)}`);
  if (live(claim)) return { how: RECRUITED.test(claim.text) ? "recruited" : "claimed", by: claim.by };
  const word = IDEA_SETTLED.exec(idea.text)?.[1]?.toLowerCase();
  if (word) return { how: ["adopted", "built", "merged", "done"].includes(word) ? "built" : "dropped", by: idea.by };
  return settled(idea) ? { how: "built", by: idea.by } : undefined;
}

/** room -> asked key -> resolved yet. Primed silently from the log on the first sweep after a start. */
const state = new WeakMap<Room, Map<string, boolean>>();
/** room -> keys already logged as hands_unasked (nobody to ask) */
const unasked = new WeakMap<Room, Set<string>>();

/** One pass, from Hub.sweepIdle. */
export function checkHands(hub: Hub, room: Room, at = Date.now()): void {
  if (!HANDS_AFTER_MS || room.state !== "open") return;
  const asked = askedKeys(room);
  let seen = state.get(room);
  if (!seen) {
    seen = new Map([...asked.keys()].map((k) => [k, !!resolution(room, k)]));
    state.set(room, seen);
  }
  for (const [key, ts] of asked) {
    if (seen.get(key) !== false) continue;
    const done = resolution(room, key);
    if (!done) continue;
    seen.set(key, true);
    hub.persist({ type: "hands_resolved", room: room.name, key, how: done.how, by: done.by, after_min: Math.round((at - Date.parse(ts)) / 6_000) / 10, ts: new Date(at).toISOString() });
  }
  const { workers, allBusy, held } = workersBusy(hub, room);
  if (!allBusy) return;
  for (const idea of [...unownedIdeas(room), ...unownedItems(room)]) {
    const age = at - Date.parse(idea.since);
    if (asked.has(idea.key) || age < HANDS_AFTER_MS) continue;
    const active = hub.activeParticipants(room);
    const author = active.find((p) => p.name === idea.author);
    const chair = room.chair ? active.find((p) => p.name === room.chair) : undefined;
    // stable sort: the earliest joined of the least loaded
    const leastHeld = idea.key.startsWith(ITEM_PREFIX) ? [...workers].sort((x, y) => (held.get(x.name) ?? 0) - (held.get(y.name) ?? 0))[0] : undefined;
    const to = author ?? chair ?? leastHeld;
    const minutes = Math.round(age / 60_000);
    if (!to) {
      const logged = unasked.get(room) ?? new Set<string>();
      if (!logged.has(idea.key)) hub.persist({ type: "hands_unasked", room: room.name, key: idea.key, author: idea.author, workers: workers.length, idea_age_min: minutes, ts: new Date(at).toISOString() });
      unasked.set(room, logged.add(idea.key));
      continue;
    }
    const slug = slugOf(idea.key);
    const wasHere = [...room.participants.values()].some((p) => p.name === idea.author);
    const whose = author ? "" : ` ${idea.author} wrote it and ${wasHere ? "has left" : "is not in this room"}, so it is yours to settle.`;
    hub.post(room, "chat", undefined, `@${hub.shown(room, to)} ${idea.key} has had no owner for ${minutes} min, and ${workers.length === 1 ? "the only worker holds" : `all ${workers.length} workers hold`} a claim.${whose} ` +
      `Choose one: request_agent(area="${slug}", brief=<what it is and what done looks like; it may just say board_get ${idea.key}>) adds a seat for it; ` +
      `board_set claim/${slug} if you are building it already or will take it after your current work; or start ${idea.key} with "dropped:" and the reason. Reply to this message with which.`, { tag: "hands" });
    seen.set(idea.key, false);
    // an owed ask is load: the next item goes to another worker (review/af7ae3e9 F1)
    if (!author && !chair) held.set(to.name, (held.get(to.name) ?? 0) + 1);
    hub.persist({ type: "hands_asked", room: room.name, key: idea.key, author: idea.author, asked: to.name, workers: workers.length, idea_age_min: minutes, ts: new Date(at).toISOString() });
  }
}
