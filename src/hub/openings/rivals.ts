/**
 * Rival framings at the reveal (decision/reveal-rivals, item/reveal-lever-pair). RSI-7 (swarm-193427-ztnx) found the
 * concluded framing already present at the reveal in 19 of 20 rooms and opening pairs competing in 2 of 18, so what the
 * room ends on is decided by what is in front of the seats then. Its alternatives arm seeded 27 alternatives and 26 were
 * misreadings their own author refuted by argument at p <= 0.07, none tested: an author judges its rival against the
 * answer it already prefers (arXiv:2404.13076, self-preference), and nothing asked for the decisive input
 * (arXiv:2607.05682 makes a minimal decisive test with a named falsifying observation the artifact). Co-scientist-style
 * systems compute how far apart candidates are and never hand the far one to anyone (gh:llnl/open-ai-co-scientist).
 *
 * With rivalsConfig.on (CHATROOM_REVEAL_RIVALS=1, swarm --reveal-rivals), each seat that opened gets one framing it did not write, the one
 * least like its own opening, as an owed ask (tag "rival"): name an input where the two differ and reply with what it
 * showed. A peer's opening chosen as a rival is seeded as idea/<slug> so it has a key like any alternative.
 *
 * Telemetry runs whatever the flag: framing {action claimed|attacked|tested|dropped|done|next|cleared} for every seeded
 * framing, rival_assigned at the reveal and rival_answered on a reply to (or pass on) a rival ask.
 */
import type { Hub } from "../../hub.js";
import type { BoardEntry, Message, Participant, Room } from "../types.js";
import { applyBoard, attackTarget } from "../board.js";
import { freeKey, slugOf } from "./ideas.js";
import type { Event } from "../internal.js";

export interface RivalAssignment { seat: string; key: string; source: "alternative" | "opening"; from: string; overlap: number; ask?: string; answered?: boolean }
/** The framings a reveal seeded and who each rival went to. Restored on replay from framings_seeded and rival_assigned. */
export interface Framings { revealedAt: string; seeded: string[]; rivals: RivalAssignment[] }
/** Off unless CHATROOM_REVEAL_RIVALS=1, so one build serves both arms of a pair; tests set it directly. */
export const rivalsConfig = { on: process.env.CHATROOM_REVEAL_RIVALS === "1" };
const state = new WeakMap<Room, Framings>();
export const framingsOf = (room: Room): Framings | undefined => state.get(room);

/** Replay: framings_seeded opens the record, each rival_assigned adds its seat, each rival_answered marks its ask. */
export function restoreFramings(room: Room, ev: Event): void {
  if (ev.type === "framings_seeded") state.set(room, { revealedAt: ev.ts, seeded: [...ev.keys], rivals: [] });
  else if (ev.type === "rival_assigned") {
    const { seat, key, source, from, overlap, ask } = ev;
    state.get(room)?.rivals.push({ seat, key, source, from, overlap, ask });
  } else if (ev.type === "rival_answered") {
    const r = state.get(room)?.rivals.find((x) => x.seat === ev.seat && x.key === ev.key);
    if (r) r.answered = true;
  }
}

const STOP = new Set(["a", "an", "the", "of", "to", "and", "or", "in", "on", "for", "is", "it", "that", "with", "by", "be", "not", "than",
  "this", "are", "as", "at", "from", "its", "we", "you", "your", "our", "will", "can", "but", "if", "then", "so", "do", "check"]);
const words = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w)));

/** Word-set Jaccard overlap, 0 (nothing shared) to 1 (same words). */
export function overlap(a: string, b: string): number {
  const x = words(a), y = words(b);
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  const union = x.size + y.size - both;
  return union ? both / union : 0;
}

/** The seats an alternative's entry says named it ("From A and B's sealed openings"); the author when the line is gone. */
function namers(entry: BoardEntry): string[] {
  const m = /\n\nFrom (.+?)'s sealed opening/.exec(entry.text);
  return m ? m[1].split(" and ") : [entry.by];
}

/** The alternative's own text: the entry before the hub's "From ..." line. */
const body = (entry: BoardEntry) => entry.text.split(/\n\nFrom .+?'s sealed opening/)[0].trim();

const minutesSince = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 6_000) / 10;
const DISPOSITION = /^\s*(tested|dropped|done|next)\s*:/i;
const disposition = (text: string | undefined) => (text ? DISPOSITION.exec(text.trim().split("\n")[0] ?? "")?.[1]?.toLowerCase() : undefined);

/**
 * Pick each opener's rival. Candidates are the seeded alternatives and the openings, minus anything the seat itself
 * named; the seat gets the one with the least word overlap with its opening, preferring one no other seat was handed
 * (two seats share a rival only when there are fewer candidates than seats). Ties keep board order, alternatives first.
 */
export function pickRivals(openers: { seat: string; opening: string }[], alternatives: { key: string; text: string; namers: string[] }[]):
    { seat: string; pick: { key?: string; text: string; source: "alternative" | "opening"; from: string }; overlap: number }[] {
  const candidates = [
    ...alternatives.map((a) => ({ key: a.key, text: a.text, source: "alternative" as const, from: a.namers[0], namers: a.namers })),
    ...openers.map((o) => ({ key: undefined, text: o.opening, source: "opening" as const, from: o.seat, namers: [o.seat] })),
  ];
  const taken = new Set<number>();
  const out = [];
  for (const o of openers) {
    const scored = candidates.map((c, i) => ({ c, i, ov: overlap(o.opening, c.text) })).filter(({ c }) => !c.namers.includes(o.seat));
    if (!scored.length) continue;
    const pool = scored.some(({ i }) => !taken.has(i)) ? scored.filter(({ i }) => !taken.has(i)) : scored;
    const best = pool.reduce((m, s) => (s.ov < m.ov ? s : m));
    taken.add(best.i);
    out.push({ seat: o.seat, pick: { key: best.c.key, text: best.c.text, source: best.c.source, from: best.c.from }, overlap: Math.round(best.ov * 1000) / 1000 });
  }
  return out;
}

/** Run from reveal() after the alternatives are seeded: record the seeded framings and, with the flag, hand out rivals. */
export function afterReveal(hub: Hub, room: Room, seeded: readonly string[], enabled = rivalsConfig.on): void {
  const at = new Date().toISOString();
  const framings: Framings = { revealedAt: at, seeded: [...seeded], rivals: [] };
  state.set(room, framings);
  if (enabled) {
    const openers = [...room.openings].map(([pid, opening]) => ({ p: room.participants.get(pid), opening }))
      .filter((o): o is { p: Participant; opening: string } => !!o.p && o.p.agent !== "human")
      .map((o) => ({ seat: o.p.name, opening: o.opening }));
    const alternatives = seeded.map((key) => ({ key, entry: room.board.get(key) }))
      .filter((a): a is { key: string; entry: BoardEntry } => !!a.entry?.text.trim())
      .map((a) => ({ key: a.key, text: body(a.entry), namers: namers(a.entry) }));
    const openingKeys = new Map<string, string>();
    for (const r of pickRivals(openers, alternatives)) {
      let key = r.pick.key;
      if (!key) {
        // a peer's main answer as the rival: seeded once, under its own key, authored by the seat that wrote it
        key = openingKeys.get(r.pick.from);
        if (!key) {
          key = freeKey(room, slugOf(r.pick.text), r.pick.from);
          const entry: BoardEntry = {
            text: `${r.pick.text}\n\nFrom ${r.pick.from}'s sealed opening (its main answer), handed out as a rival framing at the reveal. Not yet claimed or tested: claim/${key.slice(5)} to build on it, or attack/${key} to say why not.`,
            by: r.pick.from, updatedAt: at,
          };
          applyBoard(room, key, entry);
          hub.persist({ type: "board", room: room.name, key, entry });
          openingKeys.set(r.pick.from, key);
          framings.seeded.push(key);
        }
      }
      framings.rivals.push({ seat: r.seat, key, source: r.pick.source, from: r.pick.from, overlap: r.overlap });
    }
  }
  hub.persist({ type: "framings_seeded", room: room.name, keys: framings.seeded, rivals: enabled, ts: at });
  for (const r of framings.rivals) {
    const p = [...room.participants.values()].find((q) => q.name === r.seat && q.active);
    if (!p) continue;
    const text = body(room.board.get(r.key) ?? { text: "", by: "", updatedAt: at }).slice(0, 200);
    const msg = hub.post(room, "chat", undefined,
      `@${hub.shown(room, p)} rival framing for you: ${r.key}, from ${r.from}'s sealed opening${r.source === "opening" ? " (its main answer)" : ""}: "${text}". ` +
      "Of the framings you did not write it is the one least like your opening. Before your first claim, name one input where it and your " +
      "opening give different results, run it or work it out, and reply to this message with the input and what it showed. " +
      `If the rival holds, claim/${r.key.slice(5)}; if the input rules it out, attack/${r.key} quoting the clause it refutes.`, { tag: "rival" });
    r.ask = msg.id;
    hub.persist({ type: "rival_assigned", room: room.name, seat: r.seat, key: r.key, source: r.source, from: r.from, overlap: r.overlap, method: "jaccard", ask: msg.id, ts: at });
  }
}

const holdsClaim = (room: Room, p: Participant) => [...room.board].some(([k, e]) => k.startsWith("claim/") && e.by === p.name && e.text.trim());

function rivalAsk(room: Room, id: string | undefined): RivalAssignment | undefined {
  return id ? state.get(room)?.rivals.find((r) => r.ask === id) : undefined;
}

/** A reply to a seat's own rival ask: logged once per ask, with whether the seat already held a claim. */
export function noticeRivalReply(hub: Hub, room: Room, p: Participant, msg: Message): void {
  const r = rivalAsk(room, msg.replyTo);
  if (!r || r.seat !== p.name) return;
  answered(hub, room, p, r, "reply", msg.content.length);
}

/** A pass that declines a rival ask. */
export function noticeRivalPass(hub: Hub, room: Room, p: Participant, askId: string): void {
  const r = rivalAsk(room, askId);
  if (r && r.seat === p.name) answered(hub, room, p, r, "pass");
}

function answered(hub: Hub, room: Room, p: Participant, r: RivalAssignment, via: "reply" | "pass", chars?: number) {
  if (r.answered) return;
  r.answered = true;
  const ts = new Date().toISOString();
  hub.persist({ type: "rival_answered", room: room.name, seat: p.name, key: r.key, via, ...(chars !== undefined ? { chars } : {}),
    held_claim: holdsClaim(room, p), minutes_since_reveal: minutesSince(state.get(room)!.revealedAt, ts), ts });
}

/** The seeded framing a board key acts on, and how: a claim, an attack, a disposition change or a clear of the idea itself. */
function framingAction(room: Room, key: string, by: string, entry: BoardEntry | null, previous: BoardEntry | undefined): { target: string; action: string } | undefined {
  const seeded = state.get(room)?.seeded;
  if (!seeded?.length) return;
  if (key.startsWith("idea/") && seeded.includes(key)) {
    if (!entry) return previous?.text.trim() ? { target: key, action: "cleared" } : undefined;
    const now = disposition(entry.text);
    return now && now !== disposition(previous?.text) ? { target: key, action: now } : undefined;
  }
  if (!entry || previous?.text.trim()) return; // only the first write of a claim or an attack
  if (key.startsWith("claim/") && seeded.includes(`idea/${key.slice(6)}`)) return { target: `idea/${key.slice(6)}`, action: "claimed" };
  if (key.startsWith("attack/idea/")) {
    const target = attackTarget(room, key, by);
    if (seeded.includes(target)) return { target, action: "attacked" };
  }
}

/** From setBoard, after the write is applied: one framing event when a seeded framing is claimed, attacked, disposed or cleared. */
export function noticeFraming(hub: Hub, room: Room, p: Participant, key: string, entry: BoardEntry | null, previous: BoardEntry | undefined): void {
  const hit = framingAction(room, key, p.name, entry, previous);
  if (!hit) return;
  const f = state.get(room)!;
  const assigned = f.rivals.filter((r) => r.key === hit.target).map((r) => r.seat);
  const ts = new Date().toISOString();
  hub.persist({ type: "framing", room: room.name, key: hit.target, action: hit.action, by: p.name, author: room.board.get(hit.target)?.by ?? previous?.by ?? "",
    ...(assigned.length ? { assigned_to: assigned } : {}), by_assigned: assigned.includes(p.name), minutes_since_reveal: minutesSince(f.revealedAt, ts), ts });
}
