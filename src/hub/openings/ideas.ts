/**
 * Alternatives named in a sealed opening become idea/* entries when the openings are revealed (decision/opening-alternatives).
 * In 198 of 200 concluded rooms the first build claim came before any alternative was on the board, and the hint that asks
 * a seat to move a listed idea to idea/<slug> was followed by one 23 times in 244 (evidence/brainstorm-replay-200). js47's
 * one measured positive lead lived in a seat's prose, was queued behind infrastructure and never ran
 * (evidence/brainstorm-narrowing-js47). The opening is the one moment every seat writes before reading the others, and
 * diversity collapses through interaction (arXiv:2604.18005), so the hub records the alternatives there itself; from the
 * board the existing machinery carries them (open_work idea_unclaimed, hands.ts, attack/idea/*).
 *
 * Keys never take over another entry (attack/decision/opening-alternatives): idea/<slug>, else idea/<slug>-<seat>, else
 * -<n>. The author is the seat that named it; exact duplicates (normalised text) make one entry naming every seat.
 */
import type { Hub } from "../../hub.js";
import { HubError, type BoardEntry, type Room } from "../types.js";
import { applyBoard } from "../board.js";
import { afterReveal } from "./rivals.js";

export const MAX_ALTERNATIVES = 3;
export const MAX_ALTERNATIVE_CHARS = 200;

/** Each seat's alternatives, held sealed with its opening until the reveal. Restored from the opening events on replay. */
const held = new WeakMap<Room, Map<string, string[]>>();

/** Check a seat's alternatives (trimmed, empty ones dropped, bounds enforced) and hold them with its opening. Throws
 * before anything is held, so a refused call leaves the seat's earlier opening as it was. */
export function holdAlternatives(room: Room, pid: string, alternatives: readonly string[] | undefined): string[] {
  const alts = (alternatives ?? []).map((a) => a.trim()).filter(Boolean);
  if (alts.length > MAX_ALTERNATIVES) throw new HubError(`Give at most ${MAX_ALTERNATIVES} alternatives (got ${alts.length}): the ones most unlike your answer.`, undefined, "size");
  const long = alts.find((a) => a.length > MAX_ALTERNATIVE_CHARS);
  if (long) throw new HubError(`An alternative is ${long.length} chars; each is capped at ${MAX_ALTERNATIVE_CHARS}: the idea and the check that would tell it from your answer.`, undefined, "size");
  let m = held.get(room);
  if (!m) held.set(room, (m = new Map()));
  if (alts.length) m.set(pid, alts);
  else m.delete(pid);
  return alts;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[\s.;,:]+$/, "").trim();
const STOP = new Set(["a", "an", "the", "of", "to", "and", "or", "in", "on", "for", "is", "it", "that", "with", "by", "be", "not", "than"]);
const PROBABILITY_ANNOTATION = /(?:\(\s*|\[\s*)?\bp\s*=\s*(?:\d+(?:\.\d+)?|\.\d+)%?\s*[\])]?/gi;
const LEADING_SEPARATORS = /^[\s:;,—-]+/;
const CHECK_START = /\bcheck\b/i;
const IDEA_SEPARATOR = /[;:—]/;
const LETTER_WORDS = /[a-z]+/g;
const PROBABILITY_LABELS = new Set(["p", "prob", "probability", "confidence", "likelihood"]);

/** Probability annotations stay in the entry, not its address. Strip them before splitting the idea from its check:
 * RSI-7's nine "p=.30: idea; check" alternatives otherwise stopped at the first colon and became idea/p-30. */
function slugSource(text: string): string {
  const beforeCheck = text.replace(PROBABILITY_ANNOTATION, "").replace(LEADING_SEPARATORS, "").split(CHECK_START)[0];
  // Do not let another probability spelling ("30%:", "p≈.3:", "prob .1:") become the whole key.
  // A genuine numeric idea ("3 seats") still contains a content word; the check is never used as its title.
  return beforeCheck.split(IDEA_SEPARATOR).map((head) => head.trim())
    .find((head) => (head.toLowerCase().match(LETTER_WORDS) ?? []).some((word) => !PROBABILITY_LABELS.has(word))) ?? "";
}

/** A short key slug from the alternative's opening words: the idea before its "check:" clause. */
export function slugOf(text: string): string {
  const words = slugSource(text).toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => !STOP.has(w)) ?? [];
  let slug = "";
  for (const w of words) {
    if (slug && (slug + "-" + w).length > 40) break;
    slug = slug ? `${slug}-${w}` : w;
  }
  return slug || "alternative";
}

const seatSlug = (name: string) => name.toLowerCase().replace(/[^\w.-]+/g, "-");

/** The first free idea/* key for this alternative: never one another entry holds. */
export function freeKey(room: Room, slug: string, seat: string): string {
  const base = `idea/${slug}`;
  if (!room.board.get(base)?.text.trim()) return base;
  const mine = `${base}-${seatSlug(seat)}`;
  if (!room.board.get(mine)?.text.trim()) return mine;
  for (let n = 2; ; n++) if (!room.board.get(`${mine}-${n}`)?.text.trim()) return `${mine}-${n}`;
}

/** Write each distinct held alternative as idea/<slug>, authored by the first seat that named it; returns keys and
 * their content sources in opening order. Runs once, from reveal(), after the latch is set. */
export function seedOpeningIdeas(hub: Hub, room: Room): { key: string; source: string }[] {
  const named = new Map<string, { text: string; seats: string[] }>();
  for (const [pid, alts] of held.get(room) ?? []) {
    const p = room.participants.get(pid);
    if (!p) continue;
    for (const text of alts) {
      const seen = named.get(norm(text));
      if (seen) { if (!seen.seats.includes(p.name)) seen.seats.push(p.name); }
      else named.set(norm(text), { text, seats: [p.name] });
    }
  }
  held.delete(room);
  const seeded: { key: string; source: string }[] = [];
  for (const { text, seats } of named.values()) {
    // a reveal interrupted after this idea's write (no openings_revealed yet) finds it again: reuse it, never a duplicate
    const earlier = [...room.board.entries()].find(([k, e]) => k.startsWith("idea/") && e.by === seats[0] && e.text.startsWith(`${text}\n\nFrom `));
    if (earlier) { seeded.push({ key: earlier[0], source: slugSource(text) }); continue; }
    const key = freeKey(room, slugOf(text), seats[0]);
    const who = seats.length > 1 ? `${seats.join(" and ")}'s sealed openings` : `${seats[0]}'s sealed opening`;
    const entry: BoardEntry = {
      text: `${text}\n\nFrom ${who}, written before reading the others. Not yet claimed or tested: claim/${key.slice(5)} to test it, or attack/${key} to say why not.`,
      by: seats[0], updatedAt: new Date().toISOString(),
    };
    applyBoard(room, key, entry);
    hub.persist({ type: "board", room: room.name, key, entry });
    seeded.push({ key, source: slugSource(text) });
  }
  return seeded;
}

/** Reveal the blind openings (moved from Hub.revealOpenings): latch, seed the alternatives as idea/*, log, then post the
 * openings. The alternatives go to the board, not chat; one line says where, so nobody re-lists them. */
export function reveal(hub: Hub, room: Room, note?: string): void {
  if (room.openingsTimer) clearTimeout(room.openingsTimer);
  room.openingsTimer = undefined;
  room.openingsRevealed = true;
  const sources = seedOpeningIdeas(hub, room);
  const seeded = sources.map(({ key }) => key);
  hub.persist({ type: "openings_revealed", room: room.name, ...(seeded.length ? { ideas_seeded: seeded, idea_slug_sources: sources } : {}) });
  hub.post(room, "system", undefined, `Opening answers (${room.openings.size}${note ? ` of ${room.expectedParticipants}` : ""}, written independently${note ? `; ${note}` : ""}):`);
  for (const [pid, content] of room.openings) {
    const p = room.participants.get(pid);
    if (p) hub.post(room, "chat", p, content, { tag: "opening" });
  }
  if (seeded.length) hub.post(room, "system", undefined, `Alternatives named in the sealed openings are on the board: ${seeded.join(", ")}. Claim one to test it, or attack/idea/<slug> to say why it should not be.`);
  afterReveal(hub, room, seeded); // framing telemetry always; a rival framing per seat with CHATROOM_REVEAL_RIVALS (rivals.ts)
  if (room.mode === "round_robin") room.round = 2;
}
